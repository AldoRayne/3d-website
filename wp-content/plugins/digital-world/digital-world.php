<?php
/**
 * Plugin Name: Digital World
 * Description: 3D Digital Twin сайту: об'єкти світу з ACF, сцена на Vue 3 + Three.js і AI Navigator на Claude.
 * Version: 0.3.0
 * Requires PHP: 8.1
 * Requires Plugins: advanced-custom-fields
 * Text Domain: digital-world
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'DIGITAL_WORLD_VERSION', '0.3.0' );
define( 'DIGITAL_WORLD_FILE', __FILE__ );
define( 'DIGITAL_WORLD_DIR', plugin_dir_path( __FILE__ ) );
define( 'DIGITAL_WORLD_URL', plugin_dir_url( __FILE__ ) );

require_once DIGITAL_WORLD_DIR . 'includes/post-type.php';
require_once DIGITAL_WORLD_DIR . 'includes/world.php';
require_once DIGITAL_WORLD_DIR . 'includes/navigator.php';
require_once DIGITAL_WORLD_DIR . 'includes/rest.php';
require_once DIGITAL_WORLD_DIR . 'includes/auth.php';
require_once DIGITAL_WORLD_DIR . 'includes/layout.php';
require_once DIGITAL_WORLD_DIR . 'includes/mail.php';
require_once DIGITAL_WORLD_DIR . 'includes/frontend.php';
require_once DIGITAL_WORLD_DIR . 'includes/admin.php';
require_once DIGITAL_WORLD_DIR . 'includes/members.php';
require_once DIGITAL_WORLD_DIR . 'includes/seed.php';

register_activation_hook( __FILE__, 'digital_world_install' );

add_action( 'init', 'digital_world_maybe_install', 20 );

function digital_world_install() {
	digital_world_register_post_type();
	digital_world_register_rewrite();
	digital_world_migrate_members();
	if ( ! digital_world_has_objects() ) {
		digital_world_seed_demo();
	}
	flush_rewrite_rules();
	update_option( 'digital_world_version', DIGITAL_WORLD_VERSION );
}

function digital_world_maybe_install() {
	if ( get_option( 'digital_world_version' ) !== DIGITAL_WORLD_VERSION ) {
		digital_world_install();
	}
}
