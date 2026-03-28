#!/usr/bin/env bash

# Get terminal width, default to 40
W=${COLUMNS:-$(tput cols 2>/dev/null || echo 40)}
BANNER=$(printf '%*s' "$W" '' | tr ' ' '=')
PNPM_VERSION=10.32.1
INSTALL_ROOT=${MAESTRO_INSTALL_ROOT:-}
if [[ -t 1 ]]; then
  RESET=$'\033[0m'
  BOLD=$'\033[1m'
  DIM=$'\033[2m'
  FG_MUTED=$'\033[38;5;245m'
  FG_BLUE=$'\033[38;5;81m'
  FG_GREEN=$'\033[38;5;78m'
  FG_YELLOW=$'\033[38;5;221m'
  FG_RED=$'\033[38;5;203m'
  FG_CYAN=$'\033[38;5;117m'
else
  RESET=""
  BOLD=""
  DIM=""
  FG_MUTED=""
  FG_BLUE=""
  FG_GREEN=""
  FG_YELLOW=""
  FG_RED=""
  FG_CYAN=""
fi

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
  echo "${FG_MUTED}${BANNER}${RESET}"
  echo "  ${BOLD}${FG_BLUE}${title}${RESET}"
  echo "${FG_MUTED}${BANNER}${RESET}"
  echo ""
}

print_note() {
  echo "${FG_CYAN}•${RESET} ${FG_MUTED}$1${RESET}"
}

print_success() {
  echo "${FG_GREEN}✓${RESET} ${BOLD}${FG_GREEN}$1${RESET}"
}

print_warning() {
  echo "${FG_YELLOW}!${RESET} ${FG_YELLOW}$1${RESET}"
}

print_error() {
  echo "${FG_RED}✕${RESET} ${FG_RED}$1${RESET}"
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

  echo "${DIM}${FG_MUTED}Running:${RESET} ${DIM}${label}${RESET}"
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

normalize_gvisor_arch() {
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

gvisor_runtime_registered() {
  have_cmd docker || return 1
  docker info --format '{{json .Runtimes}}' 2>/dev/null | grep -q '"runsc"'
}

restart_docker_service() {
  if have_cmd systemctl; then
    run_step "systemctl restart docker" run_as_root systemctl restart docker
    return 0
  fi
  if have_cmd service; then
    run_step "service docker restart" run_as_root service docker restart
    return 0
  fi
  print_note "Docker daemon restart is not automated on this host. Restart Docker manually if gVisor does not appear in \`docker info\`."
  return 1
}

install_gvisor() {
  if ! is_linux; then
    print_note "gVisor install is only supported on Linux."
    return 1
  fi

  local runsc_path
  runsc_path="$(command -v runsc 2>/dev/null || true)"
  if [[ -n "$runsc_path" ]]; then
    print_success "gVisor runsc is already installed."
    if ! gvisor_runtime_registered; then
      print_note "Registering runsc with Docker."
      run_step "runsc install" run_as_root "$runsc_path" install
      restart_docker_service || true
    fi
    return 0
  fi

  local arch
  arch="$(normalize_gvisor_arch)" || {
    print_warning "Unsupported CPU architecture for automated gVisor install: $(uname -m)"
    return 1
  }

  local work_dir base_url
  work_dir="$(mktemp -d)"
  base_url="https://storage.googleapis.com/gvisor/releases/release/latest/${arch}"

  print_note "Installing gVisor runsc for ${arch} from the official release bucket."

  if ! run_step "curl -L ${base_url}/runsc -o runsc" \
    curl -fsSL "${base_url}/runsc" -o "${work_dir}/runsc"; then
    rm -rf "$work_dir"
    print_warning "Failed to download the runsc binary."
    return 1
  fi
  if ! run_step "curl -L ${base_url}/runsc.sha512 -o runsc.sha512" \
    curl -fsSL "${base_url}/runsc.sha512" -o "${work_dir}/runsc.sha512"; then
    rm -rf "$work_dir"
    print_warning "Failed to download the runsc checksum."
    return 1
  fi
  if ! run_step "verify runsc checksum" \
    bash -lc "cd '$work_dir' && sha512sum -c runsc.sha512"; then
    rm -rf "$work_dir"
    print_warning "runsc checksum verification failed."
    return 1
  fi

  run_step "install runsc to /usr/local/bin" \
    run_as_root install -m 0755 "${work_dir}/runsc" /usr/local/bin/runsc
  run_step "runsc install" run_as_root /usr/local/bin/runsc install
  restart_docker_service || true

  rm -rf "$work_dir"

  if have_cmd runsc && gvisor_runtime_registered; then
    print_success "gVisor is installed and registered with Docker."
    return 0
  fi

  print_warning "gVisor is still not available after the install attempt."
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

gvisor_ready_for_maestro() {
  is_linux || return 1
  have_cmd docker || return 1
  have_cmd runsc || return 1
  gvisor_runtime_registered || return 1
}

gvisor_unavailable_reason() {
  if ! is_linux; then
    echo "this host is not Linux"
    return 0
  fi
  if ! have_cmd docker; then
    echo "Docker is not installed"
    return 0
  fi
  if ! have_cmd runsc; then
    echo "the gVisor runsc binary is not installed"
    return 0
  fi
  if ! gvisor_runtime_registered; then
    echo "Docker does not have the runsc runtime registered"
    return 0
  fi

  echo "an unknown gVisor readiness check failed"
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
    read -rp "Choose default sandbox provider [G]Visor/[d]ocker (default: gVisor): " answer
    answer=${answer,,}
    case "$answer" in
      ""|g|gvisor)
        echo "gvisor"
        return 0
        ;;
      d|docker)
        echo "docker"
        return 0
        ;;
    esac
    echo "Enter gVisor or Docker."
  done
}

print_section "Maestro First-Run Setup"
print_note "Press Enter to accept the default on prompts."
print_note "This setup installs local tooling and authenticates CLIs on this machine."
echo ""

print_section "Host Dependencies"
ensure_tool corepack "corepack" install_corepack
ensure_tool curl "curl" install_curl
ensure_tool pnpm "pnpm" install_pnpm
ensure_tool rg "ripgrep" install_ripgrep
ensure_tool bwrap "bubblewrap" install_bubblewrap
echo ""

print_section "Sandbox Runtimes"
print_note "Docker and gVisor are both prepared when the host supports them."
echo ""

ensure_tool docker "Docker" install_docker
if is_linux; then
  ensure_tool runsc "gVisor" install_gvisor
  echo ""
else
  print_note "gVisor install is only supported on Linux. Docker will remain the only sandbox runtime on this host."
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
if gvisor_ready_for_maestro; then
  DEFAULT_SANDBOX_PROVIDER="$(prompt_default_sandbox)"
  print_success "Selected default sandbox provider: $DEFAULT_SANDBOX_PROVIDER"
else
  print_note "gVisor is not fully ready on this host because $(gvisor_unavailable_reason)."
  print_note "Docker will be the only offered sandbox provider."
  print_success "Default sandbox provider: Docker"
fi
echo "__MAESTRO_SANDBOX_PROVIDER__=${DEFAULT_SANDBOX_PROVIDER}"
echo ""

print_section "Setup Complete"
print_note "You can rerun this anytime with: maestro onboard"
echo "__MAESTRO_SETUP_DONE__"
