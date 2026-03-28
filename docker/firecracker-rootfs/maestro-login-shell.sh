#!/usr/bin/env bash
set -euo pipefail

export DOCKER_HOST=unix:///var/run/docker.sock
exec /bin/bash -l
