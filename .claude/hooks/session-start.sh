#!/bin/bash
set -euo pipefail

# Only run in Claude Code on the web — not needed for local interactive sessions.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# This project has no build step (static index.html + app.js), so there's
# nothing to `npm install` for the app itself. The CLIs below give the
# session direct access to the two hosted services the app depends on:
# Supabase (schema/RLS/logs on the `hasirushaale` project) and Vercel
# (deployment status/build & runtime logs). GitHub PR management is already
# covered by this environment's GitHub MCP tools, so `gh` is intentionally
# not installed here.
npm install -g supabase vercel
