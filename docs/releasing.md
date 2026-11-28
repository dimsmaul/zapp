# Releasing

One repo, one branch (`main`), three independent tags. The tag prefix decides which workflow runs.

| Tag | Workflow | Output |
|---|---|---|
| `server-vX.Y.Z` | `release-server.yml` | `ghcr.io/<owner>/zapp-server:X.Y.Z` + `latest`, GitHub release, **deploy to Oracle VM** |
| `web-vX.Y.Z` | `release-web.yml` | `ghcr.io/<owner>/zapp-web:X.Y.Z` + `latest`, GitHub release |
| `extension-vX.Y.Z` | `release-extension.yml` | `zapp-extension-X.Y.Z.zip` on a GitHub release |

`ci.yml` runs on every PR and push to `main` (server tests, web build, extension syntax check). Nothing deploys on a plain push.

## Pre-release (beta)

Add `-beta.N`: `server-v0.2.0-beta.1`, `web-v0.2.0-beta.1`, `extension-v0.2.0-beta.1`.

- Marked as a GitHub *pre-release*; image tag `:X.Y.Z-beta.N` + `:beta` (never `latest`).
- Server beta: image only, **no deploy**. The startup log prints the version.
- Web beta: the sidebar shows a **Beta** badge.
- Extension beta: named **Zapp Beta**, popup shows a **Beta** badge. Chrome needs numeric versions, so manifest `version` is `X.Y.Z` and `version_name` is `X.Y.Z-beta.N`. Install the zip manually; upload only stable zips to the Chrome Web Store.

## Cut a release

```sh
git tag server-v0.2.0-beta.1 && git push origin server-v0.2.0-beta.1   # beta
git tag server-v0.2.0 && git push origin server-v0.2.0                 # stable
```

The tag is the version; nothing in the repo needs bumping. Tag the commit you want built (any commit on `main`).

## Notes

- The hosted web app is still deployed by Vercel from `main`; `web-v*` only publishes the Docker image for self-hosting.
- Server deploy needs the repo secrets `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`, `SSH_KNOWN_HOSTS` (optional `SSH_PORT`) and optional variables `DEPLOY_ARCH`, `DEPLOY_PATH`, `SERVER_PORT`.
- A stable `extension-v*` tag also uploads the zip to the Chrome Web Store and submits it for review. It needs the repo secrets `CWS_EXTENSION_ID`, `CWS_PUBLISHER_ID` (the id in your dashboard URL, `.../devconsole/<publisher-id>/...`), `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET` and `CWS_REFRESH_TOKEN`. Beta tags never go to the store.
- The store refuses an upload while the previous version is still in review, and a new permission needs its justification filled in on the dashboard first. The GitHub release is created either way, so a failed store step can be retried by uploading the zip by hand.
- GHCR packages are private by default; make them public in the package settings if others should pull them.
