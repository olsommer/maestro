#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ASSET_DIR="${ROOT_DIR}/docker/firecracker-rootfs"
IMAGE_TAG="${MAESTRO_FIRECRACKER_ROOTFS_IMAGE:-maestro-firecracker-rootfs:latest}"
OUTPUT_DIR="${MAESTRO_FIRECRACKER_ASSET_DIR:-$HOME/.maestro/firecracker}"
ROOTFS_PATH="${MAESTRO_FIRECRACKER_ROOTFS:-$OUTPUT_DIR/rootfs.ext4}"
KERNEL_PATH="${MAESTRO_FIRECRACKER_KERNEL:-$OUTPUT_DIR/vmlinux}"
ROOTFS_SIZE_MB="${MAESTRO_FIRECRACKER_ROOTFS_SIZE_MB:-12288}"
WORK_DIR="$(mktemp -d)"
CONTAINER_NAME="maestro-firecracker-rootfs-$$"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

mkdir -p "$OUTPUT_DIR"

echo "Building Firecracker guest rootfs image..."
docker build -t "$IMAGE_TAG" -f "$ASSET_DIR/Dockerfile" "$ROOT_DIR"

echo "Exporting guest filesystem..."
docker create --name "$CONTAINER_NAME" "$IMAGE_TAG" >/dev/null
mkdir -p "$WORK_DIR/rootfs"
docker export "$CONTAINER_NAME" | tar -C "$WORK_DIR/rootfs" -xf -

rm -f "$ROOTFS_PATH"
truncate -s "${ROOTFS_SIZE_MB}M" "$ROOTFS_PATH"
mkfs.ext4 -F -d "$WORK_DIR/rootfs" "$ROOTFS_PATH" >/dev/null

if [[ -z "${MAESTRO_FIRECRACKER_KERNEL:-}" ]]; then
  for candidate in \
    /boot/vmlinux \
    /boot/vmlinux-$(uname -r) \
    /var/lib/maestro/firecracker/vmlinux \
    "$OUTPUT_DIR/vmlinux"; do
    if [[ -f "$candidate" ]]; then
      cp "$candidate" "$KERNEL_PATH"
      break
    fi
  done
fi

if [[ ! -f "$KERNEL_PATH" ]]; then
  echo "No Firecracker-compatible kernel image found."
  echo "Set MAESTRO_FIRECRACKER_KERNEL to an uncompressed vmlinux path and rerun this script."
  exit 1
fi

echo "Firecracker assets ready:"
echo "  Rootfs: $ROOTFS_PATH"
echo "  Kernel: $KERNEL_PATH"
