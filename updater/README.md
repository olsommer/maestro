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
STACK_DIR=/absolute/path/to/your/maestro/checkout
RELEASES_DIR=
CURRENT_LINK=
UPDATE_SERVICES=server
```

Notes:

- `STACK_DIR` must be the absolute host path of the Maestro checkout that Docker Compose uses.
- The updater container mounts `STACK_DIR` back into itself at the same absolute path so Docker socket builds resolve correctly.
- If `RELEASES_DIR` is empty, the updater defaults it to `${STACK_DIR}/releases`.
- If `CURRENT_LINK` is empty, the updater defaults it to `${STACK_DIR}/current`.
- `UPDATE_SERVICES` defaults to `server`; keep the updater itself outside this list.
- `GITHUB_TOKEN` is optional for public repos, but recommended to avoid rate limits.
- `UPDATER_TOKEN` is optional on the internal Docker network. Set it if you want explicit request authentication.

## Compose Topology

Example:

```text
/absolute/path/to/maestro
  .env
  current -> /absolute/path/to/maestro/releases/v0.1.0
  releases/
    v0.1.0/
    v0.1.1/
```

The stack looks like this:

- `server` calls `http://updater:4810`
- `updater` has `/var/run/docker.sock`
- `updater` mounts `${STACK_DIR}:${STACK_DIR}`
- redeploys rebuild `server` from the extracted release under `${STACK_DIR}/releases/<tag>`

## Compose Usage

```bash
cp updater/updater.env.example .env
# edit STACK_DIR to the absolute path of this checkout

docker compose up -d --build
```

Host requirements:

- `docker` with `docker compose`
- `tar`

## Maestro server integration

The bundled `docker-compose.yml` wires this automatically:

```yaml
server:
  environment:
    UPDATER_URL: http://updater:4810
    UPDATER_TOKEN: ${UPDATER_TOKEN:-}

updater:
  environment:
    STACK_DIR: ${STACK_DIR}
    UPDATER_TOKEN: ${UPDATER_TOKEN:-}
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
    - ${STACK_DIR}:${STACK_DIR}
```

If you expose the updater outside the Docker network, keep `UPDATER_TOKEN` set. If it stays internal to Compose, the token can be left blank.
