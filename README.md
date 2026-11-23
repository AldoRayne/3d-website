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

To deploy on a free Oracle Cloud VM, follow [docs/deploy-oracle.md](docs/deploy-oracle.md).

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
- World editor (Digital World → Редактор світу, administrators only) shows the same 3D world. A compass in the top-left corner always points north (−Z, the direction of the "North" door side); clicking it turns the view north-up. You can drag buildings with the mouse; they snap to the block grid. You can also turn the door (R key or buttons), generate a different building (it keeps rolling until one fits where it stands), change its colour, and set the island radius. Every change saves automatically through `POST /wp-json/digital-world/v1/objects/{id}` and `/settings`, which write the same ACF fields and the `digital_world_island_radius` option. Positions that would overlap another building, block a door or fall off the island are refused.
- When tree leaves get between the camera and the character, the leaves in the line of sight dissolve into a pixel dither (`world/foliage.ts`): every leaf pixel inside a tube from the camera to the character's head, or very close to the camera, is partly discarded in the shader, with soft edges. Only that part of the crown becomes see-through; the rest of the tree, trunks and shadows stay as they are. Trees use their own `foliage` block, so the potted plants in the rooms and the world editor in the admin are not affected.
- The spawn point follows the layout: it is the free spot closest to the point with the smallest total distance to all doors (the geometric median of the door fronts), at least 3.5 blocks from any door and away from the island edge, and the character starts facing the nearest building. With no buildings it falls back to the south of the island. Paths run from the spawn point to every door (A* on the walking grid, straightened, one block wide, plus three blocks straight out of each door), and trees are planted only after that, never on or next to a path.
- Trees and the jagged island edge depend only on their own grid cell. Moving a building can move the spawn point and therefore the paths, so trees along old and new paths may appear or disappear; elsewhere the scenery stays the same. The world generation (`world/WorldModel.ts`) is shared by the game and the editor.
- REST endpoints:
  - `GET /wp-json/digital-world/v1/world` returns the object catalog.
  - `POST /wp-json/digital-world/v1/navigate` is the Navigator. It requires an `X-WP-Nonce` header and is limited to 20 requests per minute per IP.
- The WordPress admin bar is never shown on the site, even for logged-in users (`show_admin_bar` is off), so it does not cover pages or end up in the 3D view.
- Frontend: Vue 3, Three.js and GSAP, built with Vite into `dist/`. The world is served at `/digital-world/`. Every other page gets an **Enter Digital World** button. On a page that has a linked building, the button opens the world at that building (`?focus=<slug>`).
- The world is built from blocks (voxels), and all textures and the character are drawn in code. Buildings come from a seeded generator (`world/buildings.ts`) that picks the size, number of floors, wall material, windows, roof (flat, hipped, gable, dome or battlement) and extras (chimney, flag, beacon, awning) from the seed. The same seed always gives the same building, in the 2D preview (`world/preview.ts`) and in the 3D world. Every building has a door. The ACF "Door side" field sets which wall the door is on; "Auto" points it toward the island centre.
- Controls: arrow keys or WASD. Up and down walk, left and right turn the character, and the camera always stays behind. Hold the mouse button and drag to look around; the camera springs back when you let go. The wheel changes the camera distance. Clicking the ground walks there. On mobile, tap the ground.
- Each door has a small zone in front of it. Standing in the zone shows the building card. Enter, the "Увійти" button, or a click on the building plays the entry: the door opens, the character walks in and the camera pushes into the bright doorway. Behind it is a room (`world/interior.ts`, a separate scene). It is the building's ground floor at twice the size: the walls, corners, windows and the lamp over the door are copied from the generated building, the ceiling follows the roof (flat, gable, hipped, or a dome with glass rings), buildings with more than one floor get stairs to an opening in the ceiling, and a chimney becomes a fireplace. The furniture comes from the seed. The character walks along the carpet to a lectern, the camera moves over their shoulder to the book, the cover and three sheets turn, and the page is printed on the book. Each sheet lifts from its bottom outer corner, curls into a strong arc, flips over the spine with the arc reversing as it falls, and lands flat, casting a soft shadow on the page below. On landscape screens it spans the whole spread: the last sheet carries a snapshot of the page's left half (`modern-screenshot`) on its back, bends with it, and once it lands it fades into the live page. On portrait screens the page fills the right page, and the back of the last sheet shows the title and description. The camera then pushes in until the page fills the screen, and the page turns into a 3D space (see below). Pressing Enter or clicking again during the entry speeds it up four times. Clicking a building away from its door only shows a hint. The section list and the Navigator walk to the door but never enter.
- The page in the book is a live iframe at the size of the window, placed in 3D with `CSS3DRenderer` underneath the WebGL canvas. The book's page meshes write mostly transparent pixels into the canvas: the iframe shows through exactly there under a faint paper texture, and the cover and turning sheets hide it naturally. The paper texture fades out during the final push.
- Inside the book the page becomes a space you can fly through (`world/reading/`). The plugin reads the real layout of the whole page from the iframe, header and footer included (every character, list marker, image, background and border; the admin bar, the skip link and the "Enter Digital World" button are left out), and rebuilds it as a relief at the same positions: extruded letters in the theme's font (headings deeper than body text, card-coloured sides for readability), spheres instead of list bullets, extruded numbers for ordered lists, raised buttons, slabs for backgrounds and borders, and images as flat framed pictures. At the end of the book animation the flat page is swapped for this relief, the letters rise out of the paper, the background turns into a paper-coloured space with dust, and the camera pulls back at an angle.
- Flying: WASD or arrows, E or Space up, Q down, Shift faster, hold the mouse to look around, the wheel moves forward. On touch screens the left half of the screen is a joystick and the right half looks around. "Читати" turns the camera to face the page where it is, "На початок" goes to the top, "Звичайна сторінка" opens the WordPress page, "Вийти з книги" or Esc returns to the building's door. Links in the relief are clickable over their whole area, so a button responds to a click anywhere on it, not only on its text, and so does an image inside a link: pages of this site open in 3D in place (with their own history entry), anchors fly to their target, everything else opens in a new tab.
- The address becomes `/digital-world/?read=/page-path/`, so Back and Forward move between pages and the world, and such a link opens the page in 3D directly. Regular page URLs always show the normal WordPress page.
- The 3D fonts are generated from the theme's Manrope variable font (SIL Open Font License) in weights 300, 400 and 700 with Latin and Cyrillic: `python3 scripts/build-fonts.py <path to Manrope-VariableFont_wght.woff2>` in `frontend` (needs fontTools and brotli). They load only when a page is opened in 3D.
- After the browser's Back button, or when arriving via `?focus=<slug>`, the character stands at that building's door.
- AI Navigator: a language model returns structured output `{reply, action, target, transition}`. The allowed actions are `navigate`, `open`, `overview` and `none`. `target` is restricted to slugs from the catalog, and the server checks it again before responding. Setup is described in [AI Navigator](#ai-navigator) below.

### Performance

- Blocks are not drawn as separate cubes. `world/voxels.ts` builds one mesh per block type that contains only the faces you can see, and merges neighbouring equal faces into large rectangles with a repeating texture. The island, the buildings, the rooms and the admin editor all use it (about 90% fewer triangles than one cube per block).
- The canvas lowers its pixel ratio in steps of 0.25 when frames run late (below 50 fps and below 80% of the screen's own rate) and raises it again when there is headroom. Hardware antialiasing is off when the device pixel ratio is already 2 or more.
- In the book, every character is an instanced shape without bevels, and the light sides are marked in the geometry, so each character costs one draw call. The glyph shapes for the page are prepared in small batches while the entry animation plays.
- The world page embeds the world data in its HTML, so the first frame does not wait for `GET /world`.
- `.htaccess` gzips HTML, CSS, JS and JSON (and maps `.json` to `application/json`, which XAMPP does not) and gives the hashed files in `dist/assets/` a one-year immutable cache.

### AI Navigator

The Navigator tries the providers whose settings are filled in, in this order, and uses the first one that answers:

| Provider | Setting in `wp-config-local.php` | Default model |
|---|---|---|
| Claude | `DIGITAL_WORLD_ANTHROPIC_API_KEY` | `claude-opus-5-5` |
| Ollama (local) | `DIGITAL_WORLD_OLLAMA_MODEL` (no key) | none, the model name enables it |
| OpenAI | `DIGITAL_WORLD_OPENAI_API_KEY`, optional `DIGITAL_WORLD_OPENAI_MODEL` | `gpt-5-mini` |
| Gemini | `DIGITAL_WORLD_GEMINI_API_KEY`, optional `DIGITAL_WORLD_GEMINI_MODEL` | `gemini-3.5-flash-lite` |

An empty value skips the provider. If every provider is skipped or fails (no credits, rate limit, timeout, invalid answer), the Navigator falls back to a local keyword parser. It uses titles, slugs and the "Keywords" field, and works in Ukrainian and English. The chat header names the first configured provider, or shows `Offline`; it does not tell whether that provider actually answered, so check the PHP error log, where every failure is logged as `[digital-world] Navigator <provider> ...`.

All providers share one system prompt (`digital_world_system_prompt()` in `includes/navigator.php`) and one output schema. The prompt is built on every request from the catalog, so edits to an object's "Description" and "Keywords" fields apply immediately. Rules worth knowing:

- The character moves only when the visitor asks to go somewhere, to open or show a section, or where something is. Questions, greetings and small talk get an answer with `none`, and the model may offer to lead the way; the keyword parser follows the same rule.
- The server detects the language of the visitor's latest message (Ukrainian, Russian or English) and names it at the end of the prompt, so the reply stays in that language even when the catalog is in another one. Markdown and internal slugs such as `@stand` are stripped from replies.

Getting keys:

- **Claude**: Claude Console → API keys. A claude.ai subscription does not include API access, and in an organization only some roles can create keys.
- **OpenAI**: platform.openai.com → API keys. Needs prepaid credits; a ChatGPT subscription does not include API access.
- **Gemini**: https://aistudio.google.com/apikey. The free tier works without a billing account but has per-project rate limits and may use requests to improve Google's models. Older model names can return 404 for new keys; set `DIGITAL_WORLD_GEMINI_MODEL` to a current one.

Filters: `digital_world_ai_model` (Claude model), `digital_world_anthropic_api_key`, and for the other providers `digital_world_{ollama,openai,gemini}_api_key`, `digital_world_{provider}_model` and `digital_world_{provider}_request` (the request body).

#### Local model with Ollama

Ollama runs a model on this machine: no key, no request limits, nothing leaves the computer. It is meant for local development, not for production. On an Apple M1 with 16 GB the tested model answers in about 6 seconds, the first request after 5 idle minutes takes about 25 seconds while the model loads, and the site only gets answers while Ollama is running.

```bash
brew install ollama
brew services run ollama          # start in the background until reboot
ollama pull ministral-3:8b-instruct-2512-q4_K_M
```

```php
define( 'DIGITAL_WORLD_OLLAMA_MODEL', 'ministral-3:8b-instruct-2512-q4_K_M' );
```

- Use a `q4_K_M`, `q8_0` or `qat` tag. Tags without a suffix often point to `nvfp4`/MLX builds, which answer `501 structured output is unavailable`, so every request would fall through to the next provider.
- Of the models that fit in 16 GB, `ministral-3:8b` gave the best results on a 24-case test (correct action, target and reply language in 46 of 48 runs, median 6 s). `gemma3:12b`, `qwen3.5:9b` and `qwen3.5:4b` scored 65–75% and were slower or returned empty replies.
- Ollama does not start at login. `brew services run ollama` starts it until the next reboot, `brew services stop ollama` stops it, and `brew services start ollama` also turns on autostart. While idle it uses about 25 MB of memory; a loaded model takes about 6 GB and is unloaded after 5 minutes without requests.
- When Ollama is not running, the request fails at once and the next provider answers.
