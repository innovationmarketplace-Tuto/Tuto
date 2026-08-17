#!/usr/bin/env bash
set -euo pipefail

API_URL="${COORDINATE_API_URL:-${1:-}}"
IMAGE_PATH="${COORDINATE_IMAGE:-${2:-}}"
QUESTION="${COORDINATE_QUESTION:-${3:-Find the most important mistake.}}"

if [[ -z "$API_URL" || -z "$IMAGE_PATH" ]]; then
  echo "Usage: COORDINATE_API_URL=https://.../analyze COORDINATE_IMAGE=./page.jpg pnpm request" >&2
  echo "   or: pnpm request https://.../analyze ./page.jpg \"Find the sign error\"" >&2
  exit 2
fi

PAYLOAD="$(node --input-type=module -e '
import fs from "node:fs";
const file = process.argv[1];
const question = process.argv[2];
const bytes = fs.readFileSync(file);
const mime = file.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
process.stdout.write(JSON.stringify({ imageBase64: bytes.toString("base64"), mimeType: mime, question }));
' "$IMAGE_PATH" "$QUESTION")"

curl --fail-with-body --silent --show-error \
  -X POST "$API_URL" \
  -H 'content-type: application/json' \
  --data "$PAYLOAD"
