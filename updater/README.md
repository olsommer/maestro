# Maestro Updater

This updater runs as a Docker Compose service by default.

It does three things:

1. Checks the latest GitHub release for a repo.
2. Downloads the release tarball into a versioned releases directory.
3. Rebuilds and restarts the configured Docker Compose services from that release.

## Why it is separate

The main Maestro app still should not talk to Docker directly. Instead, it proxies deployment actions to the dedicated `updater` service over the internal Compose network.

## Required environment

Start from [updater.env.example](updater.env.example).

```env
UPDATER_TOKEN=
GITHUB_REPO=olsommer/maestro
GITHUB_TOKEN=
COMPOSE_PROJECT_NAME=maestro
UPDATE_SERVICES=server
```

Notes:

- `COMPOSE_PROJECT_NAME` should stay fixed across redeploys so the stack keeps the same container and volume names.
- Release downloads and the `current` symlink live in the updater's internal `/state` volume.
- `UPDATE_SERVICES` defaults to `server`; keep the updater itself outside this list.
- `GITHUB_TOKEN` is optional for public repos, but recommended to avoid rate limits.
- `UPDATER_TOKEN` is optional on the internal Docker network. Set it if you want explicit request authentication.

## Compose Topology

The stack looks like this:

- `server` calls `http://updater:4810`
- `updater` has `/var/run/docker.sock`
- `updater` stores downloaded releases in the `updater_state` named volume
- redeploys rebuild `server` from the extracted release under `/state/releases/<tag>`
- `docker compose` commands use a fixed `COMPOSE_PROJECT_NAME` so they keep targeting the same stack

## Compose Usage

```bash
cp updater/updater.env.example .env
# optionally set GITHUB_TOKEN and a custom COMPOSE_PROJECT_NAME

docker compose up -d --build
```

Host requirements:

- `docker` with `docker compose`

## Maestro server integration

The bundled `docker-compose.yml` wires this automatically:

```yaml
server:
  environment:
    UPDATER_URL: http://updater:4810
    UPDATER_TOKEN: ${UPDATER_TOKEN:-}

updater:
  environment:
    COMPOSE_PROJECT_NAME: ${COMPOSE_PROJECT_NAME:-maestro}
    UPDATER_TOKEN: ${UPDATER_TOKEN:-}
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
    - updater_state:/state
```

If you expose the updater outside the Docker network, keep `UPDATER_TOKEN` set. If it stays internal to Compose, the token can be left blank.
