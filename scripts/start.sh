#!/bin/sh
# Writes the Codex login from a secret (CODEX_AUTH_JSON_B64) before starting the app.
# Claude Code reads its login from CLAUDE_CODE_OAUTH_TOKEN directly.
set -e
if [ -n "$CODEX_AUTH_JSON_B64" ]; then
  mkdir -p "$HOME/.codex"
  echo "$CODEX_AUTH_JSON_B64" | base64 -d > "$HOME/.codex/auth.json"
  chmod 600 "$HOME/.codex/auth.json"
fi
exec node_modules/.bin/next start
