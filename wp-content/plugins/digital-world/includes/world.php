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
	$door      = get_post_meta( $post->ID, 'dw_door_side', true );
	$color     = sanitize_hex_color( get_post_meta( $post->ID, 'dw_color', true ) );
	$page_id   = (int) get_post_meta( $post->ID, 'dw_linked_page', true );
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
		'seed'        => digital_world_building_seed( $post->ID ),
		'description' => $description,
		'keywords'    => $keywords,
		'color'       => $color ?: '#3498db',
		'door'        => isset( DIGITAL_WORLD_DOOR_SIDES[ $door ] ) ? $door : 'auto',
		'position'    => array(
			'x' => (float) get_post_meta( $post->ID, 'dw_position_x', true ),
			'z' => (float) get_post_meta( $post->ID, 'dw_position_z', true ),
		),
		'page_id'     => $page ? $page->ID : null,
		'url'         => $page && 'publish' === $page->post_status ? get_permalink( $page ) : null,
		'page_title'  => $page ? get_the_title( $page ) : null,
	);
}

const DIGITAL_WORLD_RADIUS_OPTION = 'digital_world_island_radius';
const DIGITAL_WORLD_MIN_RADIUS    = 16;
const DIGITAL_WORLD_MAX_RADIUS    = 60;

function digital_world_island_radius() {
	$stored = (int) get_option( DIGITAL_WORLD_RADIUS_OPTION, 0 );
	if ( $stored ) {
		return max( DIGITAL_WORLD_MIN_RADIUS, min( DIGITAL_WORLD_MAX_RADIUS, $stored ) );
	}
	$radius = 22;
	foreach ( digital_world_get_objects() as $object ) {
		$radius = max( $radius, (int) ceil( hypot( $object['position']['x'], $object['position']['z'] ) + 9 ) );
	}
	return min( DIGITAL_WORLD_MAX_RADIUS, $radius );
}

const DIGITAL_WORLD_SEED_META = 'dw_building_seed';
const DIGITAL_WORLD_MAX_SEED  = 2147483647;

function digital_world_building_seed( $post_id ) {
	$seed = (int) get_post_meta( $post_id, DIGITAL_WORLD_SEED_META, true );
	if ( $seed > 0 && $seed <= DIGITAL_WORLD_MAX_SEED ) {
		return $seed;
	}
	return ( crc32( 'digital-world-' . $post_id ) % ( DIGITAL_WORLD_MAX_SEED - 1 ) ) + 1;
}
