<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const DIGITAL_WORLD_CPT = 'digital_world_object';

const DIGITAL_WORLD_DOOR_SIDES = array(
	'auto'  => 'Auto (faces the island centre)',
	'north' => 'North',
	'east'  => 'East',
	'south' => 'South',
	'west'  => 'West',
);

add_action( 'init', 'digital_world_register_post_type' );
add_action( 'acf/include_fields', 'digital_world_register_fields' );

function digital_world_register_post_type() {
	register_post_type(
		DIGITAL_WORLD_CPT,
		array(
			'labels'       => array(
				'name'          => 'Digital World',
				'singular_name' => 'World object',
				'add_new_item'  => 'Add world object',
				'edit_item'     => 'Edit world object',
				'all_items'     => 'World objects',
			),
			'public'       => false,
			'show_ui'      => true,
			'show_in_rest' => false,
			'menu_icon'    => 'dashicons-admin-site-alt3',
			'supports'     => array( 'title', 'page-attributes' ),
		)
	);
}

function digital_world_register_fields() {
	if ( ! function_exists( 'acf_add_local_field_group' ) ) {
		return;
	}

	acf_add_local_field_group(
		array(
			'key'      => 'group_digital_world_object',
			'title'    => 'World object',
			'location' => array(
				array(
					array(
						'param'    => 'post_type',
						'operator' => '==',
						'value'    => DIGITAL_WORLD_CPT,
					),
				),
			),
			'fields'   => array(
				array(
					'key'           => 'field_dw_color',
					'name'          => 'dw_color',
					'label'         => 'Color',
					'type'          => 'color_picker',
					'default_value' => '#3498db',
					'wrapper'       => array( 'width' => 50 ),
				),
				array(
					'key'           => 'field_dw_position_x',
					'name'          => 'dw_position_x',
					'label'         => 'Position X',
					'type'          => 'number',
					'default_value' => 0,
					'step'          => 1,
					'wrapper'       => array( 'width' => 50 ),
				),
				array(
					'key'           => 'field_dw_position_z',
					'name'          => 'dw_position_z',
					'label'         => 'Position Z',
					'type'          => 'number',
					'default_value' => 0,
					'step'          => 1,
					'wrapper'       => array( 'width' => 50 ),
				),
				array(
					'key'           => 'field_dw_door_side',
					'name'          => 'dw_door_side',
					'label'         => 'Door side',
					'instructions'  => 'Which wall of the building has the entrance door.',
					'type'          => 'select',
					'choices'       => DIGITAL_WORLD_DOOR_SIDES,
					'default_value' => 'auto',
				),
				array(
					'key'           => 'field_dw_linked_page',
					'name'          => 'dw_linked_page',
					'label'         => 'Linked page',
					'type'          => 'post_object',
					'post_type'     => array( 'page', 'post' ),
					'return_format' => 'id',
					'allow_null'    => 1,
				),
				array(
					'key'          => 'field_dw_description',
					'name'         => 'dw_description',
					'label'        => 'Description',
					'instructions' => 'Shown in the info panel and given to the AI Navigator. Empty = page excerpt.',
					'type'         => 'textarea',
					'rows'         => 3,
				),
				array(
					'key'          => 'field_dw_keywords',
					'name'         => 'dw_keywords',
					'label'        => 'Keywords',
					'instructions' => 'Comma-separated synonyms the Navigator should recognise, in any language.',
					'type'         => 'text',
				),
			),
		)
	);
}

add_filter( 'manage_' . DIGITAL_WORLD_CPT . '_posts_columns', 'digital_world_admin_columns' );
add_action( 'manage_' . DIGITAL_WORLD_CPT . '_posts_custom_column', 'digital_world_admin_column_value', 10, 2 );

function digital_world_admin_columns( $columns ) {
	$date = $columns['date'] ?? null;
	unset( $columns['date'] );
	$columns['dw_position'] = 'Position';
	$columns['dw_page']     = 'Linked page';
	if ( $date ) {
		$columns['date'] = $date;
	}
	return $columns;
}

function digital_world_admin_column_value( $column, $post_id ) {
	if ( 'dw_position' === $column ) {
		printf(
			'%s, %s',
			esc_html( (string) (float) get_post_meta( $post_id, 'dw_position_x', true ) ),
			esc_html( (string) (float) get_post_meta( $post_id, 'dw_position_z', true ) )
		);
	}
	if ( 'dw_page' === $column ) {
		$page_id = (int) get_post_meta( $post_id, 'dw_linked_page', true );
		echo $page_id ? esc_html( get_the_title( $page_id ) ) : '—';
	}
}
