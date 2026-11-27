<?php

if ( ! file_exists( __DIR__ . '/wp-config-local.php' ) ) {
	http_response_code( 500 );
	exit( 'Missing wp-config-local.php. Copy wp-config-local.sample.php and fill it in.' );
}

require_once __DIR__ . '/vendor/autoload.php';
require_once __DIR__ . '/wp-config-local.php';

defined( 'WP_HOME' ) || define( 'WP_HOME', 'http://localhost' );
defined( 'WP_SITEURL' ) || define( 'WP_SITEURL', WP_HOME . '/wp' );
defined( 'WP_ENVIRONMENT_TYPE' ) || define( 'WP_ENVIRONMENT_TYPE', 'production' );
defined( 'WP_DEBUG' ) || define( 'WP_DEBUG', false );
defined( 'WP_DEBUG_LOG' ) || define( 'WP_DEBUG_LOG', WP_DEBUG );
defined( 'WP_DEBUG_DISPLAY' ) || define( 'WP_DEBUG_DISPLAY', false );
// AI-NAVIGATOR-OFF defined( 'DIGITAL_WORLD_ANTHROPIC_API_KEY' ) || define( 'DIGITAL_WORLD_ANTHROPIC_API_KEY', getenv( 'ANTHROPIC_API_KEY' ) ?: '' );

define( 'WP_CONTENT_DIR', __DIR__ . '/wp-content' );
define( 'WP_CONTENT_URL', WP_HOME . '/wp-content' );

define( 'DISALLOW_FILE_EDIT', true );
define( 'DISALLOW_FILE_MODS', true );
define( 'AUTOMATIC_UPDATER_DISABLED', true );

$table_prefix = 'wp_';

if ( ! defined( 'ABSPATH' ) ) {
	define( 'ABSPATH', __DIR__ . '/wp/' );
}

require_once ABSPATH . 'wp-settings.php';
