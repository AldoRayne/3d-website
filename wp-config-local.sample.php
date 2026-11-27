<?php

define( 'DB_NAME', '3d_website' );
define( 'DB_USER', 'root' );
define( 'DB_PASSWORD', '' );
define( 'DB_HOST', '127.0.0.1' );
define( 'DB_CHARSET', 'utf8mb4' );
define( 'DB_COLLATE', '' );
define( 'AUTH_KEY', 'put-a-unique-phrase-here' );
define( 'SECURE_AUTH_KEY', 'put-a-unique-phrase-here' );
define( 'LOGGED_IN_KEY', 'put-a-unique-phrase-here' );
define( 'NONCE_KEY', 'put-a-unique-phrase-here' );
define( 'AUTH_SALT', 'put-a-unique-phrase-here' );
define( 'SECURE_AUTH_SALT', 'put-a-unique-phrase-here' );
define( 'LOGGED_IN_SALT', 'put-a-unique-phrase-here' );
define( 'NONCE_SALT', 'put-a-unique-phrase-here' );

define( 'WP_HOME', 'http://localhost' );
define( 'WP_ENVIRONMENT_TYPE', 'local' );
define( 'WP_DEBUG', true );

// AI-NAVIGATOR-OFF define( 'DIGITAL_WORLD_ANTHROPIC_API_KEY', '' );

// AI-NAVIGATOR-OFF // Providers are tried in order: Anthropic, Ollama, OpenAI, Gemini. Empty key skips the provider.

// AI-NAVIGATOR-OFF // Local Ollama (http://localhost:11434), no key; the model name enables it, e.g. 'qwen3.5:4b-q4_K_M' (nvfp4 tags lack structured output).
// AI-NAVIGATOR-OFF define( 'DIGITAL_WORLD_OLLAMA_MODEL', '' );

// AI-NAVIGATOR-OFF define( 'DIGITAL_WORLD_OPENAI_API_KEY', '' );
// AI-NAVIGATOR-OFF define( 'DIGITAL_WORLD_OPENAI_MODEL', '' );

// AI-NAVIGATOR-OFF // Gemini API key from https://aistudio.google.com/apikey (free tier available).
// AI-NAVIGATOR-OFF define( 'DIGITAL_WORLD_GEMINI_API_KEY', '' );
// AI-NAVIGATOR-OFF define( 'DIGITAL_WORLD_GEMINI_MODEL', '' );

// Cloudflare Turnstile. Locally — the official test keys (always pass).
// Always fail: site 2x00000000000000000000AB, secret 2x0000000000000000000000000000000AA.
// Empty values disable the check.
define( 'DIGITAL_WORLD_TURNSTILE_SITE_KEY', '1x00000000000000000000AA' );
define( 'DIGITAL_WORLD_TURNSTILE_SECRET_KEY', '1x0000000000000000000000000000000AA' );

// Local mail catcher Mailpit (brew install mailpit): inbox at http://localhost:8025.
define( 'DIGITAL_WORLD_SMTP_HOST', '127.0.0.1' );
define( 'DIGITAL_WORLD_SMTP_PORT', 1025 );

// Shared world: realtime/server.mjs. Empty URL or a secret under 32 chars turns it off.
// Locally ws://localhost:8787; in production wss://SITE/dw-realtime (Apache proxies it to the Node service).
// The same secret goes to DW_REALTIME_SECRET in realtime/.env.
define( 'DIGITAL_WORLD_REALTIME_URL', '' );
define( 'DIGITAL_WORLD_REALTIME_SECRET', '' );
