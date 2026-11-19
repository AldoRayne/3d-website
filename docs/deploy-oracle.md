# Розгортання на Oracle Cloud Always Free

Інструкція переносить сайт з локального XAMPP на безкоштовну віртуальну машину Oracle Cloud: Ubuntu 24.04, Apache, PHP, MariaDB, безкоштовний HTTPS від Let's Encrypt. Стек той самий, що й локально (Apache + MariaDB), тож `.htaccess` і дамп бази переносяться без змін.

Ліміти безкоштовного тарифу Oracle змінювалися у 2026 році. Перед стартом звірте їх на сторінці [Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm).

Далі в командах замініть:
- `SITE` на свій домен, наприклад `my-world.duckdns.org`;
- `SERVER_IP` на публічну IP-адресу машини;
- `DB_PASS` на згенерований пароль бази.

## 0. Що знадобиться

- Банківська картка. Oracle перевіряє її при реєстрації, але за ресурси в межах Always Free не списує.
- SSH-ключ на своєму комп'ютері. Якщо його немає: `ssh-keygen -t ed25519`.
- Доменне ім'я. Безкоштовний варіант — піддомен на [duckdns.org](https://www.duckdns.org). Без домену Let's Encrypt не видасть сертифікат.
- Доступ до репозиторію `github.com/AldoRayne/3d-website`.

## 1. Акаунт Oracle Cloud

1. Зареєструйтеся на [oracle.com/cloud/free](https://www.oracle.com/cloud/free/).
2. **Home region** обирайте уважно. Змінити його потім не можна, і безкоштовні машини створюються лише в ньому. Беріть найближчий до відвідувачів регіон, наприклад Frankfurt, Amsterdam чи Stockholm. У популярних регіонах буває, що вільних потужностей немає, і машину не вдається створити (див. розділ «Проблеми»).
3. Рекомендовано: після реєстрації перейдіть на **Pay As You Go** (Billing → Upgrade).
   - Безкоштовні ресурси лишаються безкоштовними.
   - За чинною політикою Oracle простої машини у суто безкоштовних акаунтах можуть бути відкликані, а в PAYG-акаунтах — ні.
   - Одразу створіть **Budget** з алертом на $1, щоб помітити випадкові платні ресурси.

## 2. Віртуальна машина

Compute → Instances → **Create instance**:

| Поле | Значення |
|---|---|
| Image | Canonical Ubuntu 24.04 (aarch64) |
| Shape | Ampere → `VM.Standard.A1.Flex`, 1 OCPU, 6 GB RAM (сайту вистачить із запасом, решта ліміту лишиться для другої машини) |
| Networking | створити нову VCN з публічною підмережею, **Assign a public IPv4 address** увімкнено |
| SSH keys | вставити вміст `~/.ssh/id_ed25519.pub` |
| Boot volume | стандартні 50 GB |

Після створення скопіюйте **Public IP address**. Ця адреса не зміниться, поки машину не видалено. Перевірте вхід:

```bash
ssh ubuntu@SERVER_IP
```

## 3. Відкрити порти 80 і 443

У Oracle два рівні фаєрвола, тож відкрити порти треба в обох.

**Мережа (Security List).** Networking → Virtual Cloud Networks → ваша VCN → Security Lists → Default Security List → Add Ingress Rules. Додайте два правила:
- Source `0.0.0.0/0`, TCP, Destination port `80`;
- Source `0.0.0.0/0`, TCP, Destination port `443`.

**Сама машина (iptables).** Образи Ubuntu від Oracle за замовчуванням блокують усе, крім SSH:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 4. Домен

На duckdns.org створіть піддомен і вкажіть у ньому `SERVER_IP`. Перевірте:

```bash
dig +short SITE
```

Команда має показати `SERVER_IP`. Для власного домену створіть A-запис на ту саму адресу.

## 5. Програми

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install apache2 mariadb-server \
  php libapache2-mod-php php-mysql php-curl php-mbstring php-xml php-zip php-gd php-intl \
  composer git unzip certbot python3-certbot-apache
sudo a2enmod rewrite
```

На Ubuntu 24.04 встановиться PHP 8.3. Проєкт працює на PHP 8.1 і новіших: `platform` у `composer.json` лише фіксує версії залежностей.

Також встановіть WP-CLI: він знадобиться для бази.

```bash
curl -sO https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar
sudo install wp-cli.phar /usr/local/bin/wp
wp --info
```

## 6. База даних

Згенеруйте пароль (`openssl rand -base64 24`) і створіть базу та користувача:

```bash
sudo mariadb <<'SQL'
CREATE DATABASE `3d_website` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci;
CREATE USER 'world'@'localhost' IDENTIFIED BY 'DB_PASS';
GRANT ALL PRIVILEGES ON `3d_website`.* TO 'world'@'localhost';
FLUSH PRIVILEGES;
SQL
```

## 7. Код

```bash
sudo mkdir -p /var/www/3d-website
sudo chown ubuntu:ubuntu /var/www/3d-website
git clone https://github.com/AldoRayne/3d-website.git /var/www/3d-website
cd /var/www/3d-website
git checkout feature/digital-world
composer install --no-dev --optimize-autoloader
```

Замість `feature/digital-world` вкажіть гілку, з якої розгортаєте, коли зміни потраплять у `main`.

Якщо репозиторій приватний, додайте deploy key:
1. На сервері виконайте `ssh-keygen -t ed25519 -f ~/.ssh/deploy -N ''`.
2. Вставте вміст `~/.ssh/deploy.pub` у GitHub → Settings → Deploy keys.
3. Клонуйте командою `GIT_SSH_COMMAND='ssh -i ~/.ssh/deploy' git clone git@github.com:AldoRayne/3d-website.git /var/www/3d-website`.

Збирати фронтенд на сервері не треба: зібраний `dist/` лежить у git.

## 8. wp-config-local.php

```bash
cp wp-config-local.sample.php wp-config-local.php
curl -s https://api.wordpress.org/secret-key/1.1/salt/
nano wp-config-local.php
```

Заповніть так:
- `DB_NAME` `3d_website`, `DB_USER` `world`, `DB_PASSWORD` — ваш `DB_PASS`, `DB_HOST` `localhost`;
- вісім рядків `AUTH_KEY`…`NONCE_SALT` замініть тими, що видав `curl`. Не беріть ключі з локальної копії;
- `WP_HOME` `https://SITE`;
- `WP_ENVIRONMENT_TYPE` `production`;
- `WP_DEBUG` `false`;
- `DIGITAL_WORLD_ANTHROPIC_API_KEY` — ключ Claude. Якщо залишити порожнім, AI Navigator працюватиме в режимі Offline.

Закрийте файл від сторонніх і дайте веб-серверу право запису лише в `uploads`:

```bash
sudo chgrp www-data wp-config-local.php && chmod 640 wp-config-local.php
mkdir -p wp-content/uploads && sudo chown -R www-data:www-data wp-content/uploads
```

## 9. Apache

```bash
sudo tee /etc/apache2/sites-available/3d-website.conf >/dev/null <<'CONF'
<VirtualHost *:80>
    ServerName SITE
    DocumentRoot /var/www/3d-website
    <Directory /var/www/3d-website>
        AllowOverride All
        Require all granted
    </Directory>
    ErrorLog ${APACHE_LOG_DIR}/3d-website-error.log
    CustomLog ${APACHE_LOG_DIR}/3d-website-access.log combined
</VirtualHost>
CONF
sudo nano /etc/apache2/sites-available/3d-website.conf
sudo a2ensite 3d-website && sudo a2dissite 000-default
sudo apache2ctl configtest && sudo systemctl reload apache2
```

У `nano` замініть `SITE` у рядку `ServerName` своїм доменом.

`AllowOverride All` обов'язковий: на `.htaccess` тримаються маршрути WordPress, адреса `/digital-world/` і заборона доступу до `vendor/` та конфігів.

## 10. HTTPS

```bash
sudo certbot --apache -d SITE --redirect -m you@example.com --agree-tos -n
```

Certbot сам додасть HTTPS-хост, перенаправлення з HTTP і автоматичне продовження сертифіката. Перевірити продовження можна командою `sudo certbot renew --dry-run`.

## 11. Перенесення бази й медіафайлів

**Локально на Mac.** Зробіть дамп і скопіюйте його разом із `uploads` на сервер:

```bash
/Applications/XAMPP/xamppfiles/bin/mysqldump -uroot -h127.0.0.1 --single-transaction 3d_website > 3d_website.sql
scp 3d_website.sql ubuntu@SERVER_IP:~
rsync -av /Applications/XAMPP/xamppfiles/htdocs/wp-content/uploads/ ubuntu@SERVER_IP:~/uploads/
```

**На сервері:**

```bash
cd /var/www/3d-website
sudo mariadb 3d_website < ~/3d_website.sql
sudo rsync -a ~/uploads/ wp-content/uploads/ && sudo chown -R www-data:www-data wp-content/uploads

wp --path=wp search-replace 'http://localhost' 'https://SITE' --all-tables --dry-run
wp --path=wp search-replace 'http://localhost' 'https://SITE' --all-tables
wp --path=wp transient delete digital_world_objects
wp --path=wp rewrite flush
```

`search-replace` правильно оновлює серіалізовані дані, тому замінювати URL у SQL-файлі вручну не можна. Кеш об'єктів світу зберігає URL сторінок, тож його треба скинути, як у команді вище.

## 12. Безпека: обов'язково до відкриття сайту

Локальний адмін має пароль `admin/admin`, і він переїхав разом із базою. Змініть пароль, а краще й логін:

```bash
wp --path=wp user update admin --prompt=user_pass
```

Команда запитає новий пароль. Або змініть його в адмінці (Users → Profile) одразу після першого входу. Ще кілька кроків:
- **Окремий адмін.** Створіть свого адміністратора з іншим логіном, а `admin` видаліть:
  ```bash
  wp --path=wp user create NEW_LOGIN you@example.com --role=administrator --prompt=user_pass
  wp --path=wp user delete admin --reassign=NEW_LOGIN
  ```
- **Закриті файли.** Перевірте, що `https://SITE/wp-config-local.php` віддає 404 або порожню сторінку, а `https://SITE/vendor/` — 404.
- **Оновлення безпеки.** Вони вмикаються автоматично (`unattended-upgrades` на Ubuntu увімкнено за замовчуванням).

## 13. Перевірка

- `https://SITE` — головна сторінка з кнопкою **Enter Digital World**.
- `https://SITE/digital-world/` — 3D-світ. Зайдіть у будинок, і анімація має довести до сторінки.
- `https://SITE/wp-admin` — адмінка (перенаправить на `/wp/wp-admin/`). Відкрийте **Редактор світу** і перетягніть будинок: зміна має зберегтися.
- Чат AI Navigator: у шапці має бути `Claude`, якщо ключ задано.

Логи помилок: `sudo tail -f /var/log/apache2/3d-website-error.log`.

## 14. Оновлення сайту

Після нових комітів:

```bash
cd /var/www/3d-website
git pull
composer install --no-dev --optimize-autoloader
wp --path=wp transient delete digital_world_objects
```

Плагіни, тему й ядро WordPress оновлюйте лише через Composer локально (`DISALLOW_FILE_MODS` блокує адмінку). Закомітьте `composer.lock`, потім виконайте `git pull` і `composer install` на сервері.

Вміст сайту (сторінки, будинки, позиції у світі) тепер живе в базі на сервері. Повторно переносити локальну базу не треба, інакше зміни на сервері затруться.

## 15. Резервні копії

Щоденний дамп бази з зберіганням 14 днів:

```bash
mkdir -p ~/backups
crontab -e
```

Додайте рядки:

```
30 3 * * * mysqldump --single-transaction 3d_website | gzip > ~/backups/db-$(date +\%F).sql.gz
40 3 * * * tar czf ~/backups/uploads-$(date +\%F).tgz -C /var/www/3d-website/wp-content uploads
50 3 * * * find ~/backups -type f -mtime +14 -delete
```

Щоб `mysqldump` працював від користувача `ubuntu` без пароля, створіть `~/.my.cnf` з правами 600:

```
[client]
user=world
password=DB_PASS
```

Час від часу копіюйте `~/backups` до себе (`rsync -av ubuntu@SERVER_IP:backups/ ./backups/`): бекап на тій самій машині не врятує, якщо машину буде видалено.

## 16. Надалі: мультиплеєр

Node-сервер для мультиплеєра можна запустити на цій же машині. Apache проксуватиме WebSocket через `mod_proxy_wstunnel` (`sudo a2enmod proxy proxy_http proxy_wstunnel`), а процес триматиме `systemd`. Інструкцію додамо разом із самим сервером.

## Проблеми

| Симптом | Що робити |
|---|---|
| `Out of capacity` при створенні машини | Спробуйте інший Availability Domain або повторіть пізніше. Запасний варіант: shape `VM.Standard.E2.1.Micro` (1 GB RAM), але тоді додайте swap: `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`, і рядок `/swapfile none swap sw 0 0` у `/etc/fstab`. |
| Сайт не відкривається, а `curl -I http://localhost` на сервері працює | Не відкрито порт: перевірте і Security List, і `iptables` (розділ 3). |
| `/digital-world/` або сторінки дають 404 | Немає `AllowOverride All` або `a2enmod rewrite`; виконайте `wp --path=wp rewrite flush`. |
| `Missing wp-config-local.php` | Файл не створено або в нього не ті права (розділ 8). |
| Біла сторінка або 500 | Подивіться лог Apache (розділ 13). Найчастіше причина — не той пароль бази або не встановлено розширення PHP. |
| Посилання ведуть на `localhost` | Не виконано `search-replace` або не скинуто кеш `digital_world_objects` (розділ 11). |
| AI Navigator показує `Offline` | Порожній `DIGITAL_WORLD_ANTHROPIC_API_KEY`, або помилка API: шукайте `[digital-world]` у лозі. |
