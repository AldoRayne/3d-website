<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const DIGITAL_WORLD_EDITOR_ENTRY = 'src/admin.ts';
const DIGITAL_WORLD_EDITOR_SLUG  = 'digital-world-editor';
const DIGITAL_WORLD_BUILDING_ENTRY = 'src/building-meta.ts';

add_action( 'admin_menu', 'digital_world_register_editor_page' );
add_action( 'admin_enqueue_scripts', 'digital_world_enqueue_editor' );
add_action( 'admin_enqueue_scripts', 'digital_world_enqueue_building_box' );
add_action( 'add_meta_boxes_' . DIGITAL_WORLD_CPT, 'digital_world_add_building_box' );
add_action( 'save_post_' . DIGITAL_WORLD_CPT, 'digital_world_save_building_box' );

function digital_world_register_editor_page() {
	add_submenu_page(
		'edit.php?post_type=' . DIGITAL_WORLD_CPT,
		'Редактор світу',
		'Редактор світу',
		'manage_options',
		DIGITAL_WORLD_EDITOR_SLUG,
		'digital_world_render_editor_page',
		0
	);
}

function digital_world_manifest_imports( $name, array &$seen = array() ) {
	$chunk = digital_world_manifest()[ $name ] ?? null;
	if ( ! $chunk ) {
		return array();
	}
	$files = array();
	foreach ( (array) ( $chunk['imports'] ?? array() ) as $import ) {
		if ( isset( $seen[ $import ] ) ) {
			continue;
		}
		$seen[ $import ] = true;
		$file            = digital_world_manifest()[ $import ]['file'] ?? null;
		if ( $file ) {
			$files[] = $file;
		}
		$files = array_merge( $files, digital_world_manifest_imports( $import, $seen ) );
	}
	return $files;
}

function digital_world_is_editor_screen( $hook ) {
	return str_ends_with( (string) $hook, '_page_' . DIGITAL_WORLD_EDITOR_SLUG );
}

function digital_world_manifest_css( $name, array &$seen = array() ) {
	if ( isset( $seen[ $name ] ) ) {
		return array();
	}
	$seen[ $name ] = true;
	$chunk         = digital_world_manifest()[ $name ] ?? null;
	if ( ! $chunk ) {
		return array();
	}
	$css = (array) ( $chunk['css'] ?? array() );
	foreach ( (array) ( $chunk['imports'] ?? array() ) as $import ) {
		$css = array_merge( $css, digital_world_manifest_css( $import, $seen ) );
	}
	return array_values( array_unique( $css ) );
}

function digital_world_enqueue_entry( $handle, $entry_name ) {
	$entry = digital_world_manifest()[ $entry_name ] ?? null;
	if ( ! $entry ) {
		return;
	}
	foreach ( digital_world_manifest_css( $entry_name ) as $index => $css ) {
		wp_enqueue_style( $handle . '-' . $index, DIGITAL_WORLD_URL . 'dist/' . $css, array(), null );
	}
	wp_enqueue_script_module( $handle, DIGITAL_WORLD_URL . 'dist/' . $entry['file'], array(), null );
}

function digital_world_enqueue_editor( $hook ) {
	if ( digital_world_is_editor_screen( $hook ) ) {
		digital_world_enqueue_entry( 'digital-world-editor', DIGITAL_WORLD_EDITOR_ENTRY );
	}
}

function digital_world_enqueue_building_box( $hook ) {
	$screen = get_current_screen();
	if ( in_array( $hook, array( 'post.php', 'post-new.php' ), true ) && $screen && DIGITAL_WORLD_CPT === $screen->post_type ) {
		digital_world_enqueue_entry( 'digital-world-building', DIGITAL_WORLD_BUILDING_ENTRY );
	}
}

function digital_world_add_building_box() {
	add_meta_box( 'dw-building', 'Будівля', 'digital_world_render_building_box', DIGITAL_WORLD_CPT, 'normal', 'high' );
}

function digital_world_render_building_box( WP_Post $post ) {
	$stored = (int) get_post_meta( $post->ID, DIGITAL_WORLD_SEED_META, true );
	$seed   = $stored > 0 ? $stored : ( 'auto-draft' === $post->post_status ? 0 : digital_world_building_seed( $post->ID ) );
	wp_nonce_field( 'dw_building_seed', 'dw_building_nonce' );
	?>
	<div class="dw-building" data-dw-building>
		<canvas class="dw-building__preview" width="420" height="280" aria-label="Прев'ю будівлі"></canvas>
		<div class="dw-building__side">
			<p class="dw-building__desc" data-dw-building-desc></p>
			<button type="button" class="button button-primary button-large" data-dw-building-generate>Generate building</button>
			<p class="description">Кожне натискання генерує нову будівлю. Збережіть запис, щоб вона з'явилася у світі. Колір акцентів береться з поля «Color».</p>
			<input type="hidden" name="dw_building_seed" value="<?php echo esc_attr( (string) $seed ); ?>" data-dw-building-seed>
		</div>
	</div>
	<?php
}

function digital_world_save_building_box( $post_id ) {
	if ( ! isset( $_POST['dw_building_nonce'], $_POST['dw_building_seed'] ) ) {
		return;
	}
	if ( ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['dw_building_nonce'] ) ), 'dw_building_seed' ) ) {
		return;
	}
	if ( ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) || ! current_user_can( 'edit_post', $post_id ) ) {
		return;
	}
	$seed = absint( wp_unslash( $_POST['dw_building_seed'] ) );
	if ( $seed >= 1 && $seed <= DIGITAL_WORLD_MAX_SEED ) {
		update_post_meta( $post_id, DIGITAL_WORLD_SEED_META, $seed );
	}
}

function digital_world_render_editor_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( esc_html__( 'Sorry, you are not allowed to access this page.' ) );
	}

	$boot = array(
		'restUrl'  => esc_url_raw( rest_url( DIGITAL_WORLD_REST_NS ) ),
		'nonce'    => wp_create_nonce( 'wp_rest' ),
		'editUrl'  => admin_url( 'post.php?action=edit&post=' ),
		'newUrl'   => admin_url( 'post-new.php?post_type=' . DIGITAL_WORLD_CPT ),
		'worldUrl' => digital_world_url(),
	);
	?>
	<div class="wrap dw-editor-wrap">
		<h1 class="wp-heading-inline">Редактор світу</h1>
		<a class="page-title-action" href="<?php echo esc_url( $boot['newUrl'] ); ?>">Додати будівлю</a>
		<a class="page-title-action" href="<?php echo esc_url( $boot['worldUrl'] ); ?>" target="_blank" rel="noopener">Відкрити світ</a>
		<hr class="wp-header-end">
		<div id="digital-world-editor"></div>
		<?php if ( ! isset( digital_world_manifest()[ DIGITAL_WORLD_EDITOR_ENTRY ] ) ) : ?>
			<div class="notice notice-error"><p>Редактор не зібрано. Виконайте <code>npm run build</code> у <code>wp-content/plugins/digital-world/frontend</code>.</p></div>
		<?php endif; ?>
	</div>
	<script>window.DigitalWorldEditor = <?php echo wp_json_encode( $boot ); ?>;</script>
	<?php
}
