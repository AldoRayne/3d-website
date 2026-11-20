<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const DIGITAL_WORLD_MEMBER_ROLE        = 'subscriber';
const DIGITAL_WORLD_LEGACY_ROLE        = 'dw_member';
const DIGITAL_WORLD_SOURCE_META        = 'dw_source';
const DIGITAL_WORLD_SOURCE_BOOK        = 'book';
const DIGITAL_WORLD_BOOK_LOGIN_LIMIT   = 'edit_posts';
const DIGITAL_WORLD_REGISTRATION_OPTION = 'digital_world_registration_open';
const DIGITAL_WORLD_CONSENT_META       = 'dw_consent_at';
const DIGITAL_WORLD_LAST_LOGIN_META    = 'dw_last_login';
const DIGITAL_WORLD_MIN_PASSWORD       = 8;
const DIGITAL_WORLD_MAX_PASSWORD       = 128;
const DIGITAL_WORLD_MAX_NAME           = 60;
const DIGITAL_WORLD_MAX_EMAIL          = 100;
const DIGITAL_WORLD_AUTH_LIMITS        = array(
	'login'    => array( 5, MINUTE_IN_SECONDS ),
	'register' => array( 3, 10 * MINUTE_IN_SECONDS ),
);
const DIGITAL_WORLD_TURNSTILE_VERIFY   = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

add_action( 'rest_api_init', 'digital_world_register_auth_routes' );
add_action( 'set_logged_in_cookie', 'digital_world_expose_logged_in_cookie' );
add_action( 'wp_login', 'digital_world_track_login', 10, 2 );
add_filter( 'wp_privacy_personal_data_exporters', 'digital_world_register_privacy_exporter' );
add_action( 'admin_init', 'digital_world_keep_subscribers_out_of_admin' );
add_filter( 'login_redirect', 'digital_world_subscriber_login_redirect', 10, 3 );

function digital_world_migrate_members() {
	if ( ! get_role( DIGITAL_WORLD_LEGACY_ROLE ) ) {
		return;
	}
	foreach ( get_users( array( 'role' => DIGITAL_WORLD_LEGACY_ROLE ) ) as $user ) {
		$user->remove_role( DIGITAL_WORLD_LEGACY_ROLE );
		if ( ! $user->roles ) {
			$user->add_role( DIGITAL_WORLD_MEMBER_ROLE );
		}
		update_user_meta( $user->ID, DIGITAL_WORLD_SOURCE_META, DIGITAL_WORLD_SOURCE_BOOK );
	}
	remove_role( DIGITAL_WORLD_LEGACY_ROLE );
}

function digital_world_books_login( WP_User $user ) {
	return ! user_can( $user, DIGITAL_WORLD_BOOK_LOGIN_LIMIT );
}

function digital_world_keep_subscribers_out_of_admin() {
	global $pagenow;
	if ( wp_doing_ajax() || 'admin-post.php' === $pagenow || ! is_user_logged_in() ) {
		return;
	}
	if ( digital_world_books_login( wp_get_current_user() ) ) {
		wp_safe_redirect( digital_world_url() );
		exit;
	}
}

function digital_world_subscriber_login_redirect( $redirect_to, $requested, $user ) {
	if ( $user instanceof WP_User && digital_world_books_login( $user ) && str_starts_with( $redirect_to, admin_url() ) ) {
		return digital_world_url();
	}
	return $redirect_to;
}

function digital_world_registration_open() {
	return '0' !== (string) get_option( DIGITAL_WORLD_REGISTRATION_OPTION, '1' );
}

function digital_world_turnstile_site_key() {
	return defined( 'DIGITAL_WORLD_TURNSTILE_SITE_KEY' ) ? (string) DIGITAL_WORLD_TURNSTILE_SITE_KEY : '';
}

function digital_world_turnstile_secret() {
	return defined( 'DIGITAL_WORLD_TURNSTILE_SECRET_KEY' ) ? (string) DIGITAL_WORLD_TURNSTILE_SECRET_KEY : '';
}

function digital_world_turnstile_enabled() {
	return '' !== digital_world_turnstile_site_key() && '' !== digital_world_turnstile_secret();
}

function digital_world_member_payload( $user = null ) {
	$user = $user ?: wp_get_current_user();
	if ( ! $user || ! $user->exists() ) {
		return null;
	}
	return array(
		'id'       => $user->ID,
		'name'     => $user->display_name,
		'canAdmin' => user_can( $user, DIGITAL_WORLD_BOOK_LOGIN_LIMIT ),
		'layout'   => (object) digital_world_user_layout( $user->ID ),
	);
}

function digital_world_auth_boot_data() {
	return array(
		'user'             => digital_world_member_payload(),
		'registrationOpen' => digital_world_registration_open(),
		'turnstileSiteKey' => digital_world_turnstile_enabled() ? digital_world_turnstile_site_key() : '',
		'lostPasswordUrl'  => wp_lostpassword_url( digital_world_url() ),
		'privacyUrl'       => get_privacy_policy_url(),
		'adminUrl'         => admin_url(),
		'adminLoginUrl'    => wp_login_url( admin_url() ),
		'minPassword'      => DIGITAL_WORLD_MIN_PASSWORD,
	);
}

function digital_world_register_auth_routes() {
	$credentials = array(
		'email'     => array(
			'type'     => 'string',
			'required' => true,
		),
		'password'  => array(
			'type'     => 'string',
			'required' => true,
		),
		'remember'  => array(
			'type'    => 'boolean',
			'default' => false,
		),
		'turnstile' => array(
			'type'    => 'string',
			'default' => '',
		),
	);

	register_rest_route(
		DIGITAL_WORLD_REST_NS,
		'/auth/register',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'digital_world_rest_register',
			'permission_callback' => static fn( WP_REST_Request $request ) => digital_world_auth_guest_permission( $request, 'register' ),
			'args'                => $credentials + array(
				'name'    => array(
					'type'     => 'string',
					'required' => true,
				),
				'consent' => array(
					'type'    => 'boolean',
					'default' => false,
				),
			),
		)
	);

	register_rest_route(
		DIGITAL_WORLD_REST_NS,
		'/auth/login',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'digital_world_rest_login',
			'permission_callback' => static fn( WP_REST_Request $request ) => digital_world_auth_guest_permission( $request, 'login' ),
			'args'                => $credentials,
		)
	);

	register_rest_route(
		DIGITAL_WORLD_REST_NS,
		'/auth/logout',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'digital_world_rest_logout',
			'permission_callback' => 'digital_world_auth_logout_permission',
		)
	);
}

function digital_world_has_valid_nonce( WP_REST_Request $request ) {
	$nonce = $request->get_header( 'X-WP-Nonce' );
	return $nonce && wp_verify_nonce( $nonce, 'wp_rest' );
}

function digital_world_client_ip() {
	return isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : 'unknown';
}

function digital_world_take_rate_slot( $bucket, $limit, $window ) {
	$key = 'dw_rl_' . $bucket . '_' . md5( digital_world_client_ip() );
	$hit = (int) get_transient( $key );
	if ( $hit >= $limit ) {
		return false;
	}
	set_transient( $key, $hit + 1, $window );
	return true;
}

function digital_world_auth_guest_permission( WP_REST_Request $request, $action ) {
	if ( ! digital_world_has_valid_nonce( $request ) ) {
		return new WP_Error( 'digital_world_bad_nonce', 'Сесія застаріла. Оновіть сторінку.', array( 'status' => 403 ) );
	}
	if ( is_user_logged_in() ) {
		return new WP_Error( 'digital_world_already_signed_in', 'Ви вже увійшли.', array( 'status' => 409 ) );
	}
	if ( 'register' === $action && ! digital_world_registration_open() ) {
		return new WP_Error( 'digital_world_registration_closed', 'Реєстрацію закрито.', array( 'status' => 403 ) );
	}
	return true;
}

function digital_world_take_auth_slot( $action ) {
	[ $limit, $window ] = DIGITAL_WORLD_AUTH_LIMITS[ $action ];
	return digital_world_take_rate_slot( $action, $limit, $window )
		? true
		: new WP_Error( 'digital_world_rate_limited', 'Забагато спроб. Спробуйте трохи пізніше.', array( 'status' => 429 ) );
}

function digital_world_auth_logout_permission( WP_REST_Request $request ) {
	if ( ! digital_world_has_valid_nonce( $request ) ) {
		return new WP_Error( 'digital_world_bad_nonce', 'Сесія застаріла. Оновіть сторінку.', array( 'status' => 403 ) );
	}
	return is_user_logged_in()
		? true
		: new WP_Error( 'digital_world_not_signed_in', 'Ви не увійшли.', array( 'status' => 401 ) );
}

function digital_world_field_errors( array $fields ) {
	return new WP_Error(
		'digital_world_invalid_fields',
		reset( $fields ),
		array(
			'status' => 422,
			'fields' => $fields,
		)
	);
}

function digital_world_verify_turnstile( $token ) {
	if ( ! digital_world_turnstile_enabled() ) {
		return true;
	}
	if ( '' === $token ) {
		return new WP_Error( 'digital_world_turnstile', 'Підтвердіть, що ви не робот.', array( 'status' => 400 ) );
	}
	$response = wp_remote_post(
		DIGITAL_WORLD_TURNSTILE_VERIFY,
		array(
			'timeout' => 10,
			'body'    => array(
				'secret'   => digital_world_turnstile_secret(),
				'response' => $token,
				'remoteip' => digital_world_client_ip(),
			),
		)
	);
	if ( is_wp_error( $response ) ) {
		return new WP_Error( 'digital_world_turnstile_unavailable', 'Не вдалося перевірити захист від ботів. Спробуйте ще раз.', array( 'status' => 503 ) );
	}
	$body = json_decode( (string) wp_remote_retrieve_body( $response ), true );
	return ! empty( $body['success'] )
		? true
		: new WP_Error( 'digital_world_turnstile', 'Перевірка не пройдена. Спробуйте ще раз.', array( 'status' => 400 ) );
}

function digital_world_unique_login( $email ) {
	$base = sanitize_user( strstr( $email, '@', true ), true );
	$base = substr( '' !== $base ? $base : 'member', 0, 50 );
	$login = $base;
	for ( $suffix = 2; username_exists( $login ); $suffix++ ) {
		$login = $base . $suffix;
	}
	return $login;
}

function digital_world_rest_register( WP_REST_Request $request ) {
	$name     = trim( sanitize_text_field( (string) $request['name'] ) );
	$email    = trim( (string) $request['email'] );
	$password = (string) $request['password'];
	$errors   = array();

	if ( '' === $name ) {
		$errors['name'] = 'Вкажіть імʼя.';
	} elseif ( mb_strlen( $name ) > DIGITAL_WORLD_MAX_NAME ) {
		$errors['name'] = sprintf( 'Імʼя задовге: максимум %d символів.', DIGITAL_WORLD_MAX_NAME );
	}

	if ( '' === $email ) {
		$errors['email'] = 'Вкажіть email.';
	} elseif ( strlen( $email ) > DIGITAL_WORLD_MAX_EMAIL || ! is_email( $email ) ) {
		$errors['email'] = 'Схоже, email написано з помилкою.';
	} elseif ( email_exists( $email ) ) {
		$errors['email'] = 'Цей email уже зареєстровано. Спробуйте увійти.';
	}

	$length = mb_strlen( $password );
	if ( $length < DIGITAL_WORLD_MIN_PASSWORD ) {
		$errors['password'] = sprintf( 'Пароль має містити щонайменше %d символів.', DIGITAL_WORLD_MIN_PASSWORD );
	} elseif ( $length > DIGITAL_WORLD_MAX_PASSWORD ) {
		$errors['password'] = 'Пароль задовгий.';
	} elseif ( '' === trim( $password ) ) {
		$errors['password'] = 'Пароль не може складатися з пробілів.';
	}

	if ( ! $request['consent'] ) {
		$errors['consent'] = 'Потрібна згода з умовами.';
	}

	if ( $errors ) {
		return digital_world_field_errors( $errors );
	}

	$slot = digital_world_take_auth_slot( 'register' );
	if ( is_wp_error( $slot ) ) {
		return $slot;
	}

	$turnstile = digital_world_verify_turnstile( (string) $request['turnstile'] );
	if ( is_wp_error( $turnstile ) ) {
		return $turnstile;
	}

	$user_id = wp_insert_user(
		array(
			'user_login'   => digital_world_unique_login( $email ),
			'user_email'   => $email,
			'user_pass'    => $password,
			'display_name' => $name,
			'nickname'     => $name,
			'first_name'   => $name,
			'role'         => DIGITAL_WORLD_MEMBER_ROLE,
		)
	);
	if ( is_wp_error( $user_id ) ) {
		return new WP_Error( 'digital_world_register_failed', 'Не вдалося зареєструватися. Спробуйте ще раз.', array( 'status' => 500 ) );
	}

	update_user_meta( $user_id, DIGITAL_WORLD_SOURCE_META, DIGITAL_WORLD_SOURCE_BOOK );
	update_user_meta( $user_id, DIGITAL_WORLD_CONSENT_META, gmdate( 'c' ) );
	update_user_meta( $user_id, DIGITAL_WORLD_LAST_LOGIN_META, gmdate( 'c' ) );
	wp_new_user_notification( $user_id, null, 'admin' );

	$user = get_user_by( 'id', $user_id );
	wp_set_current_user( $user_id );
	wp_set_auth_cookie( $user_id, (bool) $request['remember'], is_ssl() );

	return digital_world_auth_response( $user, 201 );
}

function digital_world_rest_login( WP_REST_Request $request ) {
	$email    = trim( (string) $request['email'] );
	$password = (string) $request['password'];

	$errors = array();
	if ( '' === $email ) {
		$errors['email'] = 'Вкажіть email.';
	}
	if ( '' === $password ) {
		$errors['password'] = 'Вкажіть пароль.';
	}
	if ( $errors ) {
		return digital_world_field_errors( $errors );
	}

	$slot = digital_world_take_auth_slot( 'login' );
	if ( is_wp_error( $slot ) ) {
		return $slot;
	}

	$turnstile = digital_world_verify_turnstile( (string) $request['turnstile'] );
	if ( is_wp_error( $turnstile ) ) {
		return $turnstile;
	}

	$user = wp_authenticate( $email, $password );
	if ( is_wp_error( $user ) ) {
		return new WP_Error( 'digital_world_bad_credentials', 'Невірний email або пароль.', array( 'status' => 401 ) );
	}
	if ( ! digital_world_books_login( $user ) ) {
		return new WP_Error(
			'digital_world_use_admin_login',
			'Адміністратори та редактори входять через сторінку входу WordPress.',
			array(
				'status'   => 403,
				'loginUrl' => wp_login_url( admin_url() ),
			)
		);
	}

	wp_set_auth_cookie( $user->ID, (bool) $request['remember'], is_ssl() );
	wp_set_current_user( $user->ID );
	do_action( 'wp_login', $user->user_login, $user );
	return digital_world_auth_response( $user, 200 );
}

function digital_world_rest_logout() {
	wp_logout();
	wp_set_current_user( 0 );
	unset( $_COOKIE[ LOGGED_IN_COOKIE ] );
	return rest_ensure_response(
		array(
			'user'  => null,
			'nonce' => wp_create_nonce( 'wp_rest' ),
		)
	);
}

function digital_world_auth_response( WP_User $user, $status ) {
	$response = rest_ensure_response(
		array(
			'user'  => digital_world_member_payload( $user ),
			'nonce' => wp_create_nonce( 'wp_rest' ),
		)
	);
	$response->set_status( $status );
	return $response;
}

function digital_world_expose_logged_in_cookie( $cookie ) {
	$_COOKIE[ LOGGED_IN_COOKIE ] = $cookie;
}

function digital_world_track_login( $login, $user ) {
	update_user_meta( $user->ID, DIGITAL_WORLD_LAST_LOGIN_META, gmdate( 'c' ) );
}

function digital_world_register_privacy_exporter( $exporters ) {
	$exporters['digital-world'] = array(
		'exporter_friendly_name' => 'Digital World',
		'callback'               => 'digital_world_export_personal_data',
	);
	return $exporters;
}

function digital_world_export_personal_data( $email ) {
	$user = get_user_by( 'email', $email );
	$data = array();
	if ( $user ) {
		$fields = array_filter(
			array(
				array(
					'name'  => 'Джерело реєстрації',
					'value' => DIGITAL_WORLD_SOURCE_BOOK === get_user_meta( $user->ID, DIGITAL_WORLD_SOURCE_META, true ) ? 'Книга гостей Digital World' : '',
				),
				array(
					'name'  => 'Згода з умовами',
					'value' => get_user_meta( $user->ID, DIGITAL_WORLD_CONSENT_META, true ),
				),
				array(
					'name'  => 'Останній вхід',
					'value' => get_user_meta( $user->ID, DIGITAL_WORLD_LAST_LOGIN_META, true ),
				),
			),
			static fn( $field ) => '' !== $field['value']
		);
		if ( $fields ) {
			$data[] = array(
				'group_id'    => 'digital-world',
				'group_label' => 'Digital World',
				'item_id'     => 'digital-world-' . $user->ID,
				'data'        => array_values( $fields ),
			);
		}
	}
	return array(
		'data' => $data,
		'done' => true,
	);
}
