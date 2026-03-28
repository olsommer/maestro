#!/usr/bin/env bash

# Get terminal width, default to 40
W=${COLUMNS:-$(tput cols 2>/dev/null || echo 40)}
BANNER=$(printf '%*s' "$W" '' | tr ' ' '=')
PNPM_VERSION=10.32.1
INSTALL_ROOT=${MAESTRO_INSTALL_ROOT:-}
BUILD_FIRECRACKER_ROOTFS_SCRIPT=${INSTALL_ROOT:+$INSTALL_ROOT/assets/build-firecracker-rootfs.sh}

if [[ -z "${BUILD_FIRECRACKER_ROOTFS_SCRIPT:-}" ]]; then
  BUILD_FIRECRACKER_ROOTFS_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/build-firecracker-rootfs.sh"
fi

MAESTRO_FIRECRACKER_ASSET_DIR="${MAESTRO_FIRECRACKER_ASSET_DIR:-$HOME/.maestro/firecracker}"
MAESTRO_FIRECRACKER_KERNEL="${MAESTRO_FIRECRACKER_KERNEL:-$MAESTRO_FIRECRACKER_ASSET_DIR/vmlinux}"
MAESTRO_FIRECRACKER_ROOTFS="${MAESTRO_FIRECRACKER_ROOTFS:-$MAESTRO_FIRECRACKER_ASSET_DIR/rootfs.ext4}"

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

run_as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif have_cmd sudo; then
    sudo "$@"
  else
    "$@"
  fi
}

print_section() {
  local title=$1
  echo "$BANNER"
  echo "  $title"
  echo "$BANNER"
  echo ""
}

print_note() {
  echo "Note: $1"
}

print_success() {
  echo "OK: $1"
}

print_warning() {
  echo "Warning: $1"
}

prompt_yes_no() {
  local prompt=$1
  local answer
  read -rp "$prompt" answer
  [[ -z "$answer" || "$answer" =~ ^[Yy]$ ]]
}

run_step() {
  local label=$1
  shift

  echo "Running: $label"
  echo ""
  "$@" || echo "($label exited with error)"
}

is_linux() {
  [[ "$(uname -s)" == "Linux" ]]
}

install_with_npm() {
  local package_name=$1
  local binary=$2

  if ! have_cmd npm; then
    echo "npm not found. Install Node.js/npm first, then rerun \`maestro onboard\`."
    return 1
  fi

  run_step "npm install -g ${package_name}@latest" npm install -g "${package_name}@latest"

  if have_cmd "$binary"; then
    print_success "$binary installed successfully."
    return 0
  fi

  print_warning "$binary is still not available after the npm install attempt."
  return 1
}

install_system_package() {
  local binary=$1
  local label=$2
  shift 2
  local brew_pkg=${1:-}
  local apt_pkg=${2:-}
  local dnf_pkg=${3:-}
  local yum_pkg=${4:-}
  local pacman_pkg=${5:-}

  if have_cmd "$binary"; then
    return 0
  fi

  if have_cmd brew && [[ -n "$brew_pkg" ]]; then
    run_step "brew install $brew_pkg" brew install "$brew_pkg"
  elif have_cmd apt-get && [[ -n "$apt_pkg" ]]; then
    run_step "apt-get update" run_as_root apt-get update
    run_step "apt-get install -y $apt_pkg" run_as_root apt-get install -y "$apt_pkg"
  elif have_cmd dnf && [[ -n "$dnf_pkg" ]]; then
    run_step "dnf install -y $dnf_pkg" run_as_root dnf install -y "$dnf_pkg"
  elif have_cmd yum && [[ -n "$yum_pkg" ]]; then
    run_step "yum install -y $yum_pkg" run_as_root yum install -y "$yum_pkg"
  elif have_cmd pacman && [[ -n "$pacman_pkg" ]]; then
    run_step "pacman -Sy --noconfirm $pacman_pkg" run_as_root pacman -Sy --noconfirm "$pacman_pkg"
  else
    echo "$label installation is not automated on this system."
    echo "Install it manually, then rerun \`maestro onboard\`."
    return 1
  fi

  if have_cmd "$binary"; then
    print_success "$label installed successfully."
    return 0
  fi

  print_warning "$label is still not available after the install attempt."
  return 1
}

install_gh() {
  install_system_package gh "GitHub CLI" gh gh gh gh github-cli
}

install_curl() {
  install_system_package curl "curl" curl curl curl curl curl
}

install_ripgrep() {
  install_system_package rg "ripgrep" ripgrep ripgrep ripgrep ripgrep ripgrep
}

install_bubblewrap() {
  if ! is_linux; then
    echo "bubblewrap is only required for Linux sandboxing. Skipping on this system."
    return 0
  fi

  install_system_package bwrap "bubblewrap" "" bubblewrap bubblewrap bubblewrap bubblewrap
}

install_corepack() {
  install_with_npm "corepack" "corepack"
}

install_docker() {
  if have_cmd docker; then
    return 0
  fi

  install_system_package docker "Docker" docker docker.io docker docker docker
}

install_socat() {
  install_system_package socat "socat" socat socat socat socat socat
}

install_virtiofsd() {
  install_system_package virtiofsd "virtiofsd" "" virtiofsd virtiofsd virtiofsd virtiofsd
}

normalize_firecracker_arch() {
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

resolve_firecracker_version() {
  if [[ -n "${MAESTRO_FIRECRACKER_VERSION:-}" ]]; then
    echo "${MAESTRO_FIRECRACKER_VERSION}"
    return 0
  fi

  curl -fsSL "https://api.github.com/repos/firecracker-microvm/firecracker/releases/latest" \
    | sed -n 's/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' \
    | head -n1
}

install_firecracker() {
  if ! is_linux; then
    print_note "Firecracker install is only supported on Linux."
    return 1
  fi

  if have_cmd firecracker; then
    print_success "Firecracker is already installed."
    if have_cmd jailer; then
      print_success "Jailer is already installed."
    fi
    return 0
  fi

  local arch
  arch="$(normalize_firecracker_arch)" || {
    print_warning "Unsupported CPU architecture for automated Firecracker install: $(uname -m)"
    return 1
  }

  local version
  version="$(resolve_firecracker_version)"
  if [[ -z "$version" ]]; then
    print_warning "Could not resolve the latest Firecracker release version."
    return 1
  fi

  local work_dir
  work_dir="$(mktemp -d)"
  local archive_name="firecracker-${version}-${arch}.tgz"
  local archive_url="https://github.com/firecracker-microvm/firecracker/releases/download/${version}/${archive_name}"
  local release_dir="${work_dir}/release-${version}-${arch}"

  print_note "Installing Firecracker ${version} for ${arch} from the official GitHub release."

  if ! run_step "curl -L ${archive_url} -o ${archive_name}" \
    curl -fL "$archive_url" -o "${work_dir}/${archive_name}"; then
    rm -rf "$work_dir"
    print_warning "Failed to download Firecracker release archive."
    return 1
  fi

  if ! run_step "tar -xzf ${archive_name}" tar -xzf "${work_dir}/${archive_name}" -C "$work_dir"; then
    rm -rf "$work_dir"
    print_warning "Failed to extract Firecracker release archive."
    return 1
  fi

  if [[ ! -x "${release_dir}/firecracker-${version}-${arch}" ]]; then
    rm -rf "$work_dir"
    print_warning "Firecracker binary was not found in the extracted release archive."
    return 1
  fi

  run_step "install firecracker to /usr/local/bin" \
    run_as_root install -m 0755 "${release_dir}/firecracker-${version}-${arch}" /usr/local/bin/firecracker

  if [[ -x "${release_dir}/jailer-${version}-${arch}" ]]; then
    run_step "install jailer to /usr/local/bin" \
      run_as_root install -m 0755 "${release_dir}/jailer-${version}-${arch}" /usr/local/bin/jailer
  fi

  rm -rf "$work_dir"

  if have_cmd firecracker; then
    print_success "Firecracker installed successfully."
    return 0
  fi

  print_warning "Firecracker is still not available after the install attempt."
  return 1
}

install_pnpm() {
  if have_cmd pnpm; then
    return 0
  fi

  if have_cmd corepack; then
    run_step "corepack enable" corepack enable
    run_step "corepack prepare pnpm@${PNPM_VERSION} --activate" \
      corepack prepare "pnpm@${PNPM_VERSION}" --activate
  else
    install_with_npm "pnpm@${PNPM_VERSION}" "pnpm"
    return $?
  fi

  if have_cmd pnpm; then
    echo "pnpm installed successfully."
    return 0
  fi

  echo "pnpm is still not available after the install attempt."
  return 1
}

install_claude() {
  install_with_npm "@anthropic-ai/claude-code" "claude"
}

install_codex() {
  install_with_npm "@openai/codex" "codex"
}

build_firecracker_assets() {
  if ! is_linux; then
    echo "Firecracker assets are only supported on Linux. Skipping."
    return 1
  fi

  if [[ ! -x "$BUILD_FIRECRACKER_ROOTFS_SCRIPT" ]]; then
    chmod +x "$BUILD_FIRECRACKER_ROOTFS_SCRIPT" 2>/dev/null || true
  fi

  if [[ ! -x "$BUILD_FIRECRACKER_ROOTFS_SCRIPT" ]]; then
    echo "Firecracker asset builder not found at $BUILD_FIRECRACKER_ROOTFS_SCRIPT."
    return 1
  fi

  run_step "Build Firecracker guest assets" "$BUILD_FIRECRACKER_ROOTFS_SCRIPT"
}

firecracker_ready_for_maestro() {
  is_linux || return 1
  [[ -e /dev/kvm ]] || return 1
  have_cmd firecracker || return 1
  have_cmd virtiofsd || return 1
  have_cmd socat || return 1
  have_cmd curl || return 1
  [[ -f "$MAESTRO_FIRECRACKER_KERNEL" ]] || return 1
  [[ -f "$MAESTRO_FIRECRACKER_ROOTFS" ]] || return 1
}

ensure_tool() {
  local binary=$1
  local label=$2
  local installer=$3

  if have_cmd "$binary"; then
    print_success "$label is already installed."
    return 0
  fi

  print_note "$label is not installed yet."
  if ! prompt_yes_no "Install $label now? (Y/n) "; then
    print_warning "Skipping $label installation."
    return 1
  fi

  "$installer"
}

prompt_default_sandbox() {
  local answer
  while true; do
    read -rp "Choose default sandbox provider [F]irecracker/[d]ocker (default: Firecracker): " answer
    answer=${answer,,}
    case "$answer" in
      ""|f|firecracker)
        echo "firecracker"
        return 0
        ;;
      d|docker)
        echo "docker"
        return 0
        ;;
    esac
    echo "Enter Firecracker or Docker."
  done
}

print_section "Maestro First-Run Setup"
print_note "Press Enter to accept the default on prompts."
print_note "This setup installs local tooling and authenticates CLIs on this machine."
echo ""

print_section "Host Dependencies"
ensure_tool corepack "corepack" install_corepack
echo ""

ensure_tool curl "curl" install_curl
echo ""

ensure_tool pnpm "pnpm" install_pnpm
echo ""

ensure_tool rg "ripgrep" install_ripgrep
echo ""

ensure_tool bwrap "bubblewrap" install_bubblewrap
echo ""

print_section "Sandbox Runtimes"
print_note "Docker and Firecracker are both prepared when the host supports them."
echo ""

ensure_tool docker "Docker" install_docker
echo ""

if is_linux; then
  ensure_tool socat "socat" install_socat
  echo ""

  ensure_tool virtiofsd "virtiofsd" install_virtiofsd
  echo ""

  ensure_tool firecracker "Firecracker" install_firecracker
  echo ""

  if have_cmd firecracker && prompt_yes_no "Build Firecracker guest image assets now? (Y/n) "; then
    build_firecracker_assets || print_warning "Firecracker guest asset build skipped or failed."
  elif ! have_cmd firecracker; then
    print_note "Skipping Firecracker guest image build because Firecracker is not installed yet."
  fi
  echo ""
else
  print_note "Firecracker install is only supported on Linux. Docker will remain the only sandbox runtime on this host."
  echo ""
fi

print_section "Authentication"
print_note "GitHub, Claude, and Codex auth prepared here can be reused by Maestro later."
echo ""

if ensure_tool gh "GitHub CLI" install_gh; then
  echo "Checking GitHub CLI authentication..."
  if gh auth status >/dev/null 2>&1; then
    print_success "GitHub CLI is already authenticated."
  else
    print_note "GitHub CLI is not authenticated."
    echo "Running: gh auth login"
    echo ""
    if [[ -n "${GH_PAT:-}" ]]; then
      printf '%s' "$GH_PAT" | gh auth login --with-token || echo "(gh auth login exited with error)"
    else
      gh auth login || echo "(gh auth login exited with error)"
    fi
  fi
fi
echo ""

# --- Claude Code ---
if prompt_yes_no "Do you want to use Claude Code? (Y/n) "; then
  if ensure_tool claude "Claude Code CLI" install_claude; then
    echo "Checking Claude Code authentication..."
    if claude auth status >/dev/null 2>&1; then
      print_success "Claude Code is already authenticated."
    else
      echo "Running: claude auth login"
      echo ""
      claude auth login || echo "(claude auth login exited with error)"
    fi
  fi
fi
echo ""

# --- Codex ---
if prompt_yes_no "Do you want to use Codex? (Y/n) "; then
  if ensure_tool codex "Codex CLI" install_codex; then
    echo "Checking Codex authentication..."
    if codex login status >/dev/null 2>&1; then
      print_success "Codex is already authenticated."
    else
      echo "Running: codex login --device-auth"
      echo ""
      codex login --device-auth || echo "(codex login --device-auth exited with error)"
    fi
  fi
fi
echo ""

DEFAULT_SANDBOX_PROVIDER="docker"
print_section "Sandbox Default"
if firecracker_ready_for_maestro; then
  DEFAULT_SANDBOX_PROVIDER="$(prompt_default_sandbox)"
  print_success "Selected default sandbox provider: $DEFAULT_SANDBOX_PROVIDER"
else
  print_note "Firecracker is not fully ready on this host. Docker will be the only offered sandbox provider."
  print_success "Default sandbox provider: Docker"
fi
echo "__MAESTRO_SANDBOX_PROVIDER__=${DEFAULT_SANDBOX_PROVIDER}"
echo ""

print_section "Setup Complete"
print_note "You can rerun this anytime with: maestro onboard"
echo "__MAESTRO_SETUP_DONE__"
