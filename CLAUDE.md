# notion-meetings

Notion AI Meeting Notes 的本機復刻：錄音或上傳檔案，產生分講者、台灣繁體的逐字稿，再用 Claude 產生摘要。

驗收基準：逐字稿必須是台灣繁體中文與台灣用詞，中英夾雜的專業術語必須正確（D-002）。

- 啟動：`mise exec -- npm run start:magpie`（預設，LLM 走 magpie gateway），或 `mise exec -- npm run start:litellm`（LLM 走公司 LiteLLM，端點與 key 在 `~/.config/litellm/`，D-022）。轉錄一律需要 `~/.config/openrouter/key`。第一個註冊的帳號是管理員。
- 程式：`server.js`（路由、處理流程）、`auth.js`（帳號、權限，D-013）、`ai.js`（模型、Agent，D-014）、`public/index.html`。變更紀錄在 `CHANGELOG.md`。
- 測試：`mise exec -- npm test`；處理流程的回歸測試是 `eval/e2e.py`，步驟在 `meetings-dev` skill。
- 改程式或排查問題前，先讀 `docs/decisions.md`。架構在 `docs/architecture.md`，計畫在 `docs/plans/`（總覽是 `2026-10-21-next-steps.md`），評測數據在 `docs/research/`（各設定的準確度總表在 `2026-10-21-benchmark-standards.md`）。
- 評估新的轉錄模型或服務商，用 `stt-research` skill。
