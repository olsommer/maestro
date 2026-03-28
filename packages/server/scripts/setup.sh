#!/usr/bin/env bash

# Get terminal width, default to 40
W=${COLUMNS:-$(tput cols 2>/dev/null || echo 40)}
BANNER=$(printf '%*s' "$W" '' | tr ' ' '=')
PNPM_VERSION=10.32.1

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

prompt_yes_no() {
  local prompt=$1
  local answer
  read -rp "$prompt" answer
  [[ "$answer" =~ ^[Yy]$ ]]
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
    echo "$binary installed successfully."
    return 0
  fi

  echo "$binary is still not available after the npm install attempt."
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
    run_step "apt-get update" apt-get update
    run_step "apt-get install -y $apt_pkg" apt-get install -y "$apt_pkg"
  elif have_cmd dnf && [[ -n "$dnf_pkg" ]]; then
    run_step "dnf install -y $dnf_pkg" dnf install -y "$dnf_pkg"
  elif have_cmd yum && [[ -n "$yum_pkg" ]]; then
    run_step "yum install -y $yum_pkg" yum install -y "$yum_pkg"
  elif have_cmd pacman && [[ -n "$pacman_pkg" ]]; then
    run_step "pacman -Sy --noconfirm $pacman_pkg" pacman -Sy --noconfirm "$pacman_pkg"
  else
    echo "$label installation is not automated on this system."
    echo "Install it manually, then rerun \`maestro onboard\`."
    return 1
  fi

  if have_cmd "$binary"; then
    echo "$label installed successfully."
    return 0
  fi

  echo "$label is still not available after the install attempt."
  return 1
}

install_gh() {
  install_system_package gh "GitHub CLI" gh gh gh gh github-cli
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

ensure_tool() {
  local binary=$1
  local label=$2
  local installer=$3

  if have_cmd "$binary"; then
    echo "$label is already installed."
    return 0
  fi

  echo "$label is not installed."
  if ! prompt_yes_no "Install $label now? (y/n) "; then
    echo "Skipping $label installation."
    return 1
  fi

  "$installer"
}

echo "$BANNER"
echo "  Maestro First-Run Setup"
echo "$BANNER"
echo ""

# --- Host dependencies ---
ensure_tool corepack "corepack" install_corepack
echo ""

ensure_tool pnpm "pnpm" install_pnpm
echo ""

ensure_tool rg "ripgrep" install_ripgrep
echo ""

ensure_tool bwrap "bubblewrap" install_bubblewrap
echo ""

# --- GitHub CLI ---
if ensure_tool gh "GitHub CLI" install_gh; then
  echo "Checking GitHub CLI authentication..."
  if gh auth status >/dev/null 2>&1; then
    echo "GitHub CLI is already authenticated."
  else
    echo "GitHub CLI is not authenticated."
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
if prompt_yes_no "Do you want to use Claude Code? (y/n) "; then
  if ensure_tool claude "Claude Code CLI" install_claude; then
    echo "Claude Code install check complete."
    echo "Skipping Claude authentication during maestro onboard."
    echo "Authenticate Claude Code later by running \`claude\` directly."
  fi
fi
echo ""

# --- Codex ---
if prompt_yes_no "Do you want to use Codex? (y/n) "; then
  if ensure_tool codex "Codex CLI" install_codex; then
    echo "Checking Codex authentication..."
    if codex login status >/dev/null 2>&1; then
      echo "Codex is already authenticated."
    else
      echo "Running: codex login --device-auth"
      echo ""
      codex login --device-auth || echo "(codex login --device-auth exited with error)"
    fi
  fi
fi
echo ""

echo "$BANNER"
echo "  Setup complete!"
echo "$BANNER"
echo "__MAESTRO_SETUP_DONE__"
