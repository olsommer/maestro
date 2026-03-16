#!/usr/bin/env bash

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
  if command -v claude &>/dev/null; then
    echo "Checking Claude Code authentication..."
    if claude auth status >/dev/null 2>&1; then
      echo "Claude Code is already authenticated."
    else
      echo ""
      echo "Running: claude setup-token"
      echo "This will prompt you for a long-lived token (requires Claude subscription)."
      echo ""
      claude setup-token || echo "(claude setup-token exited with error)"
    fi
  else
    echo "Claude Code CLI not found, skipping."
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
