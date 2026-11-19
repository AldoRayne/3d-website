<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const DIGITAL_WORLD_REST_NS       = 'digital-world/v1';
const DIGITAL_WORLD_MAX_MESSAGE   = 500;
const DIGITAL_WORLD_MAX_HISTORY   = 6;
const DIGITAL_WORLD_RATE_LIMIT    = 20;
const DIGITAL_WORLD_RATE_WINDOW_S = 60;

add_action( 'rest_api_init', 'digital_world_register_routes' );

function digital_world_register_routes() {
	register_rest_route(
		DIGITAL_WORLD_REST_NS,
		'/world',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'digital_world_rest_world',
			'permission_callback' => '__return_true',
		)
	);

	register_rest_route(
		DIGITAL_WORLD_REST_NS,
		'/navigate',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'digital_world_rest_navigate',
			'permission_callback' => 'digital_world_rest_navigate_permission',
			'args'                => array(
				'message' => array(
					'type'              => 'string',
					'required'          => true,
					'sanitize_callback' => 'sanitize_textarea_field',
					'validate_callback' => static function ( $value ) {
						$length = mb_strlen( trim( (string) $value ) );
						return $length > 0 && $length <= DIGITAL_WORLD_MAX_MESSAGE;
					},
				),
				'history' => array(
					'type'    => 'array',
					'default' => array(),
					'items'   => array(
						'type'       => 'object',
						'properties' => array(
							'role'    => array(
								'type' => 'string',
								'enum' => array( 'user', 'assistant' ),
							),
							'content' => array( 'type' => 'string' ),
						),
					),
				),
			),
		)
	);

	register_rest_route(
		DIGITAL_WORLD_REST_NS,
		'/objects/(?P<id>\\d+)',
		array(
			'methods'             => WP_REST_Server::EDITABLE,
			'callback'            => 'digital_world_rest_update_object',
			'permission_callback' => 'digital_world_rest_can_edit',
			'args'                => array(
				'x'     => array(
					'type'    => 'integer',
					'minimum' => -DIGITAL_WORLD_MAX_RADIUS,
					'maximum' => DIGITAL_WORLD_MAX_RADIUS,
				),
				'z'     => array(
					'type'    => 'integer',
					'minimum' => -DIGITAL_WORLD_MAX_RADIUS,
					'maximum' => DIGITAL_WORLD_MAX_RADIUS,
				),
				'door'  => array(
					'type' => 'string',
					'enum' => array_keys( DIGITAL_WORLD_DOOR_SIDES ),
				),
				'seed'  => array(
					'type'    => 'integer',
					'minimum' => 1,
					'maximum' => DIGITAL_WORLD_MAX_SEED,
				),
				'color' => array(
					'type'    => 'string',
					'pattern' => '^#[0-9a-fA-F]{6}$',
				),
			),
		)
	);

	register_rest_route(
		DIGITAL_WORLD_REST_NS,
		'/settings',
		array(
			'methods'             => WP_REST_Server::EDITABLE,
			'callback'            => 'digital_world_rest_update_settings',
			'permission_callback' => 'digital_world_rest_can_edit',
			'args'                => array(
				'island_radius' => array(
					'type'     => 'integer',
					'required' => true,
					'minimum'  => DIGITAL_WORLD_MIN_RADIUS,
					'maximum'  => DIGITAL_WORLD_MAX_RADIUS,
				),
			),
		)
	);
}

function digital_world_rest_world() {
	return rest_ensure_response(
		array(
			'site'    => array(
				'name' => get_bloginfo( 'name' ),
				'home' => home_url( '/' ),
			),
			'ai'      => digital_world_ai_enabled(),
			'island'  => array( 'radius' => digital_world_island_radius() ),
			'objects' => digital_world_get_objects(),
		)
	);
}

function digital_world_rest_navigate_permission( WP_REST_Request $request ) {
	$nonce = $request->get_header( 'X-WP-Nonce' );
	if ( ! $nonce || ! wp_verify_nonce( $nonce, 'wp_rest' ) ) {
		return new WP_Error( 'digital_world_bad_nonce', 'Invalid or missing nonce.', array( 'status' => 403 ) );
	}

	$ip  = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : 'unknown';
	$key = 'dw_rl_' . md5( $ip );
	$hit = (int) get_transient( $key );
	if ( $hit >= DIGITAL_WORLD_RATE_LIMIT ) {
		return new WP_Error( 'digital_world_rate_limited', 'Too many requests. Try again in a minute.', array( 'status' => 429 ) );
	}
	set_transient( $key, $hit + 1, DIGITAL_WORLD_RATE_WINDOW_S );

	return true;
}

function digital_world_sanitize_history( $history ) {
	$clean = array();
	foreach ( (array) $history as $turn ) {
		$role    = $turn['role'] ?? '';
		$content = trim( sanitize_textarea_field( (string) ( $turn['content'] ?? '' ) ) );
		if ( ! in_array( $role, array( 'user', 'assistant' ), true ) || '' === $content ) {
			continue;
		}
		$content = mb_substr( $content, 0, DIGITAL_WORLD_MAX_MESSAGE );
		$last    = array_key_last( $clean );
		if ( null !== $last && $clean[ $last ]['role'] === $role ) {
			$clean[ $last ]['content'] = $content;
			continue;
		}
		$clean[] = array(
			'role'    => $role,
			'content' => $content,
		);
	}

	$clean = array_slice( $clean, -DIGITAL_WORLD_MAX_HISTORY );
	while ( $clean && 'user' !== $clean[0]['role'] ) {
		array_shift( $clean );
	}
	if ( $clean && 'user' === end( $clean )['role'] ) {
		array_pop( $clean );
	}

	return $clean;
}

function digital_world_rest_navigate( WP_REST_Request $request ) {
	$message = trim( (string) $request->get_param( 'message' ) );
	$history = digital_world_sanitize_history( $request->get_param( 'history' ) );

	return rest_ensure_response( digital_world_navigate( $message, $history ) );
}

function digital_world_rest_can_edit() {
	return current_user_can( 'manage_options' );
}

const DIGITAL_WORLD_EDITABLE_META = array(
	'x'     => 'dw_position_x',
	'z'     => 'dw_position_z',
	'door'  => 'dw_door_side',
	'seed'  => DIGITAL_WORLD_SEED_META,
	'color' => 'dw_color',
);

function digital_world_rest_update_object( WP_REST_Request $request ) {
	$post = get_post( (int) $request['id'] );
	if ( ! $post || DIGITAL_WORLD_CPT !== $post->post_type ) {
		return new WP_Error( 'digital_world_not_found', 'World object not found.', array( 'status' => 404 ) );
	}

	foreach ( DIGITAL_WORLD_EDITABLE_META as $param => $meta_key ) {
		if ( ! $request->has_param( $param ) ) {
			continue;
		}
		$value = $request->get_param( $param );
		if ( 'color' === $param ) {
			$value = sanitize_hex_color( $value );
		}
		update_post_meta( $post->ID, $meta_key, $value );
		if ( DIGITAL_WORLD_SEED_META !== $meta_key ) {
			update_post_meta( $post->ID, '_' . $meta_key, 'field_' . $meta_key );
		}
	}

	digital_world_flush_cache();
	return rest_ensure_response( digital_world_format_object( get_post( $post->ID ) ) );
}

function digital_world_rest_update_settings( WP_REST_Request $request ) {
	update_option( DIGITAL_WORLD_RADIUS_OPTION, (int) $request['island_radius'], false );
	return rest_ensure_response( array( 'island_radius' => digital_world_island_radius() ) );
}
