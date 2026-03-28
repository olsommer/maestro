#!/usr/bin/env bash
set -euo pipefail

IMAGE_TAG="${MAESTRO_FIRECRACKER_ROOTFS_IMAGE:-maestro-firecracker-rootfs:latest}"
OUTPUT_DIR="${MAESTRO_FIRECRACKER_ASSET_DIR:-$HOME/.maestro/firecracker}"
ROOTFS_PATH="${MAESTRO_FIRECRACKER_ROOTFS:-$OUTPUT_DIR/rootfs.ext4}"
KERNEL_PATH="${MAESTRO_FIRECRACKER_KERNEL:-$OUTPUT_DIR/vmlinux}"
ROOTFS_SIZE_MB="${MAESTRO_FIRECRACKER_ROOTFS_SIZE_MB:-12288}"
WORK_DIR="$(mktemp -d)"
CONTAINER_NAME="maestro-firecracker-rootfs-$$"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_CONTEXT_DIR="${WORK_DIR}/build-context"

normalize_arch() {
  case "$(uname -m)" in
    x86_64|amd64)
      echo "x86_64"
      ;;
    aarch64|arm64)
      echo "aarch64"
      ;;
    *)
      return 1
      ;;
  esac
}

find_extract_vmlinux() {
  local candidate
  local -a candidates=(
    "/usr/src/linux-headers-$(uname -r)/scripts/extract-vmlinux"
    "/usr/lib/modules/$(uname -r)/build/scripts/extract-vmlinux"
  )

  while IFS= read -r candidate; do
    candidates+=("$candidate")
  done < <(find /usr/lib -path '*/scripts/extract-vmlinux' -type f 2>/dev/null | sort)

  for candidate in "${candidates[@]}"; do
    if [[ -x "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

copy_kernel_candidate() {
  local candidate
  for candidate in "$@"; do
    if [[ -f "$candidate" ]]; then
      cp "$candidate" "$KERNEL_PATH"
      return 0
    fi
  done

  return 1
}

extract_host_kernel() {
  local extractor source temp_path
  extractor="$(find_extract_vmlinux)" || return 1

  for source in \
    "/boot/vmlinuz-$(uname -r)" \
    "/boot/vmlinuz" \
    "/usr/lib/modules/$(uname -r)/vmlinuz"; do
    if [[ -f "$source" ]]; then
      temp_path="${WORK_DIR}/vmlinux.extracted"
      if "$extractor" "$source" >"$temp_path" 2>/dev/null && [[ -s "$temp_path" ]]; then
        mv "$temp_path" "$KERNEL_PATH"
        return 0
      fi
    fi
  done

  return 1
}

download_fallback_kernel() {
  local arch kernel_url
  arch="$(normalize_arch)" || return 1
  kernel_url="${MAESTRO_FIRECRACKER_KERNEL_URL:-https://s3.amazonaws.com/spec.ccfc.min/img/quickstart_guide/${arch}/kernels/vmlinux.bin}"

  echo "Downloading Firecracker guest kernel from ${kernel_url}..."
  curl -fsSL "$kernel_url" -o "$KERNEL_PATH"
}

ensure_kernel() {
  if [[ -f "$KERNEL_PATH" ]]; then
    return 0
  fi

  if copy_kernel_candidate \
    "/usr/lib/debug/boot/vmlinux-$(uname -r)" \
    "/boot/vmlinux-$(uname -r)" \
    "/boot/vmlinux" \
    "/var/lib/maestro/firecracker/vmlinux" \
    "$OUTPUT_DIR/vmlinux"; then
    return 0
  fi

  if extract_host_kernel; then
    echo "Extracted Firecracker guest kernel from the host kernel image."
    return 0
  fi

  if download_fallback_kernel; then
    echo "Downloaded fallback Firecracker guest kernel."
    return 0
  fi

  return 1
}

resolve_layout() {
  if [[ -f "${SCRIPT_DIR}/../package.json" && -d "${SCRIPT_DIR}/docker/firecracker-rootfs" ]]; then
    mkdir -p "${BUILD_CONTEXT_DIR}/docker/firecracker-rootfs"
    cp -R "${SCRIPT_DIR}/docker/firecracker-rootfs/." "${BUILD_CONTEXT_DIR}/docker/firecracker-rootfs/"
    ROOT_DIR="${BUILD_CONTEXT_DIR}"
    ASSET_DIR="${ROOT_DIR}/docker/firecracker-rootfs"
    return 0
  fi

  ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
  ASSET_DIR="${ROOT_DIR}/docker/firecracker-rootfs"
}

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT
resolve_layout

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

if ! ensure_kernel; then
  echo "No Firecracker-compatible kernel image found."
  echo "Install Linux kernel headers or set MAESTRO_FIRECRACKER_KERNEL to an uncompressed vmlinux path and rerun this script."
  exit 1
fi

if [[ ! -f "$KERNEL_PATH" ]]; then
  echo "No Firecracker-compatible kernel image found."
  echo "Install Linux kernel headers or set MAESTRO_FIRECRACKER_KERNEL to an uncompressed vmlinux path and rerun this script."
  exit 1
fi

echo "Firecracker assets ready:"
echo "  Rootfs: $ROOTFS_PATH"
echo "  Kernel: $KERNEL_PATH"
