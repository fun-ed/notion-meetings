# 常用指令

- 安裝：`mise exec -- npm install`
- 啟動：預設 `mise exec -- npm run start:magpie`（LLM 走 magpie）；公司 LiteLLM：`mise exec -- npm run start:litellm`（讀 `~/.config/litellm/base_url`、`key`，不印出 key）；官方 API：設 `ANTHROPIC_API_KEY` 後 `mise exec -- npm start`。`PORT`、`DATA_DIR` 可覆寫，測試時用 `DATA_DIR=$(mktemp -d)` 避免動到 `data/`。
- 單元測試：`mise exec -- npm test`
- 轉錄診斷的 CLI、管理員 API、費用與驗證範圍見 `mem:backend/pipeline` 的「轉錄診斷與錯誤邊界」。
- 回歸：`T=$(mktemp -d) && ./eval/make-testset.sh "$T"`，另開伺服器 `PORT=3919 DATA_DIR=$(mktemp -d) mise exec -- npm run start:magpie`，再 `mise exec -- python3 -I eval/e2e.py http://127.0.0.1:3919 "$T"`；結束用埠號關：`lsof -ti tcp:3919 -sTCP:LISTEN | xargs kill`。不要用 `pkill -f "node server.js"`：本機 Camofox 也叫這個名字，會一起被殺；殺 `$!` 只殺到 `mise exec` 外層。
- 回歸 `e2e.py` 會在空 DATA_DIR 自動註冊第一個帳號並登入；既有資料設 `E2E_USER`／`E2E_PASS`。
- 模型評測：`mise exec -- python3 -I eval/stt_eval.py "$T" meeting.mp3 1.0 eval/configs/openrouter.json`（嚴苛版 `meeting-hard.mp3 1.15`）。
- 單一平台建置：`mise exec -- npm run build -- bun-darwin-arm64`；不帶目標時建置預設五個平台。產物在 `dist/`，執行檔資料預設 `~/.notion-meetings`，可用 `DATA_DIR` 覆寫。先以 `mise exec -- bun --revision` 確認為正式版；腳本內也透過 mise 執行 Node／Bun，不能只改外層 PATH 就假設編譯器已替換。
- 執行檔發版檢查：`ANTHROPIC_BASE_URL=http://127.0.0.1:3425 ANTHROPIC_API_KEY=magpie mise exec -- bash scripts/smoke-binary.sh dist/notion-meetings-v<版本>-darwin-arm64 "$T"`（三行 PASS）。
- `e2e.py` 的完整 PASS 條件與單一 section benchmark 限制見 `mem:eval/core`。
- 金鑰驗證（不印金鑰）：OpenRouter `GET https://openrouter.ai/api/v1/key`；DeepInfra `GET https://api.deepinfra.com/v1/me`（200/401）。
- LiteLLM 模型清單與上限（不印 key）：`curl -s "$(cat ~/.config/litellm/base_url)/models" -H "Authorization: Bearer $(cat ~/.config/litellm/key)"`；上限用 `/model/info`。
- magpie 是否在線：`curl -s http://127.0.0.1:3425/v1/models -H 'Authorization: Bearer magpie'`
- Darwin：`sed -i ''`（BSD sed）；zsh 不會對未加引號變數做分詞，迴圈參數用陣列或 `${=var}`。
- Git：個人 repo `fun-ed/notion-meetings`（public）；commit 前 `gwho`，未設定用 `gme`。全域 gitignore 排除 `.claude/`，專案 `.gitignore` 以例外規則只追蹤 `.claude/skills/`。
