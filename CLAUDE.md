# notion-meetings

Notion AI Meeting Notes 的本機復刻：錄音或上傳檔案，產生分講者、台灣繁體的逐字稿，再用 Claude 產生摘要。

驗收基準：逐字稿必須是台灣繁體中文與台灣用詞，中英夾雜的專業術語必須正確（D-002）。

- 啟動：`mise exec -- npm run start:magpie`（Claude 走 magpie gateway）。需要 magpie gateway 和 `~/.config/openrouter/key`。第一個註冊的帳號是管理員。
- 程式：`server.js`（路由、處理流程）、`auth.js`（帳號、權限，D-013）、`ai.js`（模型、Agent，D-014）、`public/index.html`。變更紀錄在 `CHANGELOG.md`。
- 測試：`mise exec -- npm test`；處理流程的回歸測試是 `eval/e2e.py`，步驟在 `meetings-dev` skill。
- 改程式或排查問題前，先讀 `docs/decisions.md`。架構在 `docs/architecture.md`，待辦在 `docs/plans/2026-10-20-roadmap.md`，評測數據在 `docs/research/`。
- 評估新的轉錄模型或服務商，用 `stt-research` skill。
