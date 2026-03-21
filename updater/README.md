# Maestro Updater

This service runs on the Docker host, not inside the main Maestro container.

It does three things:

1. Checks the latest GitHub release for a repo.
2. Downloads the release tarball into a versioned releases directory.
3. Rebuilds and restarts the configured Docker Compose services from that release.

## Why it is separate

The main Maestro app should not have direct Docker control over the host. Instead, the app proxies deployment actions to this updater over HTTP using `UPDATER_URL` and `UPDATER_TOKEN`.

## Required environment

Start from [updater.env.example](updater.env.example).

```env
UPDATER_TOKEN=replace-me
GITHUB_REPO=olsommer/maestro
GITHUB_TOKEN=
STACK_DIR=/opt/maestro
RELEASES_DIR=/opt/maestro/releases
CURRENT_LINK=/opt/maestro/current
COMPOSE_FILE=docker-compose.yml
UPDATE_SERVICES=server
UPDATER_HOST=127.0.0.1
UPDATER_PORT=4810
```

Notes:

- `STACK_DIR` is the stable project directory on the host.
- `CURRENT_LINK` should point at the active release directory.
- `UPDATE_SERVICES` defaults to `server`; keep the updater itself outside this list.
- `GITHUB_TOKEN` is optional for public repos, but recommended to avoid rate limits.

## Host layout

Example:

```text
/opt/maestro
  .env
  current -> /opt/maestro/releases/v0.1.0
  releases/
    v0.1.0/
    v0.1.1/
```

`docker compose` is run with `--project-directory /opt/maestro` and the compose file inside the selected release.

## Running manually

```bash
cd /opt/maestro/current
set -a
. /opt/maestro/updater.env
set +a
node updater/server.js
```

Node 22+ is expected.

Host requirements:

- `node` 22+
- `docker` with `docker compose`
- `tar`

## Suggested systemd unit

Use [maestro-updater.service.example](maestro-updater.service.example) as a starting point.

## Maestro server integration

If Maestro itself runs in Docker, set these on the `server` service:

```yaml
environment:
  UPDATER_URL: http://host.docker.internal:4810
  UPDATER_TOKEN: ${UPDATER_TOKEN}
extra_hosts:
  - "host.docker.internal:host-gateway"
```

If Maestro runs on bare metal, `UPDATER_URL=http://127.0.0.1:4810` is enough.
