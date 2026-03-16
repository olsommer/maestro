#!/usr/bin/env bash

# Load persisted API key from a previous setup run
if [ -z "$ANTHROPIC_API_KEY" ] && [ -f "$HOME/.maestro/.anthropic_key" ]; then
  export ANTHROPIC_API_KEY="$(cat "$HOME/.maestro/.anthropic_key")"
fi

# Get terminal width, default to 40
W=${COLUMNS:-$(tput cols 2>/dev/null || echo 40)}
BANNER=$(printf '%*s' "$W" '' | tr ' ' '=')

echo "$BANNER"
echo "  Maestro First-Run Setup"
echo "$BANNER"
echo ""

# --- GitHub CLI ---
if command -v gh &>/dev/null; then
  echo "Checking GitHub CLI authentication..."
  if gh auth status >/dev/null 2>&1; then
    echo "GitHub CLI is already authenticated."
  else
    echo "GitHub CLI is not authenticated."
    echo "Running: gh auth login"
    echo ""
    gh auth login --web -p https || echo "(gh auth login exited with error)"
  fi
else
  echo "GitHub CLI (gh) not found, skipping."
fi
echo ""

# --- Claude Code ---
read -rp "Do you want to use Claude Code? (y/n) " use_claude
if [[ "$use_claude" =~ ^[Yy]$ ]]; then
  if [ -n "$ANTHROPIC_API_KEY" ]; then
    echo "ANTHROPIC_API_KEY is already set."
  else
    echo ""
    echo "Paste your Anthropic API key (from console.anthropic.com/settings/keys):"
    read -rp "> " api_key
    if [ -n "$api_key" ]; then
      export ANTHROPIC_API_KEY="$api_key"
      # Persist for future container restarts
      mkdir -p "$HOME/.maestro"
      echo "$api_key" > "$HOME/.maestro/.anthropic_key"
      echo "ANTHROPIC_API_KEY saved."
    else
      echo "No key entered, skipping Claude Code setup."
    fi
  fi
fi
echo ""

# --- Codex ---
read -rp "Do you want to use Codex? (y/n) " use_codex
if [[ "$use_codex" =~ ^[Yy]$ ]]; then
  if command -v codex &>/dev/null; then
    echo "Running: codex login"
    echo ""
    codex login || echo "(codex login exited with error)"
  else
    echo "Codex CLI not found, skipping."
  fi
fi
echo ""

echo "$BANNER"
echo "  Setup complete!"
echo "$BANNER"
echo "__MAESTRO_SETUP_DONE__"
