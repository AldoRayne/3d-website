<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const DIGITAL_WORLD_CACHE_KEY = 'digital_world_objects';

add_action( 'save_post', 'digital_world_flush_cache' );
add_action( 'deleted_post', 'digital_world_flush_cache' );
add_action( 'acf/save_post', 'digital_world_flush_cache', 20 );

function digital_world_flush_cache() {
	delete_transient( DIGITAL_WORLD_CACHE_KEY );
}

function digital_world_has_objects() {
	$ids = get_posts(
		array(
			'post_type'      => DIGITAL_WORLD_CPT,
			'post_status'    => 'any',
			'posts_per_page' => 1,
			'fields'         => 'ids',
		)
	);
	return ! empty( $ids );
}

function digital_world_get_objects() {
	$cached = get_transient( DIGITAL_WORLD_CACHE_KEY );
	if ( is_array( $cached ) ) {
		return $cached;
	}

	$posts = get_posts(
		array(
			'post_type'      => DIGITAL_WORLD_CPT,
			'post_status'    => 'publish',
			'posts_per_page' => 200,
			'orderby'        => array(
				'menu_order' => 'ASC',
				'title'      => 'ASC',
			),
		)
	);

	$objects = array_map( 'digital_world_format_object', $posts );
	set_transient( DIGITAL_WORLD_CACHE_KEY, $objects, HOUR_IN_SECONDS );

	return $objects;
}

function digital_world_format_object( WP_Post $post ) {
	$type      = get_post_meta( $post->ID, 'dw_object_type', true );
	$animation = get_post_meta( $post->ID, 'dw_animation', true );
	$color     = sanitize_hex_color( get_post_meta( $post->ID, 'dw_color', true ) );
	$scale     = (float) get_post_meta( $post->ID, 'dw_scale', true );
	$page_id   = (int) get_post_meta( $post->ID, 'dw_linked_page', true );
	$model_id  = (int) get_post_meta( $post->ID, 'dw_model', true );
	$page      = $page_id ? get_post( $page_id ) : null;

	$description = trim( (string) get_post_meta( $post->ID, 'dw_description', true ) );
	if ( '' === $description && $page ) {
		$description = wp_trim_words( wp_strip_all_tags( $page->post_excerpt ?: $page->post_content ), 40 );
	}

	$keywords = array_values(
		array_filter(
			array_map( 'trim', explode( ',', (string) get_post_meta( $post->ID, 'dw_keywords', true ) ) )
		)
	);

	return array(
		'id'          => $post->ID,
		'slug'        => $post->post_name,
		'title'       => get_the_title( $post ),
		'type'        => isset( DIGITAL_WORLD_TYPES[ $type ] ) ? $type : 'building',
		'description' => $description,
		'keywords'    => $keywords,
		'color'       => $color ?: '#3498db',
		'animation'   => isset( DIGITAL_WORLD_ANIMATIONS[ $animation ] ) ? $animation : 'none',
		'scale'       => $scale > 0 ? $scale : 1.0,
		'position'    => array(
			'x' => (float) get_post_meta( $post->ID, 'dw_position_x', true ),
			'y' => (float) get_post_meta( $post->ID, 'dw_position_y', true ),
			'z' => (float) get_post_meta( $post->ID, 'dw_position_z', true ),
		),
		'model'       => $model_id ? wp_get_attachment_url( $model_id ) : null,
		'page_id'     => $page ? $page->ID : null,
		'url'         => $page && 'publish' === $page->post_status ? get_permalink( $page ) : null,
		'page_title'  => $page ? get_the_title( $page ) : null,
	);
}
