<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const DIGITAL_WORLD_LAYOUT_META   = 'dw_layout';
const DIGITAL_WORLD_LAYOUT_LIMIT  = array( 60, MINUTE_IN_SECONDS );
const DIGITAL_WORLD_LAYOUT_SIDES  = array( 'north', 'east', 'south', 'west' );

add_action( 'rest_api_init', 'digital_world_register_layout_routes' );

function digital_world_register_layout_routes() {
	register_rest_route(
		DIGITAL_WORLD_REST_NS,
		'/layout',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'digital_world_rest_get_layout',
				'permission_callback' => 'digital_world_layout_permission',
			),
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'callback'            => 'digital_world_rest_save_layout',
				'permission_callback' => 'digital_world_layout_permission',
				'args'                => array(
					'layout' => array(
						'type'     => 'object',
						'required' => true,
					),
				),
			),
			array(
				'methods'             => WP_REST_Server::DELETABLE,
				'callback'            => 'digital_world_rest_reset_layout',
				'permission_callback' => 'digital_world_layout_permission',
			),
		)
	);
}

function digital_world_layout_permission( WP_REST_Request $request ) {
	if ( ! digital_world_has_valid_nonce( $request ) ) {
		return new WP_Error( 'digital_world_bad_nonce', 'Сесія застаріла. Оновіть сторінку.', array( 'status' => 403 ) );
	}
	return is_user_logged_in()
		? true
		: new WP_Error( 'digital_world_not_signed_in', 'Увійдіть, щоб змінювати свій острів.', array( 'status' => 401 ) );
}

function digital_world_user_layout( $user_id ) {
	$stored = get_user_meta( $user_id, DIGITAL_WORLD_LAYOUT_META, true );
	return digital_world_clean_layout( is_array( $stored ) ? $stored : array() );
}

function digital_world_clean_layout( array $layout ) {
	$known  = array_flip( array_column( digital_world_get_objects(), 'slug' ) );
	$radius = digital_world_island_radius();
	$clean  = array();
	foreach ( $layout as $slug => $entry ) {
		if ( ! is_string( $slug ) || ! isset( $known[ $slug ] ) || ! is_array( $entry ) ) {
			continue;
		}
		$x    = $entry['x'] ?? null;
		$z    = $entry['z'] ?? null;
		$door = $entry['door'] ?? null;
		if ( ! is_int( $x ) || ! is_int( $z ) || ! in_array( $door, DIGITAL_WORLD_LAYOUT_SIDES, true ) || hypot( $x, $z ) > $radius ) {
			continue;
		}
		$clean[ $slug ] = array(
			'x'    => $x,
			'z'    => $z,
			'door' => $door,
		);
	}
	return $clean;
}

function digital_world_visit_boot() {
	$user_id = isset( $_GET['visit'] ) ? absint( wp_unslash( $_GET['visit'] ) ) : 0;
	if ( ! $user_id || ! current_user_can( 'list_users' ) ) {
		return null;
	}
	$user = get_user_by( 'id', $user_id );
	if ( ! $user ) {
		return null;
	}
	return array(
		'id'        => $user->ID,
		'name'      => $user->display_name,
		'layout'    => (object) digital_world_user_layout( $user->ID ),
		'avatar'    => digital_world_user_avatar( $user->ID ),
		'returnUrl' => digital_world_island_preview_url( $user->ID ),
	);
}

function digital_world_layout_response( $user_id ) {
	return rest_ensure_response( array( 'layout' => (object) digital_world_user_layout( $user_id ) ) );
}

function digital_world_rest_get_layout() {
	return digital_world_layout_response( get_current_user_id() );
}

function digital_world_rest_save_layout( WP_REST_Request $request ) {
	[ $limit, $window ] = DIGITAL_WORLD_LAYOUT_LIMIT;
	if ( ! digital_world_take_rate_slot( 'layout', $limit, $window ) ) {
		return new WP_Error( 'digital_world_rate_limited', 'Забагато змін. Спробуйте трохи пізніше.', array( 'status' => 429 ) );
	}
	$layout = (array) $request->get_param( 'layout' );
	$clean  = digital_world_clean_layout( $layout );
	if ( count( $clean ) !== count( $layout ) ) {
		return new WP_Error( 'digital_world_bad_layout', 'Розкладка містить невідомі будинки або місця поза островом.', array( 'status' => 422 ) );
	}
	$user_id = get_current_user_id();
	if ( $clean ) {
		update_user_meta( $user_id, DIGITAL_WORLD_LAYOUT_META, $clean );
	} else {
		delete_user_meta( $user_id, DIGITAL_WORLD_LAYOUT_META );
	}
	return digital_world_layout_response( $user_id );
}

function digital_world_rest_reset_layout() {
	$user_id = get_current_user_id();
	delete_user_meta( $user_id, DIGITAL_WORLD_LAYOUT_META );
	return digital_world_layout_response( $user_id );
}
