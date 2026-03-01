# Cave Dragon — Deployment Guide

Production deployment of Cave Dragon at `https://cavedragon.llc`.

---

## Infrastructure Overview

| Component | Service | Details |
|-----------|---------|---------|
| **VPS** | Hetzner CPX11 | 2 vCPU (AMD), 2 GB RAM + 2 GB swap, 40 GB SSD |
| **PaaS** | Dokku v0.35+ | Self-hosted Heroku-like, git-push deploys |
| **Database** | PostgreSQL 14 | Dokku plugin (`dokku postgres:link`) |
| **Cache/PubSub** | Redis 7 | Dokku plugin (`dokku redis:link`) |
| **Object Storage** | Cloudflare R2 | S3-compatible, zero egress fees, 10 GB free tier |
| **DNS/CDN/SSL** | Cloudflare | Proxied DNS, Full (Strict) SSL, caching |
| **SSL Cert** | Let's Encrypt | Dokku plugin with auto-renewal cron |
| **Domain** | cavedragon.llc | Registered via Cloudflare |

**Server IP**: `178.156.149.31`

---

## Initial Server Setup (One-Time)

### 1. Provision VPS

- Create Hetzner CPX11 (or similar) with Ubuntu 24.04
- SSH in as root: `ssh root@178.156.149.31`

### 2. Add Swap (critical for 2 GB RAM servers)

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Without swap, Docker builds and `loaddata` will OOM-kill SSH sessions.

### 3. Install Dokku

```bash
wget -NP . https://dokku.com/install/v0.35.15/bootstrap.sh
sudo DOKKU_TAG=v0.35.15 bash bootstrap.sh
```

### 4. Create App + Services

```bash
dokku apps:create cave-backend
dokku domains:set cave-backend cavedragon.llc

# PostgreSQL
sudo dokku plugin:install https://github.com/dokku/dokku-postgres.git
dokku postgres:create cave-db
dokku postgres:link cave-db cave-backend

# Redis
sudo dokku plugin:install https://github.com/dokku/dokku-redis.git
dokku redis:create cave-redis
dokku redis:link cave-redis cave-backend
```

### 5. Set Environment Variables

```bash
dokku config:set cave-backend \
  SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(50))')" \
  DEBUG=False \
  ALLOWED_HOSTS=cavedragon.llc,www.cavedragon.llc,178.156.149.31 \
  DJANGO_SETTINGS_MODULE=cave_backend.settings \
  SECURE_SSL_REDIRECT=True \
  AWS_STORAGE_BUCKET_NAME=cave-dragon-media \
  AWS_S3_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com \
  AWS_ACCESS_KEY_ID=<r2-access-key> \
  AWS_SECRET_ACCESS_KEY=<r2-secret-key> \
  AWS_S3_CUSTOM_DOMAIN=<r2-public-domain>.r2.dev
```

`DATABASE_URL` and `REDIS_URL` are auto-set by the Dokku link commands.

### 6. WebSocket Proxy (nginx config)

```bash
mkdir -p /home/dokku/cave-backend/nginx.conf.d/
chown dokku:dokku /home/dokku/cave-backend/nginx.conf.d/

cat > /home/dokku/cave-backend/nginx.conf.d/websocket.conf << 'EOF'
location /ws/ {
    proxy_pass http://cave-backend-web;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 86400;
}
EOF
```

**Important**: The `nginx.conf.d/` directory must be owned by `dokku:dokku`, not root. Let's Encrypt will fail with permission errors otherwise.

### 7. SSL with Let's Encrypt

```bash
sudo dokku plugin:install https://github.com/dokku/dokku-letsencrypt.git
dokku letsencrypt:set cave-backend email your@email.com
dokku letsencrypt:enable cave-backend
dokku letsencrypt:cron-job --add
```

After cert is issued, set Cloudflare SSL mode to **Full (Strict)**.

### 8. Shared Storage Mount (for data imports)

```bash
mkdir -p /var/lib/dokku/data/storage/cave-backend
chown 32767:32767 /var/lib/dokku/data/storage/cave-backend
dokku storage:mount cave-backend /var/lib/dokku/data/storage/cave-backend:/tmp/shared
```

Requires a rebuild to take effect. Useful for running `loaddata` or importing files into the container.

---

## Cloudflare R2 Setup

1. Create R2 bucket in Cloudflare dashboard (e.g., `cave-dragon-media`)
2. Create R2 API token with Object Read & Write permissions for the bucket
3. Enable **Public Development URL** on the bucket (Settings → Public access)
   - This generates a URL like `pub-xxxxx.r2.dev`
   - Without this, direct file URLs return 400
4. Set the env vars listed above (`AWS_STORAGE_BUCKET_NAME`, `AWS_S3_ENDPOINT_URL`, etc.)

### Uploading Existing Media to R2

```python
# Run locally with boto3 installed
import boto3, os

s3 = boto3.client('s3',
    endpoint_url='https://<account-id>.r2.cloudflarestorage.com',
    aws_access_key_id='<key>',
    aws_secret_access_key='<secret>',
)

media_dir = 'media'
bucket = 'cave-dragon-media'
for root, dirs, files in os.walk(media_dir):
    for f in files:
        local = os.path.join(root, f)
        key = os.path.relpath(local, media_dir)
        s3.upload_file(local, bucket, key)
        print(f'Uploaded {key}')
```

---

## Cloudflare DNS

- Add **A record**: `cavedragon.llc` → `178.156.149.31` (Proxied)
- Add **A record**: `www` → `178.156.149.31` (Proxied)
- SSL/TLS mode: **Full (Strict)**

---

## Deployment Files

These files in the repo root control the Dokku/Heroku build:

| File | Purpose |
|------|---------|
| `Procfile` | Defines web process: `daphne cave_backend.asgi:application --port $PORT --bind 0.0.0.0 --proxy-headers` |
| `.buildpacks` | Multi-buildpack: Node.js (frontend build) then Python (Django) |
| `package.json` | Root-level: defines `heroku-postbuild` script to build frontend |
| `runtime.txt` | Pins Python version (3.12.8) |
| `.slugignore` | Excludes `frontend/src`, `node_modules`, `.md` files, `.claude/` from slug |
| `frontend/.npmrc` | `legacy-peer-deps=true` — required for React 19 peer dep conflicts |

### Build Flow

1. Node.js buildpack runs `heroku-postbuild`: `cd frontend && npm install --include=dev && npm run build`
2. Vite builds React app to `frontend/dist/`
3. Python buildpack installs `requirements.txt`
4. `collectstatic` copies static files (including `frontend/dist/assets/`) to `staticfiles/`
5. WhiteNoise serves static files; `WHITENOISE_ROOT` serves `frontend/dist/` (SPA index.html)
6. Daphne starts serving HTTP + WebSocket on `$PORT`

---

## Day-to-Day Deployment

### Standard Deploy (code changes only)

```bash
# From local dev machine
git push origin main          # Backup to GitHub
git push dokku main           # Deploy (~2-3 min build)
```

The Dokku remote is set up as:

```bash
git remote add dokku dokku@178.156.149.31:cave-backend
```

### Deploy with Migrations

```bash
git push dokku main
ssh root@178.156.149.31 "dokku run cave-backend python manage.py migrate"
```

Or target a specific migration:

```bash
ssh root@178.156.149.31 "dokku run cave-backend python manage.py migrate <app_name> <migration_number>"
```

### Deploy with New Env Vars

```bash
# Set env vars BEFORE pushing (triggers rebuild automatically)
ssh root@178.156.149.31 "dokku config:set cave-backend NEW_VAR=value"
# Then push code
git push dokku main
```

Note: `dokku config:set` triggers an automatic restart/rebuild.

### Running Management Commands

```bash
ssh root@178.156.149.31 "dokku run cave-backend python manage.py <command>"
```

For long-running commands on low-memory servers, use `nohup`:

```bash
ssh root@178.156.149.31
dokku run cave-backend bash -c "nohup python manage.py loaddata /tmp/shared/data.json > /tmp/shared/output.log 2>&1 &"
# Check later:
cat /var/lib/dokku/data/storage/cave-backend/output.log
```

### Checking Logs

```bash
ssh root@178.156.149.31 "dokku logs cave-backend --tail"
```

---

## Data Migration (SQLite → PostgreSQL)

This was done once during initial deployment. Steps for reference:

### 1. Export from SQLite

```bash
# Locally, with SQLite database
python3 manage.py dumpdata \
  --natural-primary --natural-foreign \
  --exclude=contenttypes \
  --exclude=auth.permission \
  --exclude=admin.logentry \
  --exclude=sessions.session \
  -o datadump.json
```

### 2. Upload to Server

```bash
scp datadump.json root@178.156.149.31:/var/lib/dokku/data/storage/cave-backend/
```

### 3. Load into PostgreSQL

```bash
ssh root@178.156.149.31 "dokku run cave-backend python manage.py loaddata /tmp/shared/datadump.json"
```

### Gotchas

- **Signal handlers crash during loaddata**: Django fires `post_save` signals with `raw=True` during fixture loading. All signal handlers must accept `raw=False` as a keyword arg and return early if `raw is True`. This was fixed in `social/signals.py` (11 handlers) and `sync/signals.py` (1 handler).

- **PostgreSQL enforces max_length**: SQLite silently allows oversized strings. PostgreSQL will reject them with `value too long for type character varying(N)`. We hit this on `LandOwner.tpad_link` (200→500 chars).

- **SSH drops during Docker ops**: On 2 GB RAM servers, `dokku run` spawns a new container which can cause memory pressure and drop SSH. Use `nohup` + background execution for heavy commands.

- **Containers can't see host filesystem**: `dokku run` creates isolated containers. Use `dokku storage:mount` to share directories between host and container. Requires a rebuild to take effect.

---

## Lessons Learned

### Build Issues

1. **Vite not found in production**: The `heroku-postbuild` script must use `npm install --include=dev` because Vite is a devDependency. The Node.js buildpack sets `NODE_ENV=production` which skips devDeps by default.

2. **React 19 peer dependency conflicts**: Libraries like `@emoji-mart/react` and `@fullcalendar/react` haven't updated their peerDependency ranges for React 19. Fixed with `frontend/.npmrc` containing `legacy-peer-deps=true`.

3. **Multi-buildpack ordering**: Node.js must run BEFORE Python (specified in `.buildpacks`). Node builds the frontend assets that Python's `collectstatic` then copies.

### SSL/Cloudflare

4. **Let's Encrypt + Cloudflare**: During initial cert setup, Cloudflare SSL mode should be **Full** (not Strict). HTTP-01 challenge needs to reach the server. After cert is issued, switch to **Full (Strict)**.

5. **nginx.conf.d ownership**: Dokku's Let's Encrypt plugin writes to `nginx.conf.d/`. If this directory was created by root (e.g., for WebSocket config), `chown dokku:dokku` it or cert renewal will fail with permission errors.

6. **Browser cache after deploy**: Vite uses content-hashed filenames for JS/CSS, but the browser may cache `index.html` itself. Users may need `Ctrl+Shift+R` after deploys. Consider setting `Cache-Control: no-cache` on HTML responses.

### Storage

7. **R2 buckets are private by default**: Direct URLs return 400 until you enable the "Public Development URL" in R2 bucket settings. The public URL (e.g., `pub-xxxxx.r2.dev`) must be set as `AWS_S3_CUSTOM_DOMAIN`.

### Database

8. **Django fixture ordering**: `dumpdata` with `--natural-primary --natural-foreign` handles most FK ordering. Excluding `contenttypes` and `auth.permission` avoids conflicts since Django creates these automatically.

9. **`SECURE_SSL_REDIRECT` before SSL**: Set this to `False` initially (via env var) or the site will redirect to HTTPS before the cert exists, creating an infinite redirect loop. Enable after SSL is working.

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `SECRET_KEY` | Yes | Django secret key (generate with `secrets.token_urlsafe(50)`) |
| `DEBUG` | Yes | `False` in production |
| `ALLOWED_HOSTS` | Yes | Comma-separated hostnames |
| `DJANGO_SETTINGS_MODULE` | Yes | `cave_backend.settings` |
| `SECURE_SSL_REDIRECT` | Yes | `True` after SSL is configured |
| `DATABASE_URL` | Auto | Set by `dokku postgres:link` |
| `REDIS_URL` | Auto | Set by `dokku redis:link` |
| `AWS_STORAGE_BUCKET_NAME` | Yes | R2 bucket name |
| `AWS_S3_ENDPOINT_URL` | Yes | R2 endpoint (includes account ID) |
| `AWS_ACCESS_KEY_ID` | Yes | R2 API token access key |
| `AWS_SECRET_ACCESS_KEY` | Yes | R2 API token secret key |
| `AWS_S3_CUSTOM_DOMAIN` | Yes | R2 public URL (e.g., `pub-xxx.r2.dev`) |

---

## Monitoring & Maintenance

### SSL Certificate Renewal

Auto-renewal is handled by the Let's Encrypt cron job added during setup. Verify it's active:

```bash
ssh root@178.156.149.31 "dokku letsencrypt:list"
```

### Disk Usage

```bash
ssh root@178.156.149.31 "df -h / && dokku postgres:info cave-db"
```

### App Status

```bash
ssh root@178.156.149.31 "dokku ps:report cave-backend"
```

### Restart App

```bash
ssh root@178.156.149.31 "dokku ps:restart cave-backend"
```
