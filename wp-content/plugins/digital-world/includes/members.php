<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const DIGITAL_WORLD_MEMBERS_SLUG = 'digital-world-members';
const DIGITAL_WORLD_MEMBERS_PER_PAGE = 20;

add_action( 'admin_menu', 'digital_world_register_members_page' );
add_action( 'admin_post_digital_world_members_export', 'digital_world_export_members' );
add_action( 'admin_post_digital_world_registration', 'digital_world_save_registration_setting' );
add_action( 'pre_user_query', 'digital_world_members_order_by_last_login' );

function digital_world_register_members_page() {
	$hook = add_submenu_page(
		'edit.php?post_type=' . DIGITAL_WORLD_CPT,
		'Користувачі світу',
		'Користувачі',
		'list_users',
		DIGITAL_WORLD_MEMBERS_SLUG,
		'digital_world_render_members_page',
		1
	);
	add_action( 'load-' . $hook, 'digital_world_handle_members_bulk' );
}

function digital_world_members_url( $args = array() ) {
	return add_query_arg(
		array_merge(
			array(
				'post_type' => DIGITAL_WORLD_CPT,
				'page'      => DIGITAL_WORLD_MEMBERS_SLUG,
			),
			$args
		),
		admin_url( 'edit.php' )
	);
}

function digital_world_members_query_args( $search = '', $orderby = 'registered', $order = 'DESC' ) {
	$args = array(
		'meta_key'   => DIGITAL_WORLD_SOURCE_META,
		'meta_value' => DIGITAL_WORLD_SOURCE_BOOK,
		'orderby'    => array(
			'name'  => 'display_name',
			'email' => 'user_email',
		)[ $orderby ] ?? 'user_registered',
		'order'      => 'ASC' === strtoupper( $order ) ? 'ASC' : 'DESC',
	);
	if ( 'last_login' === $orderby ) {
		$args['dw_order_by_last_login'] = true;
	}
	if ( '' !== $search ) {
		$args['search']         = '*' . $search . '*';
		$args['search_columns'] = array( 'user_login', 'user_email', 'display_name' );
	}
	return $args;
}

function digital_world_members_order_by_last_login( WP_User_Query $query ) {
	global $wpdb;
	if ( empty( $query->query_vars['dw_order_by_last_login'] ) ) {
		return;
	}
	$order                = 'ASC' === strtoupper( (string) $query->query_vars['order'] ) ? 'ASC' : 'DESC';
	$query->query_from   .= $wpdb->prepare( " LEFT JOIN {$wpdb->usermeta} AS dw_last ON ( dw_last.user_id = {$wpdb->users}.ID AND dw_last.meta_key = %s )", DIGITAL_WORLD_LAST_LOGIN_META );
	$query->query_orderby = "ORDER BY (COALESCE(dw_last.meta_value, '') = '') ASC, dw_last.meta_value {$order}, {$wpdb->users}.user_registered DESC";
}

function digital_world_request_text( $key ) {
	return isset( $_REQUEST[ $key ] ) ? sanitize_text_field( wp_unslash( $_REQUEST[ $key ] ) ) : '';
}

function digital_world_format_moment( $value ) {
	if ( ! $value ) {
		return '';
	}
	$timestamp = strtotime( $value . ( str_contains( $value, 'T' ) ? '' : ' UTC' ) );
	return $timestamp ? wp_date( 'j M Y, H:i', $timestamp ) : '';
}

if ( is_admin() && ! class_exists( 'WP_List_Table' ) ) {
	require_once ABSPATH . 'wp-admin/includes/class-wp-list-table.php';
}

if ( class_exists( 'WP_List_Table' ) ) {
	class Digital_World_Members_Table extends WP_List_Table {
		public function __construct() {
			parent::__construct(
				array(
					'singular' => 'member',
					'plural'   => 'members',
					'ajax'     => false,
				)
			);
		}

		public function get_columns() {
			return array(
				'cb'         => '<input type="checkbox" />',
				'name'       => 'Імʼя',
				'email'      => 'Email',
				'registered' => 'Зареєстровано',
				'last_login' => 'Останній вхід',
				'consent'    => 'Згода з умовами',
			);
		}

		protected function get_sortable_columns() {
			return array(
				'name'       => array( 'name', false ),
				'email'      => array( 'email', false ),
				'registered' => array( 'registered', true ),
				'last_login' => array( 'last_login', true ),
			);
		}

		protected function get_bulk_actions() {
			return current_user_can( 'delete_users' ) ? array( 'delete' => 'Видалити' ) : array();
		}

		public function no_items() {
			echo esc_html( '' !== digital_world_request_text( 's' ) ? 'Нікого не знайдено.' : 'Поки ніхто не зареєструвався через книгу гостей.' );
		}

		public function prepare_items() {
			$this->_column_headers = array( $this->get_columns(), array(), $this->get_sortable_columns(), 'name' );
			$page                  = $this->get_pagenum();
			$args                  = digital_world_members_query_args(
				digital_world_request_text( 's' ),
				digital_world_request_text( 'orderby' ),
				digital_world_request_text( 'order' ) ?: 'DESC'
			);
			$args['number']        = DIGITAL_WORLD_MEMBERS_PER_PAGE;
			$args['offset']        = ( $page - 1 ) * DIGITAL_WORLD_MEMBERS_PER_PAGE;
			$args['count_total']   = true;
			$query                 = new WP_User_Query( $args );
			$this->items           = $query->get_results();
			$this->set_pagination_args(
				array(
					'total_items' => $query->get_total(),
					'per_page'    => DIGITAL_WORLD_MEMBERS_PER_PAGE,
				)
			);
		}

		protected function column_cb( $user ) {
			return sprintf(
				'<label class="screen-reader-text" for="dw-member-%1$d">Вибрати %2$s</label><input type="checkbox" id="dw-member-%1$d" name="users[]" value="%1$d" />',
				$user->ID,
				esc_html( $user->display_name )
			);
		}

		protected function column_name( $user ) {
			$actions = array();
			if ( current_user_can( 'edit_user', $user->ID ) ) {
				$actions['edit'] = sprintf( '<a href="%s">Редагувати</a>', esc_url( get_edit_user_link( $user->ID ) ) );
			}
			if ( current_user_can( 'delete_user', $user->ID ) ) {
				$actions['delete'] = sprintf(
					'<a class="submitdelete" href="%s">Видалити</a>',
					esc_url( wp_nonce_url( admin_url( 'users.php?action=delete&user=' . $user->ID ), 'bulk-users' ) )
				);
			}
			return sprintf(
				'%1$s<strong>%2$s</strong>%3$s',
				get_avatar( $user->ID, 32, '', '', array( 'class' => 'dw-members__avatar' ) ),
				esc_html( $user->display_name ),
				$this->row_actions( $actions )
			);
		}

		protected function column_email( $user ) {
			return sprintf( '<a href="mailto:%1$s">%2$s</a>', esc_attr( $user->user_email ), esc_html( $user->user_email ) );
		}

		protected function column_registered( $user ) {
			return esc_html( digital_world_format_moment( $user->user_registered ) );
		}

		protected function column_last_login( $user ) {
			$value = digital_world_format_moment( get_user_meta( $user->ID, DIGITAL_WORLD_LAST_LOGIN_META, true ) );
			return '' !== $value ? esc_html( $value ) : '<span aria-hidden="true">—</span><span class="screen-reader-text">Ще не входив</span>';
		}

		protected function column_consent( $user ) {
			$value = digital_world_format_moment( get_user_meta( $user->ID, DIGITAL_WORLD_CONSENT_META, true ) );
			return '' !== $value ? esc_html( $value ) : '<span aria-hidden="true">—</span><span class="screen-reader-text">Немає</span>';
		}
	}
}

function digital_world_handle_members_bulk() {
	$table  = new Digital_World_Members_Table();
	$action = $table->current_action();
	if ( 'delete' !== $action ) {
		return;
	}
	check_admin_referer( 'bulk-members' );
	if ( ! current_user_can( 'delete_users' ) ) {
		wp_die( esc_html__( 'Sorry, you are not allowed to delete users.' ) );
	}
	$ids = array_filter( array_map( 'absint', (array) ( $_REQUEST['users'] ?? array() ) ) );
	if ( ! $ids ) {
		wp_safe_redirect( digital_world_members_url() );
		exit;
	}
	wp_safe_redirect(
		add_query_arg(
			array(
				'action'   => 'delete',
				'users'    => $ids,
				'_wpnonce' => wp_create_nonce( 'bulk-users' ),
			),
			admin_url( 'users.php' )
		)
	);
	exit;
}

function digital_world_render_members_page() {
	if ( ! current_user_can( 'list_users' ) ) {
		wp_die( esc_html__( 'Sorry, you are not allowed to access this page.' ) );
	}
	$table = new Digital_World_Members_Table();
	$table->prepare_items();
	$open   = digital_world_registration_open();
	$search = digital_world_request_text( 's' );
	$export = wp_nonce_url(
		add_query_arg(
			array(
				'action' => 'digital_world_members_export',
				's'      => $search,
			),
			admin_url( 'admin-post.php' )
		),
		'digital_world_members_export'
	);
	?>
	<div class="wrap">
		<h1 class="wp-heading-inline">Користувачі світу</h1>
		<a class="page-title-action" href="<?php echo esc_url( $export ); ?>">Експорт у CSV</a>
		<?php if ( '' !== $search ) : ?>
			<span class="subtitle"><?php echo esc_html( sprintf( 'Результати пошуку для «%s»', $search ) ); ?></span>
		<?php endif; ?>
		<hr class="wp-header-end">

		<?php if ( isset( $_GET['dw_registration'] ) ) : ?>
			<div class="notice notice-success is-dismissible"><p><?php echo esc_html( $open ? 'Реєстрацію відкрито.' : 'Реєстрацію закрито.' ); ?></p></div>
		<?php endif; ?>

		<p>Ті, хто зареєструвався через книгу гостей у світі. Це звичайні користувачі WordPress з роллю «Subscriber».</p>

		<?php if ( current_user_can( 'manage_options' ) ) : ?>
			<form class="dw-members__setting" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="digital_world_registration">
				<input type="hidden" name="open" value="<?php echo $open ? '0' : '1'; ?>">
				<?php wp_nonce_field( 'digital_world_registration' ); ?>
				<strong>Реєстрація в книзі гостей:</strong>
				<span class="dw-members__state <?php echo $open ? 'is-open' : 'is-closed'; ?>"><?php echo esc_html( $open ? 'відкрита' : 'закрита' ); ?></span>
				<button type="submit" class="button"><?php echo esc_html( $open ? 'Закрити реєстрацію' : 'Відкрити реєстрацію' ); ?></button>
			</form>
		<?php endif; ?>

		<form method="get">
			<input type="hidden" name="post_type" value="<?php echo esc_attr( DIGITAL_WORLD_CPT ); ?>">
			<input type="hidden" name="page" value="<?php echo esc_attr( DIGITAL_WORLD_MEMBERS_SLUG ); ?>">
			<?php $table->search_box( 'Шукати', 'dw-members' ); ?>
			<?php $table->display(); ?>
		</form>
	</div>
	<style>
		.dw-members__setting{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:12px 0 4px;padding:12px 16px;background:#fff;border:1px solid #c3c4c7;border-left-width:4px}
		.dw-members__state{padding:2px 10px;border-radius:999px;font-weight:600}
		.dw-members__state.is-open{background:#d1fae5;color:#065f46}
		.dw-members__state.is-closed{background:#fde2e1;color:#8a1f11}
		.wp-list-table .column-name .dw-members__avatar{float:left;margin:2px 10px 0 0;border-radius:50%}
		.wp-list-table .column-registered,.wp-list-table .column-last_login,.wp-list-table .column-consent{width:15%}
	</style>
	<?php
}

function digital_world_csv_cell( $value ) {
	$value = (string) $value;
	return preg_match( '/^[=+\-@\t\r]/', $value ) ? "'" . $value : $value;
}

function digital_world_export_members() {
	if ( ! current_user_can( 'list_users' ) ) {
		wp_die( esc_html__( 'Sorry, you are not allowed to access this page.' ), 403 );
	}
	check_admin_referer( 'digital_world_members_export' );

	$args           = digital_world_members_query_args( digital_world_request_text( 's' ) );
	$args['number'] = -1;
	$users          = ( new WP_User_Query( $args ) )->get_results();

	nocache_headers();
	header( 'Content-Type: text/csv; charset=utf-8' );
	header( 'Content-Disposition: attachment; filename="digital-world-members-' . gmdate( 'Y-m-d' ) . '.csv"' );
	$out = fopen( 'php://output', 'w' );
	fwrite( $out, "\xEF\xBB\xBF" );
	fputcsv( $out, array( 'ID', 'Імʼя', 'Email', 'Зареєстровано', 'Останній вхід', 'Згода з умовами' ), ',', '"', '' );
	foreach ( $users as $user ) {
		fputcsv(
			$out,
			array_map(
				'digital_world_csv_cell',
				array(
					$user->ID,
					$user->display_name,
					$user->user_email,
					digital_world_format_moment( $user->user_registered ),
					digital_world_format_moment( get_user_meta( $user->ID, DIGITAL_WORLD_LAST_LOGIN_META, true ) ),
					digital_world_format_moment( get_user_meta( $user->ID, DIGITAL_WORLD_CONSENT_META, true ) ),
				)
			),
			',',
			'"',
			''
		);
	}
	fclose( $out );
	exit;
}

function digital_world_save_registration_setting() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( esc_html__( 'Sorry, you are not allowed to access this page.' ), 403 );
	}
	check_admin_referer( 'digital_world_registration' );
	update_option( DIGITAL_WORLD_REGISTRATION_OPTION, isset( $_POST['open'] ) && '1' === $_POST['open'] ? '1' : '0', false );
	wp_safe_redirect( digital_world_members_url( array( 'dw_registration' => 1 ) ) );
	exit;
}
