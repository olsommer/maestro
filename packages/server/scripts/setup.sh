#!/usr/bin/env bash

# Load persisted tokens from a previous setup run
if [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ] && [ -f "$HOME/.maestro/.claude_oauth_token" ]; then
  export CLAUDE_CODE_OAUTH_TOKEN="$(cat "$HOME/.maestro/.claude_oauth_token")"
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
  if [ -n "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
    echo "Claude Code OAuth token is already set."
  else
    echo ""
    echo "To authenticate Claude Code in this container:"
    echo "  1. Run 'claude setup-token' on your LOCAL machine"
    echo "  2. Copy the token it generates"
    echo "  3. Paste it below"
    echo ""
    read -rp "OAuth token: " claude_token
    if [ -n "$claude_token" ]; then
      export CLAUDE_CODE_OAUTH_TOKEN="$claude_token"
      # Persist for future container restarts
      mkdir -p "$HOME/.maestro"
      echo "$claude_token" > "$HOME/.maestro/.claude_oauth_token"
      echo "Claude Code token saved."
    else
      echo "No token entered, skipping Claude Code setup."
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
