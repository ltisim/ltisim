# Self-hosting LTISim

This guide takes you from an empty server to a running installation. Registering it with Canvas is covered in [Canvas setup](Canvas-Setup.md).

> **How far this has been verified.** Starting from an empty database has been tested both ways described here: running with Node directly, and with Docker Compose from only the files in the repository. In both, the app created its tables, installed the sample templates, printed the registration link and answered requests. What has not been rehearsed is a complete install on a separate machine by someone following this guide, including the reverse proxy.

## Requirements

- Node.js 20 or later
- PostgreSQL 14 or later
- A public HTTPS address for the app (for example `https://ltisim.example.edu`), with a reverse proxy in front. Canvas will only launch a tool over HTTPS.
- Credentials for one AI provider (see [Model providers](Model-Providers.md))

One installation serves one LMS. To serve a second institution, run a second installation with its own database.

## 1. Database

Create an empty database and a user that owns it:

```
sudo -u postgres psql -c "CREATE ROLE ltisim LOGIN PASSWORD 'choose-a-password'"
sudo -u postgres psql -c "CREATE DATABASE ltisim OWNER ltisim"
```

You do not load a schema by hand. The app creates and upgrades its own tables on startup.

## 2. Install and build

```
git clone https://github.com/ltisim/ltisim.git
cd ltisim/backend  && npm ci --omit=dev
cd ../frontend     && npm ci && npm run build
```

The backend serves the built frontend from `frontend/dist`, so there is one process to run and no separate web server for static files.

## 3. Configure

```
cd backend
cp .env.example .env
```

Edit `.env`. The settings you must provide:

| Setting | What to put |
|---|---|
| `PUBLIC_URL` | The HTTPS address of this installation |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | The database from step 1 |
| `LTI_KEY` | A long random value. Generate it once and **never change it**: it encrypts the LMS registration |
| `AI_PROVIDER` and its credentials | See [Model providers](Model-Providers.md) |

Generate `LTI_KEY` with:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Every other setting is optional and described in [Configuration](Configuration.md).

Keep `.env` readable only by the account that runs the app; it holds your database password and AI credentials.

## 4. Run

```
cd backend
node src/server.js
```

On first start the app:

1. Creates its database tables.
2. Installs three sample assignment templates.
3. Prints a one-time registration link for your LMS, because no LMS is registered yet.

Check it is up:

```
curl http://127.0.0.1:3001/health
```

### As a service

On a Linux server, run it under systemd so it restarts on failure and boot. An example unit, assuming the app is in `/opt/ltisim` and runs as user `ltisim`:

```
[Unit]
Description=LTISim
After=network.target postgresql.service

[Service]
User=ltisim
WorkingDirectory=/opt/ltisim/backend
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### Docker Compose

The repository includes a `Dockerfile` and a `docker-compose.yml` that run LTISim together with its own PostgreSQL. This replaces steps 1 to 4:

```
cp backend/.env.example .env      # in the repository root, then edit .env
docker compose up -d --build
docker compose logs app           # shows the LMS registration link
```

In `.env`, fill in `PUBLIC_URL`, `LTI_KEY`, `DB_PASSWORD` and your AI provider settings. `DB_HOST`, `PORT` and `HOST` in that file are ignored under Compose.

The app is published on `127.0.0.1:3001` of the host; set `APP_PORT` or `APP_BIND` in `.env` to change that. You still need a reverse proxy with HTTPS in front (step 5).

The database lives in a Docker volume named `db-data`. `docker compose down` keeps it; `docker compose down -v` deletes it and all your data.

## 5. Reverse proxy and HTTPS

Put a reverse proxy in front of the app to terminate HTTPS. Set `HOST=127.0.0.1` so the app only listens locally.

The proxy must:

- Forward **everything** to the app, not just `/api`. The app serves the pages, the API, the LTI endpoints (`/lti`, `/keys`) and the health check.
- Pass WebSocket upgrades for `/api/voice/ws` (spoken input).
- Not buffer responses, so chat replies stream as they are written.
- Preserve the `Host` header.

Apache example (needs `mod_proxy`, `mod_proxy_http`, `mod_proxy_wstunnel`), inside your HTTPS virtual host:

```
ProxyPreserveHost On
ProxyPass /api/voice/ws ws://127.0.0.1:3001/api/voice/ws
ProxyPassReverse /api/voice/ws ws://127.0.0.1:3001/api/voice/ws
ProxyPass / http://127.0.0.1:3001/
ProxyPassReverse / http://127.0.0.1:3001/
```

With Caddy, which obtains the HTTPS certificate for you, two lines are enough; see `scripts/Caddyfile.example`.

If more than one proxy sits in front of the app, set `TRUST_PROXY_HOPS` to the number of proxies.

## 6. Connect your LMS and finish setup

1. Register the tool with Canvas: [Canvas setup](Canvas-Setup.md).
2. Launch the tool from Canvas as an administrator and open the **Instance** tab.
3. Work down the **Setup checklist**: add models, choose a default, and run the connection test.

Details are in [Instance administration](Instance-Admin.md).

## Upgrading

1. Stop the app.
2. Back up the database (below).
3. Update the code, then repeat step 2 of this guide (install and build).
4. Start the app. Pending database changes are applied automatically on startup.

To apply database changes yourself instead, set `DB_AUTO_MIGRATE=false` and run `npm run db:migrate` before starting.

## Backups

Everything the installation knows is in its PostgreSQL database, plus two values in `.env`:

- **The database.** Back it up with your usual PostgreSQL tooling, for example `pg_dump ltisim | gzip > ltisim-$(date +%F).sql.gz`. Include all tables: the LMS registration and its keys are stored there too.
- **`LTI_KEY`.** A database backup is useless for LTI without the `LTI_KEY` it was created with. Store it somewhere safe and separate.

An administrator can also download a JSON export of all data from the Instance area. That is for portability and records requests, not a substitute for a database backup: it cannot be loaded back in.

## Useful commands

Run from `backend/`:

| Command | What it does |
|---|---|
| `npm run db:migrate` | Apply pending database changes |
| `npm run platform:show` | Show the registered LMS and the tool's URLs |
| `npm run platform:register` | Register the LMS described by the `LMS_*` settings |
| `npm run platform:reset` | Remove the registered LMS. Add `-- --force` to also delete all course data tied to it |
| `npm run templates:seed` | Re-add any missing sample templates |
| `npm test` | Run the unit tests |

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Canvas shows an error when launching | `PUBLIC_URL` does not match the address Canvas uses, or it is not HTTPS |
| Launch works in one browser but not another | Third-party cookies are blocked inside the LMS frame. Set `LTI_DEV_MODE=true` and restart |
| "Tool not configured for this institution" | The launch came from an LMS other than the registered one |
| "Session expired; relaunch from your LMS" | The launch is older than `LTI_SESSION_HOURS` (default 24). Open the tool again from Canvas |
| Assignments will not run | No default model is set. Open Instance, then Models |
| Chat replies arrive all at once | The reverse proxy is buffering responses |
| Spoken input only works in some browsers, or not at all | Read the `[voice]` line in the server log: it says what voice is using. If it says Amazon Transcribe, the proxy is probably not passing WebSocket upgrades for `/api/voice/ws`. See [Voice](Voice.md) |
| No spoken replies | Replies need Amazon Polly. See [Voice](Voice.md) |
