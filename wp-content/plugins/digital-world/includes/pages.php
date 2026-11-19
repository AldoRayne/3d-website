<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const DIGITAL_WORLD_PAGE_ENTRY = 'src/page.ts';

add_filter( 'render_block', 'digital_world_mark_block', 10, 2 );
add_action( 'wp_head', 'digital_world_page_head', 1 );
add_action( 'wp_enqueue_scripts', 'digital_world_enqueue_page' );

function digital_world_pages_enabled() {
	if ( is_admin() || wp_doing_ajax() || is_feed() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) {
		return false;
	}
	return ! digital_world_is_world_request();
}

function digital_world_mark_block( $html, $block ) {
	if ( empty( $block['blockName'] ) || '' === trim( $html ) || ! digital_world_pages_enabled() ) {
		return $html;
	}
	static $seen = array();
	$base          = substr( md5( $block['blockName'] . '|' . $html ), 0, 10 );
	$seen[ $base ] = ( $seen[ $base ] ?? 0 ) + 1;

	$tags = new WP_HTML_Tag_Processor( $html );
	if ( ! $tags->next_tag() ) {
		return $html;
	}
	$tags->set_attribute( 'data-dw-block', $seen[ $base ] > 1 ? $base . '-' . $seen[ $base ] : $base );
	$tags->set_attribute( 'data-dw-type', $block['blockName'] );
	return $tags->get_updated_html();
}

function digital_world_page_head() {
	if ( ! digital_world_pages_enabled() ) {
		return;
	}
	wp_print_inline_script_tag(
		'try{if(innerWidth>=600&&localStorage.getItem("dw-layout:"+location.pathname)){var d=document.documentElement;d.classList.add("dw-layout-pending");setTimeout(function(){d.classList.remove("dw-layout-pending")},2500)}}catch(e){}'
	);
}

function digital_world_enqueue_page() {
	if ( digital_world_pages_enabled() ) {
		digital_world_enqueue_entry( 'digital-world-page', DIGITAL_WORLD_PAGE_ENTRY );
	}
}
