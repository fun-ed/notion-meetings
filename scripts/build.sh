#!/usr/bin/env bash
# Build single-file executables with Bun: dist/notion-meetings-v<version>-<os>-<arch>[.exe] plus SHA256SUMS.
# usage: scripts/build.sh [bun-target ...]   (default: macOS arm64/x64, Linux x64/arm64, Windows x64)
# Users still need ffmpeg on PATH, an OpenRouter key, and an Anthropic endpoint/key (see README「執行檔」).
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p 'require("./package.json").version')
if [ $# -gt 0 ]; then targets=("$@"); else targets=(bun-darwin-arm64 bun-darwin-x64 bun-linux-x64 bun-linux-arm64 bun-windows-x64); fi
# Embed the UI as a string module; server.js imports it only inside a compiled binary.
mkdir -p .build dist
node -e 'const fs=require("fs"); fs.writeFileSync(".build/ui.js", "export default " + JSON.stringify(fs.readFileSync("public/index.html","utf8")) + ";\n")'
rm -f dist/SHA256SUMS
for t in "${targets[@]}"; do
  name="notion-meetings-v${version}-${t#bun-}"
  [[ $t == *windows* ]] && name+=".exe"
  bun build --compile --minify --target="$t" server.js --outfile "dist/$name"
  (cd dist && shasum -a 256 "$name" >> SHA256SUMS)
done
ls -lh dist
