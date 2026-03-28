#!/usr/bin/env bash
set -euo pipefail

mount -t proc proc /proc
mount -t sysfs sys /sys
mount -t devtmpfs dev /dev || true
mkdir -p /dev/pts
mount -t devpts devpts /dev/pts || true

CMDLINE="$(cat /proc/cmdline)"

get_arg() {
  local key="$1"
  echo "$CMDLINE" | tr ' ' '\n' | sed -n "s/^${key}=//p" | tail -n1
}

HOME_DIR="$(get_arg maestro.home)"
PROJECT_DIR="$(get_arg maestro.project)"
MOUNTS="$(get_arg maestro.mounts)"
SHELL_PORT="$(get_arg maestro.shell_port)"
GUEST_IP="$(get_arg maestro.guest_ip)"
GATEWAY_IP="$(get_arg maestro.gateway_ip)"

mkdir -p "$HOME_DIR" "$PROJECT_DIR" /workspace/secondary

IFS=',' read -ra MOUNT_ENTRIES <<< "$MOUNTS"
for entry in "${MOUNT_ENTRIES[@]}"; do
  [[ -z "$entry" ]] && continue
  tag="${entry%%:*}"
  target="${entry#*:}"
  mkdir -p "$target"
  mount -t virtiofs "$tag" "$target"
done

if [[ -n "$GUEST_IP" ]]; then
  ip link set dev eth0 up || true
  ip addr add "$GUEST_IP" dev eth0 || true
  if [[ -n "$GATEWAY_IP" ]]; then
    ip route add default via "$GATEWAY_IP" dev eth0 || true
  fi
fi

mkdir -p /var/run/docker
dockerd > /var/log/dockerd.log 2>&1 &

for _ in $(seq 1 40); do
  if docker version >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

export HOME="$HOME_DIR"
export USER=root
export TERM=xterm-256color
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
cd "$PROJECT_DIR"

exec socat "VSOCK-LISTEN:${SHELL_PORT},reuseaddr,fork" EXEC:/usr/local/bin/maestro-login-shell.sh,pty,stderr,setsid,sigint,sane
