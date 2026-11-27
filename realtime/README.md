# Digital World: спільний світ

Невеликий Node-сервіс, через який гравці на одній копії острова бачать один одного. Він лише пересилає повідомлення між гравцями однієї кімнати. Стан тримається в пам'яті, у базу нічого не пишеться.

- Кімната `public` — спільний острів для гостей без входу.
- Кімната `island:<userId>` — особистий острів користувача. Туди потрапляють власник, гості за посиланням-запрошенням (`/digital-world/?island=<код>`) і адміністратори через «Відвідати».

Хто куди має доступ, вирішує WordPress: `POST /wp-json/digital-world/v1/realtime/token` видає підписаний токен на 60 секунд. Сервіс перевіряє підпис спільним секретом.

## Налаштування

У `wp-config-local.php`:

```php
define( 'DIGITAL_WORLD_REALTIME_URL', 'ws://localhost:8787' );       // локально
// define( 'DIGITAL_WORLD_REALTIME_URL', 'wss://SITE/dw-realtime' ); // на сервері
define( 'DIGITAL_WORLD_REALTIME_SECRET', '...' );                    // openssl rand -hex 32
```

У `realtime/.env` (не в git):

```
DW_REALTIME_SECRET=той самий секрет
DW_REALTIME_ORIGINS=http://localhost
```

Порожній URL або секрет коротший за 32 символи вимикає спільний світ. Тоді світ працює, як раніше, кожен гравець бачить лише себе.

Необов'язкові змінні: `DW_REALTIME_PORT` (8787), `DW_REALTIME_HOST` (127.0.0.1).

## Локально

```bash
cd realtime
npm install
npm start
```

Перевірка: `curl localhost:8787/health`.

## На сервері (Ubuntu + Apache)

1. Node 20+: `sudo apt install nodejs npm`, далі `cd realtime && npm ci --omit=dev`.
2. `realtime/.env`: `DW_REALTIME_ORIGINS=https://SITE`, права `chmod 600`.
3. systemd: `/etc/systemd/system/dw-realtime.service`

   ```ini
   [Unit]
   Description=Digital World realtime
   After=network.target

   [Service]
   WorkingDirectory=/var/www/SITE/realtime
   EnvironmentFile=/var/www/SITE/realtime/.env
   ExecStart=/usr/bin/node server.mjs
   Restart=always
   User=www-data

   [Install]
   WantedBy=multi-user.target
   ```

   ```bash
   sudo systemctl daemon-reload && sudo systemctl enable --now dw-realtime
   ```

4. Apache проксі (у `<VirtualHost *:443>` сайту):

   ```apache
   ProxyPass        /dw-realtime ws://127.0.0.1:8787/
   ProxyPassReverse /dw-realtime ws://127.0.0.1:8787/
   ```

   ```bash
   sudo a2enmod proxy proxy_http proxy_wstunnel && sudo systemctl reload apache2
   ```

5. У `wp-config-local.php` вкажіть `DIGITAL_WORLD_REALTIME_URL` = `wss://SITE/dw-realtime`.

Порт 8787 назовні не відкривайте: сервіс слухає лише 127.0.0.1.

## Протокол

Клієнт → сервер: `{t:'state', s:[x, z, heading, speed, inside]}` до 10 разів на секунду, `{t:'avatar', avatar}`, `{t:'layout', layout}`. Останнє приймається лише від власника острова.

Сервер → клієнт: `welcome`, `join`, `leave`, `state`, `avatar`, `layout`.

Обмеження сервера: 30 гравців у кімнаті, 30 повідомлень на секунду від одного з'єднання, повідомлення до 4 КБ. З'єднання, яке не відповіло на ping за 15 с, закривається.
