<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const DIGITAL_WORLD_ENTRY = 'src/main.ts';

add_action( 'init', 'digital_world_register_rewrite' );
add_filter( 'query_vars', 'digital_world_query_vars' );
add_action( 'template_redirect', 'digital_world_render_world' );
add_action( 'wp_footer', 'digital_world_enter_button' );

function digital_world_register_rewrite() {
	add_rewrite_rule( '^digital-world/?$', 'index.php?digital_world=1', 'top' );
}

function digital_world_query_vars( $vars ) {
	$vars[] = 'digital_world';
	return $vars;
}

function digital_world_url() {
	return home_url( '/digital-world/' );
}

function digital_world_is_world_request() {
	return '1' === get_query_var( 'digital_world' );
}

function digital_world_manifest() {
	static $manifest = null;
	if ( null !== $manifest ) {
		return $manifest;
	}
	$path     = DIGITAL_WORLD_DIR . 'dist/.vite/manifest.json';
	$manifest = file_exists( $path ) ? json_decode( (string) file_get_contents( $path ), true ) : array();
	return $manifest;
}

function digital_world_boot_data() {
	return array(
		'restUrl'  => esc_url_raw( rest_url( DIGITAL_WORLD_REST_NS ) ),
		'nonce'    => wp_create_nonce( 'wp_rest' ),
		'homeUrl'  => home_url( '/' ),
		'siteName' => get_bloginfo( 'name' ),
		'ai'       => digital_world_ai_enabled(),
		'world'    => digital_world_world_payload(),
	);
}

function digital_world_render_world() {
	if ( ! digital_world_is_world_request() ) {
		return;
	}

	$entry   = digital_world_manifest()[ DIGITAL_WORLD_ENTRY ] ?? null;
	$objects = digital_world_get_objects();
	$title   = sprintf( 'Digital World — %s', get_bloginfo( 'name' ) );

	status_header( 200 );
	nocache_headers();
	header( 'Content-Type: text/html; charset=' . get_bloginfo( 'charset' ) );
	?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
	<meta name="robots" content="noindex, follow">
	<meta name="theme-color" content="#05070f">
	<title><?php echo esc_html( $title ); ?></title>
	<link rel="canonical" href="<?php echo esc_url( home_url( '/' ) ); ?>">
	<?php if ( $entry ) : ?>
		<?php foreach ( (array) ( $entry['css'] ?? array() ) as $css ) : ?>
	<link rel="stylesheet" href="<?php echo esc_url( DIGITAL_WORLD_URL . 'dist/' . $css ); ?>">
		<?php endforeach; ?>
	<?php endif; ?>
	<script>window.DigitalWorld = <?php echo wp_json_encode( digital_world_boot_data(), JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE ); ?>;</script>
</head>
<body class="dw-body">
	<div id="digital-world-app">
		<noscript>
			<nav class="dw-noscript">
				<h1><?php echo esc_html( get_bloginfo( 'name' ) ); ?></h1>
				<ul>
					<?php foreach ( $objects as $object ) : ?>
						<?php if ( $object['url'] ) : ?>
					<li><a href="<?php echo esc_url( $object['url'] ); ?>"><?php echo esc_html( $object['title'] ); ?></a></li>
						<?php endif; ?>
					<?php endforeach; ?>
				</ul>
			</nav>
		</noscript>
	</div>
	<?php if ( $entry ) : ?>
	<script type="module" src="<?php echo esc_url( DIGITAL_WORLD_URL . 'dist/' . $entry['file'] ); ?>"></script>
	<?php else : ?>
	<p style="color:#fff;font-family:sans-serif;padding:24px">Frontend is not built. Run <code>npm run build</code> in <code>wp-content/plugins/digital-world/frontend</code>.</p>
	<?php endif; ?>
</body>
</html>
	<?php
	exit;
}

function digital_world_enter_button() {
	if ( is_admin() || digital_world_is_world_request() || ! digital_world_has_objects() ) {
		return;
	}

	$href = digital_world_url();
	if ( is_singular() ) {
		foreach ( digital_world_get_objects() as $object ) {
			if ( get_queried_object_id() === $object['page_id'] ) {
				$href = add_query_arg( 'focus', $object['slug'], $href );
				break;
			}
		}
	}
	?>
<a class="dw-enter" href="<?php echo esc_url( $href ); ?>">
	<span class="dw-enter__dot" aria-hidden="true"></span>
	Enter Digital World
</a>
<style>
.dw-enter{position:fixed;right:24px;bottom:24px;z-index:9999;display:inline-flex;align-items:center;gap:10px;padding:14px 22px;border-radius:999px;background:#05070f;color:#e6f1ff;font:600 15px/1 system-ui,-apple-system,sans-serif;text-decoration:none;border:1px solid rgba(94,234,212,.5);box-shadow:0 0 0 0 rgba(94,234,212,.4),0 8px 30px rgba(5,7,15,.45);transition:transform .2s ease,box-shadow .2s ease}
.dw-enter:hover,.dw-enter:focus-visible{transform:translateY(-2px);box-shadow:0 0 24px rgba(94,234,212,.45),0 8px 30px rgba(5,7,15,.45);color:#fff}
.dw-enter:focus-visible{outline:2px solid #5eead4;outline-offset:3px}
.dw-enter__dot{width:10px;height:10px;border-radius:50%;background:#5eead4;box-shadow:0 0 10px #5eead4;animation:dw-enter-pulse 2s ease-in-out infinite}
@keyframes dw-enter-pulse{50%{opacity:.35}}
@media (max-width:600px){.dw-enter{right:16px;bottom:16px;padding:12px 18px;font-size:14px}}
@media (prefers-reduced-motion:reduce){.dw-enter__dot{animation:none}.dw-enter{transition:none}}
</style>
	<?php
}
