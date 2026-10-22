# notion-meetings

Notion AI Meeting Notes 的本機復刻：錄音或上傳檔案，產生分講者、台灣繁體的逐字稿，再用 Claude 產生摘要。

驗收基準：逐字稿必須是台灣繁體中文與台灣用詞，中英夾雜的專業術語必須正確（D-002）。

- 啟動：`mise exec -- npm run start:magpie`（預設，LLM 走 magpie gateway），或 `mise exec -- npm run start:litellm`（LLM 走公司 LiteLLM，端點與 key 在 `~/.config/litellm/`，D-022）。轉錄一律需要 `~/.config/openrouter/key`。第一個註冊的帳號是管理員。
- 程式：`server.js`（路由、處理流程）、`auth.js`（帳號、權限，D-013）、`ai.js`（模型、Agent，D-014）、`public/index.html`。變更紀錄在 `CHANGELOG.md`。
- 測試：`mise exec -- npm test`；處理流程的回歸測試是 `eval/e2e.py`，步驟在 `meetings-dev` skill。
- 改程式或排查問題前，先讀 `docs/decisions.md`。架構在 `docs/architecture.md`，計畫在 `docs/plans/`（總覽是 `2026-10-21-next-steps.md`），評測數據在 `docs/research/`（各設定的準確度總表在 `2026-10-21-benchmark-standards.md`）。
- 評估新的轉錄模型或服務商，用 `stt-research` skill。
- 團隊知識一律載入：`data/learned.json` 的團隊術語進每次轉錄（MAI phraseList）與術語校對；`data/knowledge.json`（D-024，手動編輯、不進 git）的術語也進 phraseList 與校對，別名與常見誤聽進術語校對（D-025）；術語意思、別名、流程筆記進每個 Agent 的摘要 system prompt，標明是背景知識、不是會議內容。處理會議內容、術語或摘要問題前，先讀這兩個檔。它們是公司內部資料，不能寫進 repo、測試或截圖（repo 是公開的）。
