<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const DIGITAL_WORLD_INVITE_META     = 'dw_island_invite';
const DIGITAL_WORLD_INVITE_PATTERN  = '/^[A-Za-z0-9]{16}$/';
const DIGITAL_WORLD_REALTIME_TTL    = 60;
const DIGITAL_WORLD_REALTIME_LIMIT  = array( 30, MINUTE_IN_SECONDS );
const DIGITAL_WORLD_INVITE_LIMIT    = array( 10, MINUTE_IN_SECONDS );

add_action( 'rest_api_init', 'digital_world_register_realtime_routes' );

function digital_world_realtime_url() {
	return defined( 'DIGITAL_WORLD_REALTIME_URL' ) ? (string) DIGITAL_WORLD_REALTIME_URL : '';
}

function digital_world_realtime_secret() {
	return defined( 'DIGITAL_WORLD_REALTIME_SECRET' ) ? (string) DIGITAL_WORLD_REALTIME_SECRET : '';
}

function digital_world_realtime_enabled() {
	return '' !== digital_world_realtime_url() && strlen( digital_world_realtime_secret() ) >= 32;
}

function digital_world_register_realtime_routes() {
	register_rest_route(
		DIGITAL_WORLD_REST_NS,
		'/realtime/token',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'digital_world_rest_realtime_token',
			'permission_callback' => 'digital_world_nonce_permission',
			'args'                => array(
				'room'   => array(
					'type'     => 'string',
					'required' => true,
				),
				'invite' => array(
					'type'    => 'string',
					'default' => '',
				),
			),
		)
	);
	register_rest_route(
		DIGITAL_WORLD_REST_NS,
		'/invite',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'digital_world_rest_get_invite',
				'permission_callback' => 'digital_world_layout_permission',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => 'digital_world_rest_rotate_invite',
				'permission_callback' => 'digital_world_layout_permission',
			),
			array(
				'methods'             => WP_REST_Server::DELETABLE,
				'callback'            => 'digital_world_rest_revoke_invite',
				'permission_callback' => 'digital_world_layout_permission',
			),
		)
	);
}

function digital_world_nonce_permission( WP_REST_Request $request ) {
	return digital_world_has_valid_nonce( $request )
		? true
		: new WP_Error( 'digital_world_bad_nonce', 'Сесія застаріла. Оновіть сторінку.', array( 'status' => 403 ) );
}

function digital_world_invite_url( $code ) {
	return add_query_arg( 'island', rawurlencode( $code ), digital_world_url() );
}

function digital_world_invite_owner( $code ) {
	if ( ! is_string( $code ) || ! preg_match( DIGITAL_WORLD_INVITE_PATTERN, $code ) ) {
		return 0;
	}
	$users = get_users(
		array(
			'meta_key'   => DIGITAL_WORLD_INVITE_META,
			'meta_value' => $code,
			'number'     => 1,
			'fields'     => 'ID',
		)
	);
	return $users ? (int) $users[0] : 0;
}

function digital_world_invite_response( $user_id ) {
	$code = (string) get_user_meta( $user_id, DIGITAL_WORLD_INVITE_META, true );
	return rest_ensure_response( array( 'url' => $code ? digital_world_invite_url( $code ) : null ) );
}

function digital_world_rest_get_invite() {
	return digital_world_invite_response( get_current_user_id() );
}

function digital_world_rest_rotate_invite() {
	[ $limit, $window ] = DIGITAL_WORLD_INVITE_LIMIT;
	if ( ! digital_world_take_rate_slot( 'invite', $limit, $window ) ) {
		return new WP_Error( 'digital_world_rate_limited', 'Забагато спроб. Спробуйте трохи пізніше.', array( 'status' => 429 ) );
	}
	$user_id = get_current_user_id();
	update_user_meta( $user_id, DIGITAL_WORLD_INVITE_META, wp_generate_password( 16, false, false ) );
	return digital_world_invite_response( $user_id );
}

function digital_world_rest_revoke_invite() {
	$user_id = get_current_user_id();
	delete_user_meta( $user_id, DIGITAL_WORLD_INVITE_META );
	return digital_world_invite_response( $user_id );
}

function digital_world_invite_boot() {
	$code    = isset( $_GET['island'] ) ? sanitize_text_field( wp_unslash( $_GET['island'] ) ) : '';
	$user_id = digital_world_invite_owner( $code );
	if ( ! $user_id || get_current_user_id() === $user_id ) {
		return null;
	}
	$user = get_user_by( 'id', $user_id );
	if ( ! $user ) {
		return null;
	}
	return array(
		'kind'      => 'invite',
		'id'        => $user->ID,
		'name'      => $user->display_name,
		'layout'    => (object) digital_world_user_layout( $user->ID ),
		'returnUrl' => digital_world_url(),
		'invite'    => $code,
	);
}

function digital_world_can_join_room( $room, $invite ) {
	if ( 'public' === $room ) {
		return true;
	}
	if ( ! preg_match( '/^island:([1-9]\d{0,9})$/', $room, $match ) ) {
		return false;
	}
	$owner = (int) $match[1];
	if ( get_current_user_id() === $owner || current_user_can( 'list_users' ) ) {
		return true;
	}
	return '' !== $invite && digital_world_invite_owner( $invite ) === $owner;
}

function digital_world_rest_realtime_token( WP_REST_Request $request ) {
	if ( ! digital_world_realtime_enabled() ) {
		return new WP_Error( 'digital_world_realtime_off', 'Спільний світ вимкнено.', array( 'status' => 404 ) );
	}
	[ $limit, $window ] = DIGITAL_WORLD_REALTIME_LIMIT;
	if ( ! digital_world_take_rate_slot( 'realtime', $limit, $window ) ) {
		return new WP_Error( 'digital_world_rate_limited', 'Забагато спроб підключення.', array( 'status' => 429 ) );
	}
	$room   = (string) $request->get_param( 'room' );
	$invite = (string) $request->get_param( 'invite' );
	if ( ! digital_world_can_join_room( $room, $invite ) ) {
		return new WP_Error( 'digital_world_room_forbidden', 'Немає доступу до цього острова.', array( 'status' => 403 ) );
	}
	$user    = wp_get_current_user();
	$payload = rtrim(
		strtr(
			base64_encode(
				wp_json_encode(
					array(
						'room' => $room,
						'uid'  => (int) $user->ID,
						'name' => $user->ID ? $user->display_name : '',
						'exp'  => time() + DIGITAL_WORLD_REALTIME_TTL,
					)
				)
			),
			'+/',
			'-_'
		),
		'='
	);
	$signature = rtrim( strtr( base64_encode( hash_hmac( 'sha256', $payload, digital_world_realtime_secret(), true ) ), '+/', '-_' ), '=' );
	return rest_ensure_response(
		array(
			'url'   => digital_world_realtime_url(),
			'token' => $payload . '.' . $signature,
		)
	);
}
