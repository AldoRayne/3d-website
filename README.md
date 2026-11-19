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

- ACF stores the world objects as the `digital_world_object` CPT. The fields are color, X/Z position, door side, linked page, description and keywords. The building itself is stored as one number, `dw_building_seed`. On the object's edit screen, the "Будівля" box has a **Generate building** button and a 2D preview: each click rolls a new seed, and saving the post puts that building into the world. Objects without a seed get a stable one derived from the post ID.
- World editor (Digital World → Редактор світу, administrators only) shows the same 3D world. You can drag buildings with the mouse; they snap to the block grid. You can also turn the door (R key or buttons), generate a different building (it keeps rolling until one fits where it stands), change its colour, and set the island radius. Every change saves automatically through `POST /wp-json/digital-world/v1/objects/{id}` and `/settings`, which write the same ACF fields and the `digital_world_island_radius` option. Positions that would overlap another building, block a door or fall off the island are refused.
- Trees and the jagged island edge depend only on their own grid cell, so moving a building changes the scenery only next to it. The world generation (`world/WorldModel.ts`) is shared by the game and the editor.
- REST endpoints:
  - `GET /wp-json/digital-world/v1/world` returns the object catalog.
  - `POST /wp-json/digital-world/v1/navigate` is the Navigator. It requires an `X-WP-Nonce` header and is limited to 20 requests per minute per IP.
- Frontend: Vue 3, Three.js and GSAP, built with Vite into `dist/`. The world is served at `/digital-world/`. Every other page gets an **Enter Digital World** button. On a page that has a linked building, the button opens the world at that building (`?focus=<slug>`).
- The world is built from blocks (voxels), and all textures and the character are drawn in code. Buildings come from a seeded generator (`world/buildings.ts`) that picks the size, number of floors, wall material, windows, roof (flat, hipped, gable, dome or battlement) and extras (chimney, flag, beacon, awning) from the seed. The same seed always gives the same building, in the 2D preview (`world/preview.ts`) and in the 3D world. Every building has a door. The ACF "Door side" field sets which wall the door is on; "Auto" points it toward the island centre.
- Controls: arrow keys or WASD. Up and down walk, left and right turn the character, and the camera always stays behind. Hold the mouse button and drag to look around; the camera springs back when you let go. The wheel changes the camera distance. Clicking the ground walks there. On mobile, tap the ground.
- Each door has a small zone in front of it. Standing in the zone shows the building card. Enter, the "Увійти" button, or a click on the building plays the entry: the door opens, the character walks in and the camera pushes into the bright doorway. Behind it is a room (`world/interior.ts`, a separate scene). It is the building's ground floor at twice the size: the walls, corners, windows and the lamp over the door are copied from the generated building, the ceiling follows the roof (flat, gable, hipped, or a dome with glass rings), buildings with more than one floor get stairs to an opening in the ceiling, and a chimney becomes a fireplace. The furniture comes from the seed. The character walks along the carpet to a lectern, the camera moves over their shoulder to the book, the cover and three sheets turn, and the page is printed on the book. Each sheet lifts from its bottom outer corner, curls into a strong arc, flips over the spine with the arc reversing as it falls, and lands flat, casting a soft shadow on the page below. On landscape screens it spans the whole spread: the last sheet carries a snapshot of the page's left half (`modern-screenshot`) on its back, bends with it, and once it lands it fades into the live page. On portrait screens the page fills the right page, and the back of the last sheet shows the title and description. The camera then pushes in until the page fills the screen, and the browser navigates to it. Pressing Enter or clicking again during the entry speeds it up four times. Clicking a building away from its door only shows a hint. The section list and the Navigator walk to the door but never enter.
- The page in the book is a live iframe at the size of the window, placed in 3D with `CSS3DRenderer` underneath the WebGL canvas. The book's page meshes write mostly transparent pixels into the canvas: the iframe shows through exactly there under a faint paper texture, and the cover and turning sheets hide it naturally. The paper texture fades out during the final push. At the end of the push the iframe is at its normal size, so the navigation has no visible jump.
- After the browser's Back button, or when arriving via `?focus=<slug>`, the character stands at that building's door.
- AI Navigator: `claude-opus-5-5` with structured output `{reply, action, target, transition}`. The allowed actions are `navigate`, `open`, `overview` and `none`. `target` is restricted to slugs from the catalog, and the server checks it again before responding.

### Enabling Claude

Set the key in `wp-config-local.php`:

```php
define( 'DIGITAL_WORLD_ANTHROPIC_API_KEY', 'sk-ant-...' );
```

Without a key, or if the API returns an error or a refusal, the Navigator falls back to a local keyword parser. It uses titles, slugs and the "Keywords" field, and works in Ukrainian and English. The chat header shows `Claude` or `Offline` depending on which mode is active.

Two filters let you change the setup: `digital_world_ai_model` changes the model, and `digital_world_anthropic_api_key` changes where the key comes from.
