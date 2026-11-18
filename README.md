# 3D Website: Digital World

A WordPress site with a 3D "Digital Twin" mode. Each section of the site is a building on an island. Visitors can fly between buildings, open info panels, or ask the AI Navigator to take them somewhere.

## Project layout

Composer manages WordPress core, third-party plugins and themes, and PHP libraries. Git tracks only our own code and the dependency manifest.

```
composer.json / composer.lock    WordPress, ACF, theme, Anthropic SDK, Guzzle (pinned versions)
index.php                        front controller, loads wp/
wp-config.php                    shared config: paths, flags, autoloader
wp-config-local.php              secrets: DB, salts, API key (not in git)
wp-config-local.sample.php       template for the file above
.htaccess                        rewrites, /wp-admin redirect, blocks vendor/ and config files
wp/                              WordPress core (Composer, not in git)
vendor/                          PHP libraries (Composer, not in git)
wp-content/
  plugins/digital-world/         our plugin (in git)
  plugins/advanced-custom-fields Composer, not in git
  themes/twentytwentyfive        Composer, not in git
  uploads/                       media, deployed together with the DB
```

WordPress core lives in `wp/`, so the admin is at `/wp/wp-admin/`. Requests to `/wp-admin` redirect there.

`DISALLOW_FILE_MODS` is on. Plugins, themes and core can't be installed or updated from the admin, so `composer.lock` always matches what is actually running.

## Local setup

1. Create the `3d_website` database.
2. Copy `wp-config-local.sample.php` to `wp-config-local.php` and fill it in. Generate salts at https://api.wordpress.org/secret-key/1.1/salt/.
3. In the project root, run `composer install`.
4. Build the frontend only if you changed `frontend/src` (the built `dist/` is in git): in `wp-content/plugins/digital-world/frontend`, run `npm ci`, then `npm run build`.
5. For a fresh database, run the installer at `/wp/wp-admin/install.php` and activate ACF and Digital World. On first run the plugin creates five demo pages and their buildings.

## Updating dependencies

```bash
composer update roots/wordpress-no-content    # WordPress core
composer update wpackagist-plugin/advanced-custom-fields
composer require wpackagist-plugin/<slug>     # add a plugin from wordpress.org
composer audit                                # check for known vulnerabilities
```

Commit the changed `composer.json` and `composer.lock` together.

## Digital World plugin

- ACF stores the world objects as the `digital_world_object` CPT. The fields are type, color, X/Y/Z position, scale, animation, linked page, description, keywords and an optional GLB model.
- REST endpoints:
  - `GET /wp-json/digital-world/v1/world` returns the object catalog.
  - `POST /wp-json/digital-world/v1/navigate` is the Navigator. It requires an `X-WP-Nonce` header and is limited to 20 requests per minute per IP.
- Frontend: Vue 3, Three.js and GSAP, built with Vite into `dist/`. The world is served at `/digital-world/`. Every other page gets an **Enter Digital World** button. On a page that has a linked building, the button opens the world at that building (`?focus=<slug>`).
- AI Navigator: `claude-opus-5-5` with structured output `{reply, action, target, transition}`. The allowed actions are `navigate`, `open`, `overview` and `none`. `target` is restricted to slugs from the catalog, and the server checks it again before responding.

### Enabling Claude

Set the key in `wp-config-local.php`:

```php
define( 'DIGITAL_WORLD_ANTHROPIC_API_KEY', 'sk-ant-...' );
```

Without a key, or if the API returns an error or a refusal, the Navigator falls back to a local keyword parser. It uses titles, slugs and the "Keywords" field, and works in Ukrainian and English. The chat header shows `Claude` or `Offline` depending on which mode is active.

Two filters let you change the setup: `digital_world_ai_model` changes the model, and `digital_world_anthropic_api_key` changes where the key comes from.
