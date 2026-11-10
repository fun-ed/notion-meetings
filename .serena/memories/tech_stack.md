# 技術堆疊

- Node 使用 ESM 與 `import.meta.main`，開發 runtime 與套件指令一律透過 `mise exec --`。開發測試所需 Node 範圍以 README 及測試相依的 engines 為準。
- 相依以 `package.json` 為準；D-027 已補充 D-001 的最小堆疊。新增相依仍需確認標準庫或既有套件不足以處理需求。
- 系統工具：ffmpeg（轉檔，必要）、macOS `say`（只在 eval）。
- eval 腳本為 Python 標準庫（urllib），用 `mise exec -- python3 -I` 執行；無 requirements。
- 正式轉錄走 OpenRouter MAI；LLM 支援 Anthropic 與 OpenAI 相容端點。啟動方式見 `mem:suggested_commands`，服務商與模型約束見 `mem:backend/pipeline`。
- 前端無框架，不需獨立 bundler；Bun 可將伺服器與瀏覽器資產編成單一執行檔，資產契約見 `mem:frontend`。沒有獨立 linter／formatter 設定。
