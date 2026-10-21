#!/usr/bin/env bash
# Start with every LLM call (term correction, summary, speaker hints) going through one LiteLLM / OpenAI-compatible endpoint.
# The endpoint and key stay on this Mac, outside the repo:
#   ~/.config/litellm/base_url   e.g. https://<litellm-host>/v1   (or set LITELLM_BASE_URL)
#   ~/.config/litellm/key        your LiteLLM key, mode 600        (or set LITELLM_API_KEY)
# Transcription still uses OpenRouter MAI-Transcribe 2 (~/.config/openrouter/key): the LiteLLM transcription
# models did not meet the zh-TW + jargon + speaker bar (docs/research/2026-10-21-litellm.md).
set -euo pipefail
cd "$(dirname "$0")/.."
conf="$HOME/.config/litellm"
base="${LITELLM_BASE_URL:-$(cat "$conf/base_url" 2>/dev/null || true)}"
key="${LITELLM_API_KEY:-$(cat "$conf/key" 2>/dev/null || true)}"
[ -n "$base" ] || { echo "LiteLLM endpoint missing: put it in $conf/base_url or set LITELLM_BASE_URL"; exit 1; }
[ -n "$key" ] || { echo "LiteLLM key missing: put it in $conf/key (chmod 600) or set LITELLM_API_KEY"; exit 1; }
src="$conf/key"; [ -n "${LITELLM_API_KEY:-}" ] && src="LITELLM_API_KEY"
echo "LLM endpoint: $base (key from $src)"  # never print the key itself
LLM_PROVIDER=openai OPENAI_BASE_URL="$base" OPENAI_API_KEY="$key" exec node server.js
