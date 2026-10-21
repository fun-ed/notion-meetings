# 技術堆疊

- Node（ESM，`"type": "module"`，用到 `import.meta.main`，需 Node ≥ 24）；透過 `mise exec --` 執行。專案未釘版本，本機為 Node 26。
- 相依只有 `@anthropic-ai/sdk`、`opencc-js`；新增相依前先確認標準庫或既有套件不夠用（D-001）。
- 系統工具：ffmpeg（轉檔，必要）、macOS `say`（只在 eval）。
- eval 腳本為 Python 標準庫（urllib），用 `mise exec -- python3 -I` 執行；無 requirements。
- 外部服務：OpenRouter（MAI-Transcribe 2）、Claude（經本機 magpie gateway `http://127.0.0.1:3425`，key `magpie`，或官方 API）。DeepInfra 只供評測。
- 無 build、無 bundler、無 linter/formatter 設定。
