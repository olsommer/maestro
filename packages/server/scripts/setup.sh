#!/usr/bin/env bash

# Get terminal width, default to 40
W=${COLUMNS:-$(tput cols 2>/dev/null || echo 40)}
BANNER=$(printf '%*s' "$W" '' | tr ' ' '=')

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

install_gh() {
  if have_cmd gh; then
    return 0
  fi

  if have_cmd brew; then
    run_step "brew install gh" brew install gh
  elif have_cmd apt-get; then
    run_step "apt-get update" apt-get update
    run_step "apt-get install -y gh" apt-get install -y gh
  elif have_cmd dnf; then
    run_step "dnf install -y gh" dnf install -y gh
  elif have_cmd yum; then
    run_step "yum install -y gh" yum install -y gh
  elif have_cmd pacman; then
    run_step "pacman -Sy --noconfirm github-cli" pacman -Sy --noconfirm github-cli
  else
    echo "GitHub CLI installation is not automated on this system."
    echo "Install it manually, then rerun \`maestro onboard\`."
    return 1
  fi

  if have_cmd gh; then
    echo "GitHub CLI installed successfully."
    return 0
  fi

  echo "GitHub CLI is still not available after the install attempt."
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
