<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function digital_world_demo_content() {
	return array(
		array(
			'page'      => array(
				'title'   => 'About Us',
				'slug'    => 'about-us',
				'excerpt' => 'Who we are: a product studio that turns websites into places people want to explore.',
				'content' => '<p>We are a small product studio. We design and build websites, platforms and interactive experiences for companies that want their content to be explored, not just scrolled.</p><p>Founded in 2016, the team has shipped more than 120 projects for clients in finance, retail and education.</p>',
			),
			'object'    => array(
				'color'     => '#5eead4',
				'position'  => array( 0, 0, 0 ),
				'keywords'  => 'about, company, team, who we are, про нас, компанія, команда, хто ми',
			),
		),
		array(
			'page'      => array(
				'title'   => 'Services',
				'slug'    => 'services',
				'excerpt' => 'Web development, 3D experiences, AI integrations and long-term product support.',
				'content' => '<p>What we do:</p><ul><li>WordPress and headless web development</li><li>Interactive 3D experiences with Three.js</li><li>AI assistants and content automation</li><li>Long-term product support</li></ul>',
			),
			'object'    => array(
				'color'     => '#60a5fa',
				'position'  => array( 14, 0, -4 ),
				'keywords'  => 'services, what we do, development, offer, послуги, що ми робимо, розробка, пропозиція',
			),
		),
		array(
			'page'      => array(
				'title'   => 'Blog',
				'slug'    => 'blog',
				'excerpt' => 'Articles and news about web development, 3D on the web and AI.',
				'content' => '<p>Notes from the studio: articles about web development, real-time 3D in the browser and practical AI.</p>',
			),
			'object'    => array(
				'color'     => '#a78bfa',
				'position'  => array( -13, 0, -6 ),
				'keywords'  => 'blog, news, articles, posts, library, блог, новини, статті, бібліотека',
			),
		),
		array(
			'page'      => array(
				'title'   => 'Portfolio',
				'slug'    => 'portfolio',
				'excerpt' => 'Selected case studies, including fintech dashboards and e-commerce platforms.',
				'content' => '<p>Selected work:</p><ul><li>FinPulse — a real-time dashboard for a fintech startup</li><li>Northwind Store — a WooCommerce platform for 40k products</li><li>EduVerse — a 3D campus for an online university</li></ul>',
			),
			'object'    => array(
				'color'     => '#f472b6',
				'position'  => array( 6, 0, 13 ),
				'keywords'  => 'portfolio, projects, cases, work, finance, fintech, портфоліо, проєкти, кейси, роботи, фінанси',
			),
		),
		array(
			'page'      => array(
				'title'   => 'Contact',
				'slug'    => 'contact',
				'excerpt' => 'Start a project or ask a question.',
				'content' => '<p>Tell us about your project: hello@example.com.</p>',
			),
			'object'    => array(
				'color'     => '#fbbf24',
				'position'  => array( -8, 0, 12 ),
				'keywords'  => 'contact, email, write, hire, контакти, звʼязатися, написати, замовити',
			),
		),
	);
}

function digital_world_seed_demo() {
	foreach ( digital_world_demo_content() as $index => $item ) {
		$page = get_page_by_path( $item['page']['slug'] );
		if ( ! $page ) {
			$page_id = wp_insert_post(
				array(
					'post_type'    => 'page',
					'post_status'  => 'publish',
					'post_title'   => $item['page']['title'],
					'post_name'    => $item['page']['slug'],
					'post_excerpt' => $item['page']['excerpt'],
					'post_content' => $item['page']['content'],
					'menu_order'   => $index,
				)
			);
		} else {
			$page_id = $page->ID;
		}

		if ( ! $page_id || is_wp_error( $page_id ) ) {
			continue;
		}

		$object = $item['object'];
		$meta   = array(
			'dw_color'       => $object['color'],
			'dw_position_x'  => $object['position'][0],
			'dw_position_z'  => $object['position'][2],
			'dw_linked_page' => $page_id,
			'dw_description' => $item['page']['excerpt'],
			'dw_keywords'    => $object['keywords'],
		);
		foreach ( array_keys( $meta ) as $name ) {
			$meta[ '_' . $name ] = 'field_' . $name;
		}

		wp_insert_post(
			array(
				'post_type'   => DIGITAL_WORLD_CPT,
				'post_status' => 'publish',
				'post_title'  => $item['page']['title'],
				'post_name'   => $item['page']['slug'],
				'menu_order'  => $index,
				'meta_input'  => $meta,
			)
		);
	}

	digital_world_flush_cache();
}
