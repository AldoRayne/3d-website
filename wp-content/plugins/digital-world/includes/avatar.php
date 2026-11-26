<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const DIGITAL_WORLD_AVATAR_META  = 'dw_avatar';
const DIGITAL_WORLD_AVATAR_LIMIT = array( 60, MINUTE_IN_SECONDS );

add_action( 'rest_api_init', 'digital_world_register_avatar_routes' );

function digital_world_register_avatar_routes() {
	register_rest_route(
		DIGITAL_WORLD_REST_NS,
		'/avatar',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'digital_world_rest_get_avatar',
				'permission_callback' => 'digital_world_avatar_permission',
			),
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'callback'            => 'digital_world_rest_save_avatar',
				'permission_callback' => 'digital_world_avatar_permission',
				'args'                => array(
					'avatar' => array(
						'type'     => 'object',
						'required' => true,
					),
				),
			),
			array(
				'methods'             => WP_REST_Server::DELETABLE,
				'callback'            => 'digital_world_rest_reset_avatar',
				'permission_callback' => 'digital_world_avatar_permission',
			),
		)
	);
	register_rest_route(
		DIGITAL_WORLD_REST_NS,
		'/members/(?P<id>\\d+)/avatar',
		array(
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'callback'            => 'digital_world_rest_save_member_avatar',
				'permission_callback' => 'digital_world_member_avatar_permission',
				'args'                => array(
					'avatar' => array(
						'type'     => 'object',
						'required' => true,
					),
				),
			),
			array(
				'methods'             => WP_REST_Server::DELETABLE,
				'callback'            => 'digital_world_rest_reset_member_avatar',
				'permission_callback' => 'digital_world_member_avatar_permission',
			),
		)
	);
}

function digital_world_avatar_options() {
	static $options = null;
	if ( null === $options ) {
		$decoded = json_decode( (string) file_get_contents( DIGITAL_WORLD_DIR . 'includes/avatar-options.json' ), true );
		$options = is_array( $decoded ) ? $decoded : array();
	}
	return $options;
}

function digital_world_avatar_permission( WP_REST_Request $request ) {
	if ( ! digital_world_has_valid_nonce( $request ) ) {
		return new WP_Error( 'digital_world_bad_nonce', 'Сесія застаріла. Оновіть сторінку.', array( 'status' => 403 ) );
	}
	return is_user_logged_in()
		? true
		: new WP_Error( 'digital_world_not_signed_in', 'Увійдіть, щоб змінювати персонажа.', array( 'status' => 401 ) );
}

function digital_world_member_avatar_permission( WP_REST_Request $request ) {
	if ( ! digital_world_has_valid_nonce( $request ) ) {
		return new WP_Error( 'digital_world_bad_nonce', 'Сесія застаріла. Оновіть сторінку.', array( 'status' => 403 ) );
	}
	$user_id = (int) $request['id'];
	if ( ! current_user_can( 'edit_user', $user_id ) ) {
		return new WP_Error( 'digital_world_forbidden', 'Немає прав змінювати цього користувача.', array( 'status' => 403 ) );
	}
	return get_userdata( $user_id )
		? true
		: new WP_Error( 'digital_world_no_user', 'Користувача не знайдено.', array( 'status' => 404 ) );
}

function digital_world_clean_avatar( array $avatar ) {
	$options = digital_world_avatar_options();
	$clean   = array();
	foreach ( $avatar as $key => $value ) {
		if ( is_string( $key ) && isset( $options[ $key ] ) && in_array( $value, $options[ $key ], true ) ) {
			$clean[ $key ] = $value;
		}
	}
	return $clean;
}

function digital_world_user_avatar( $user_id ) {
	$stored = get_user_meta( $user_id, DIGITAL_WORLD_AVATAR_META, true );
	return (object) digital_world_clean_avatar( is_array( $stored ) ? $stored : array() );
}

function digital_world_avatar_response( $user_id ) {
	return rest_ensure_response( array( 'avatar' => digital_world_user_avatar( $user_id ) ) );
}

function digital_world_rest_get_avatar() {
	return digital_world_avatar_response( get_current_user_id() );
}

function digital_world_store_avatar( $user_id, $avatar ) {
	$avatar = (array) $avatar;
	$clean  = digital_world_clean_avatar( $avatar );
	if ( count( $clean ) !== count( $avatar ) ) {
		return new WP_Error( 'digital_world_bad_avatar', 'Персонаж містить невідомі параметри.', array( 'status' => 422 ) );
	}
	if ( $clean ) {
		update_user_meta( $user_id, DIGITAL_WORLD_AVATAR_META, $clean );
	} else {
		delete_user_meta( $user_id, DIGITAL_WORLD_AVATAR_META );
	}
	return digital_world_avatar_response( $user_id );
}

function digital_world_rest_save_avatar( WP_REST_Request $request ) {
	[ $limit, $window ] = DIGITAL_WORLD_AVATAR_LIMIT;
	if ( ! digital_world_take_rate_slot( 'avatar', $limit, $window ) ) {
		return new WP_Error( 'digital_world_rate_limited', 'Забагато змін. Спробуйте трохи пізніше.', array( 'status' => 429 ) );
	}
	return digital_world_store_avatar( get_current_user_id(), $request->get_param( 'avatar' ) );
}

function digital_world_rest_reset_avatar() {
	$user_id = get_current_user_id();
	delete_user_meta( $user_id, DIGITAL_WORLD_AVATAR_META );
	return digital_world_avatar_response( $user_id );
}

function digital_world_rest_save_member_avatar( WP_REST_Request $request ) {
	return digital_world_store_avatar( (int) $request['id'], $request->get_param( 'avatar' ) );
}

function digital_world_rest_reset_member_avatar( WP_REST_Request $request ) {
	$user_id = (int) $request['id'];
	delete_user_meta( $user_id, DIGITAL_WORLD_AVATAR_META );
	return digital_world_avatar_response( $user_id );
}
