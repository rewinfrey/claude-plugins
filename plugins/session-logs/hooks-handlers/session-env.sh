#!/usr/bin/env bash
set -euo pipefail

# Read SessionStart hook input from stdin
HOOK_INPUT=$(cat)

# Extract session_id and transcript_path from the JSON input
SESSION_ID=$(echo "$HOOK_INPUT" | jq -r '.session_id')
TRANSCRIPT_PATH=$(echo "$HOOK_INPUT" | jq -r '.transcript_path')

# Write env vars to CLAUDE_ENV_FILE so they persist for the session
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export CLAUDE_SESSION_ID=\"$SESSION_ID\"" >> "$CLAUDE_ENV_FILE"
  echo "export CLAUDE_TRANSCRIPT_PATH=\"$TRANSCRIPT_PATH\"" >> "$CLAUDE_ENV_FILE"
fi

exit 0
