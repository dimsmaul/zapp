# Zapp

Capture a bug in the browser, share a link, and let your team see what happened.

Zapp records a tab or takes a screenshot, attaches the console logs, user actions, and network requests from the same moment, and turns it into a report you can share. Open the link and the recording plays next to a DevTools-style panel that follows along.

## Features

- **Chrome extension** to record a tab or take a screenshot. After you stop, a preview dialog opens on the same page so you can check the capture before saving.
- **Diagnostics** captured with the media: console messages, user actions, and network requests (including headers and JSON bodies), recorded through `chrome.debugger`.
- **Report page** with a custom video player, a Chrome-style network list with a waterfall, and a request inspector (Headers, Payload, Preview, Response, Timing). Selecting an event seeks the video to that moment.
- **Workspaces** with email and password sign-in, a workspace switcher, report cards with search and filters, and public or private visibility.
- **Share links** with expiry that you can revoke without touching the report.
- **MCP endpoint** so an AI client can read reports and their debugger data.

## Repository layout

| Path | What it is |
| --- | --- |
| `apps/server` | Rust API (Axum), MongoDB storage, S3-compatible object storage, and a background worker that processes debugger data. |
| `apps/web` | React 19, Vite, Tailwind CSS 4, and TanStack Router and Query. Uses Bun as the package manager. |
| `apps/extension` | Manifest V3 Chrome extension in plain JavaScript. No build step. |
| `docs` | [API reference](docs/zapp-rust-endpoints.md) and the [capture and replay PRD](docs/crikket-capture-replay-prd.md). |

## Quick start with Docker

You need Docker with Compose.

```bash
cp .env.example .env
docker compose up --build
```

This starts MongoDB (as a single-node replica set, which the server needs for transactions), applies the schema, and runs the server and the web app.

| Service | URL |
| --- | --- |
| Web | http://localhost:5173 |
| Server | http://localhost:8080 (`/healthz`, `/readyz`) |

Uploads and playback need object storage. Leave `ZAPP_STORAGE_BUCKET` blank to start without them. To enable them, create a private bucket (the example file assumes Cloudflare R2) and fill in the `ZAPP_STORAGE_*` values in `.env`.

Start the debugger worker too, so diagnostics are processed after each upload:

```bash
docker compose --profile worker up --build
```

### Use MongoDB Atlas instead

Set `ZAPP_MONGODB_URI` (and optionally `ZAPP_MONGODB_DATABASE`) in `.env`, then:

```bash
docker compose -f docker-compose.yml -f docker-compose.atlas.yml up --build
```

The Atlas override moves the bundled MongoDB behind the `local-mongo` profile, so it no longer starts.

## Local development

### Server

Requires Rust 1.93 or newer and a MongoDB replica set (for example the one from Docker Compose).

```bash
cd apps/server
export ZAPP_MONGODB_URI='mongodb://127.0.0.1:27017/?directConnection=true&replicaSet=zapp'
cargo run -- migrate   # apply the schema
cargo run              # serve on 127.0.0.1:8080
cargo run -- worker    # process debugger data (needs object storage)
```

### Web

```bash
cd apps/web
bun install
bun run dev
```

The dev server proxies `/api` to `http://127.0.0.1:8080`. `bun run build` runs `tsc --noEmit` and then `vite build`.

### Extension

1. Open `chrome://extensions` in Chrome 118 or newer and turn on **Developer mode**.
2. Choose **Load unpacked** and select `apps/extension`.
3. Open the extension, enter your Zapp server URL (HTTPS, or HTTP on `localhost`), approve the permission request, and sign in.
4. Open the website tab you want to capture, then pick **Record tab** or **Screenshot**.

Recording uses the `debugger` permission, so Chrome shows its "is debugging this browser" banner while a capture runs.

## Configuration

Docker Compose reads these from `.env`. Copy `.env.example` for the full list with comments.

| Variable | Purpose | Default |
| --- | --- | --- |
| `ZAPP_MONGODB_URI` | MongoDB connection string. Required outside Compose. | Compose's local MongoDB |
| `ZAPP_MONGODB_DATABASE` | Database name. | `zapp` |
| `ZAPP_BIND_ADDR` | Address the server listens on. | `127.0.0.1:8080` (`0.0.0.0:8080` in the image) |
| `ZAPP_WEB_ORIGIN` | Web app origin allowed by CORS. | `http://localhost:5173` |
| `ZAPP_STORAGE_BUCKET` | Object storage bucket. Blank disables uploads and playback. | blank |
| `ZAPP_STORAGE_REGION` | Bucket region. | `auto` in `.env.example`, `us-east-1` if unset |
| `ZAPP_STORAGE_ENDPOINT` | S3 API endpoint, for example your R2 account endpoint. | blank |
| `ZAPP_STORAGE_ACCESS_KEY_ID`, `ZAPP_STORAGE_SECRET_ACCESS_KEY` | Credentials scoped to the bucket with object read and write access. | blank |

Never commit `.env`. Only `.env.example` and `.env.test.example` are tracked.

## Tests

```bash
cd apps/server
cargo check --locked --tests
```

The integration tests are marked `#[ignore]` because they need a disposable MongoDB replica set and an S3 mock. To run them:

```bash
docker compose --profile test up -d mongo mongo-init s3mock
cp .env.test.example .env.test.local   # then load it into your shell
cd apps/server && cargo test -- --ignored
```

Use a throwaway database for these. The tests write to the MongoDB at `ZAPP_TEST_MONGODB_URI`.

## Deployment

- **Server and worker** ship as Docker images built from `apps/server/Dockerfile`. Run `migrate` once per release before starting the new server. The image's entrypoint takes `migrate` or `worker` as its command.
- **Web** can be served by nginx from `apps/web/Dockerfile` (it proxies `/api/` to a `server` host), or deployed to Vercel.

### Server on an Oracle VM (GitHub Actions)

`.github/workflows/release-server.yml` runs when you push a stable `server-vX.Y.Z` tag. It builds the backend image, pushes it to GHCR, copies it to your VM over SSH, and restarts the stack with `deploy/docker-compose.prod.yml`. Beta tags (`server-vX.Y.Z-beta.N`) only publish the image. See [docs/releasing.md](docs/releasing.md) for all three tag types (server, web, extension) and pre-releases.

**One-time setup on the VM**

1. Install Docker with the Compose plugin, and let the SSH user run `docker`.
2. Create the deploy folder (default `~/zapp`) and a `.env` file in it with at least `ZAPP_MONGODB_URI`, `ZAPP_WEB_ORIGIN`, and the `ZAPP_STORAGE_*` values from `.env.example`. The workflow never touches this file.
3. Put a reverse proxy with TLS in front of `127.0.0.1:8080` for your public API hostname.

**Repository secrets** (Settings → Secrets and variables → Actions)

| Secret | Value |
| --- | --- |
| `SSH_HOST` | VM address |
| `SSH_USER` | SSH user that can run `docker` |
| `SSH_PRIVATE_KEY` | Private key for a deploy-only key pair. Add its public key to the VM's `authorized_keys`. |
| `SSH_KNOWN_HOSTS` | Output of `ssh-keyscan -p <port> <host>`, so the host key is pinned. |
| `SSH_PORT` | Optional, defaults to `22`. |

**Repository variables**

| Variable | Value |
| --- | --- |
| `DEPLOY_ARCH` | `arm64` for Oracle Ampere (A1) VMs. Leave unset for x86 (amd64). The image must match the VM's CPU. |
| `DEPLOY_PATH` | Optional, defaults to `~/zapp`. |
| `SERVER_PORT` | Optional, defaults to `8080`. |

A release applies the database migration first, restarts the server and worker, and then waits for `/readyz`. The previous image stays on the VM as `zapp-backend:previous`. To roll back, run `docker tag zapp-backend:previous zapp-backend:latest && docker compose up -d` in the deploy folder.

### Vercel

`apps/web/vercel.json` holds the build settings and rewrites `/api/*` to the server and every other path to `index.html`. For this to work:

- Set the project's **Root Directory** to `apps/web`. At the repository root there is no `package.json`, so Vercel would build nothing.
- Point the `/api/:path*` rewrite destination in `vercel.json` at your own server.
- `ignoreCommand` skips the build when the last commit did not touch `apps/web`.

## API and MCP

See the [API reference](docs/zapp-rust-endpoints.md) for every route, request contract, and access rule. The MCP endpoint is `POST /mcp` (Streamable HTTP) and authenticates with the same bearer token as the API. It exposes report metadata and normalized debugger data.
