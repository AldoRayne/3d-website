<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'phpmailer_init', 'digital_world_configure_smtp' );

function digital_world_configure_smtp( $phpmailer ) {
	if ( ! defined( 'DIGITAL_WORLD_SMTP_HOST' ) || '' === DIGITAL_WORLD_SMTP_HOST ) {
		return;
	}
	$phpmailer->isSMTP();
	$phpmailer->Host        = DIGITAL_WORLD_SMTP_HOST;
	$phpmailer->Port        = defined( 'DIGITAL_WORLD_SMTP_PORT' ) ? (int) DIGITAL_WORLD_SMTP_PORT : 25;
	$phpmailer->SMTPAuth    = false;
	$phpmailer->SMTPAutoTLS = false;
}
