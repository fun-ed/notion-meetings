# notion-meetings

[English](README.md) | 繁體中文

Notion AI Meeting Notes 的本機復刻。錄音或上傳會議檔案後，會產生分講者的台灣繁體逐字稿，中英夾雜的專業術語也能正確辨識，再由 Claude 寫出摘要與待辦事項。

下載：<https://github.com/fun-ed/notion-meetings/releases> · 變更紀錄：[CHANGELOG.md](CHANGELOG.md)

![會議頁](docs/images/meeting.png)

## 功能

- 麥克風錄音，或上傳音訊、影片（mp4、mov、m4a、mp3、wav、webm）。原始檔案會保存，可以下載。
- 轉錄流程：經 OpenRouter 呼叫 MAI-Transcribe 2（零資料保留），用 OpenCC 轉成台灣用詞，再由 Claude 只修正術語表裡的詞。每處改動都會檢查：不是改成術語、也不是加【?】的改動會被還原。不確定的地方標成【?】，並保留原始辨識結果。
- 校正講者：可以改講者名字、把一段或一整段範圍改給別人、合併兩位講者，也能加入沒發言的參與者。
- 學習迴圈：會議的術語自動累積成團隊術語，每場轉錄都會套用；中文逐字稿出現韓文或日文假名時標【?】；Claude 依點名線索（「謝謝 X」）建議講者是誰，按一下套用；校正好的會議可以凍結成 benchmark，追蹤講者正確率與 CER。
- 團隊知識：`data/knowledge.json` 記錄術語的意思、別名與常見誤聽，以及團隊流程。術語會加入轉錄的術語清單，常見誤聽會交給術語校對修正（例如「CloudCode → Claude Code」）；不論選哪個 Agent，摘要也都會帶入，所以縮寫能被解讀。誤聽記一次，之後的會議就會自動修正。
- 逐字稿預設精簡顯示，隱藏呃、嗯等語助詞，不改存下來的逐字稿。
- 摘要可選 Agent，例如 DRI 交接、架構討論、EKS 升級、CI/CD、各類 design review。每個重點都標出依據的逐字稿行號。
- 跨會議的 Action Items，可依會議、團隊、負責人或 Y leader 分組。
- 搜尋簡繁互通，支援 `tag:`、`who:`、`team:`、`after:` 等篩選。
- 帳號分管理員、成員、唯讀；每場會議可設權限，也能建立可撤銷的分享連結並留言。
- 每次 AI 呼叫都記錄用量（tokens、音訊秒數、費用、耗時）。有亮色與暗色模式，時間一律是台灣時間（GMT+8）。
- 轉錄診斷（0.9.0）：可在管理後台或 terminal 檢查 OpenRouter 金鑰額度、ffmpeg 與短音訊 ZDR 請求。失敗時顯示排查訊息與請求資訊，不輸出金鑰或音訊。

![逐字稿與講者範圍校正（暗色）](docs/images/transcript-dark.png)

![Action Items](docs/images/action-items.png)

## 需要的環境

| 項目 | 說明 |
|---|---|
| ffmpeg | 要在 `PATH` 上（`brew install ffmpeg`、`apt install ffmpeg`） |
| OpenRouter 金鑰 | 轉錄必備 |
| LLM | magpie gateway（預設），或公司的 LiteLLM，見「執行」 |
| Node.js | 只有從原始碼執行時需要 |

OpenRouter 金鑰存在專案外、只有自己能讀的檔案（zsh 語法）：

```bash
read -s "K?OpenRouter key: " && mkdir -p ~/.config/openrouter && printf %s "$K" > ~/.config/openrouter/key && chmod 600 ~/.config/openrouter/key && unset K
```

設定 `OPENROUTER_API_KEY` 時會優先使用它。建議在 OpenRouter 為這把金鑰設定 Guardrail：只允許 `microsoft/mai-transcribe-2`，並開啟零資料保留。

## 執行

預設設定是所有 LLM 都走 magpie gateway，也可以改用公司的 LiteLLM（見下方）。轉錄一律使用 OpenRouter 的 MAI-Transcribe 2。

從原始碼執行：

```bash
mise exec -- npm install
mise exec -- npm run start:magpie   # 預設：magpie gateway（127.0.0.1:3425）
mise exec -- npm run start:litellm  # 改用公司 LiteLLM
mise exec -- npm start              # Anthropic API（ANTHROPIC_API_KEY）
```

使用 Release 執行檔（macOS、Linux、Windows）時，設定和 npm 指令相同的變數：

```bash
# magpie
ANTHROPIC_BASE_URL=http://127.0.0.1:3425 ANTHROPIC_API_KEY=magpie OPENAI_BASE_URL=http://127.0.0.1:3425/v1 OPENAI_API_KEY=magpie ./notion-meetings-v<版本>-darwin-arm64
# 公司 LiteLLM
LLM_PROVIDER=openai OPENAI_BASE_URL="$(cat ~/.config/litellm/base_url)" OPENAI_API_KEY="$(cat ~/.config/litellm/key)" ./notion-meetings-v<版本>-darwin-arm64
```

macOS 下載後，第一次要先執行 `xattr -d com.apple.quarantine <檔案>`。執行檔的資料存在 `~/.notion-meetings`。

開啟 <http://localhost:3000>。第一個建立的帳號是管理員。

### 改用公司 LiteLLM

1. 把端點與自己的 key 存在這台 Mac、repo 之外（只要做一次）：

   ```bash
   mkdir -p ~/.config/litellm && chmod 700 ~/.config/litellm
   echo 'https://<你的 LiteLLM 主機>/v1' > ~/.config/litellm/base_url
   read -s "K?LiteLLM key: " && printf %s "$K" > ~/.config/litellm/key && chmod 600 ~/.config/litellm/key && unset K
   ```

2. 用 `mise exec -- npm run start:litellm` 啟動。沒有自己 Endpoint 的內建模型（含 Claude）都會改走 LiteLLM；模型 ID 裡 magpie 的前綴（`codex/`）會自動去掉；每次呼叫都會記錄 LiteLLM 回報的費用。
3. 在「管理後台 › 模型」對要用的模型按「測試」，確認有回應。

兩種設定的轉錄都維持 OpenRouter 的 MAI-Transcribe 2，所以仍需要 OpenRouter key。原因是公司 LiteLLM 上的轉錄模型，都達不到台灣繁體、術語與分講者的基準（[實測報告](docs/research/2026-10-21-litellm.md)）。

### 模型搭配

結果來自合成測試組（[OpenAI 模型評測](docs/research/2026-10-21-openai-models.md)、[LiteLLM 實測](docs/research/2026-10-21-litellm.md)）。

| 模型 | magpie ID | LiteLLM ID | 適合 | 說明 |
|---|---|---|---|---|
| Claude Opus 5.5 | `claude-opus-5-5` | `claude-opus-5-5` | 全部用途的預設 | 術語校對最保守，不確定就標【?】，不會硬猜 |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | `claude-sonnet-5-5` | 想省成本的摘要 | 在 LiteLLM 上的輸入價格是 Opus 的一半 |
| GPT-6.1 Sol | `codex/gpt-6.1-sol` | `gpt-6.1-sol` | 摘要，或想要快的術語校對 | 校對通過（45/45、42/45），速度快好幾倍，但曾把聽錯的字直接改成另一個術語、沒有標【?】 |
| GPT-6 Luna | `codex/gpt-6-luna` | `gpt-6-luna` | 不要用在術語校對 | 最快也最便宜，但校對在嚴苛音檔只有 39/45，沒有通過 |
| MAI-Transcribe 2 | — | — | 轉錄 | 兩種設定都經 OpenRouter（零資料保留） |

建議：預設模型維持 Opus 5.5。想讓摘要更快或更省，就把預設模型換成 Sonnet 5.5 或 GPT-6.1 Sol（或在 Agent 指定），再到「管理後台 › 模型 › 用途」把術語校對指定為 Opus 5.5。講者建議用 low effort，上面幾個模型都可以。

### 設定

| 環境變數 | 預設值 | 用途 |
|---|---|---|
| `PORT` | `3000` | 伺服器埠號 |
| `DATA_DIR` | `./data`（執行檔：`~/.notion-meetings`） | 會議、帳號、名錄與模型設定 |
| `OPENROUTER_API_KEY` | `~/.config/openrouter/key` | 轉錄金鑰 |
| `ANTHROPIC_BASE_URL`、`ANTHROPIC_API_KEY` | Anthropic API | Anthropic 模型的預設端點與金鑰 |
| `OPENAI_BASE_URL`、`OPENAI_API_KEY` | — | OpenAI 相容模型的預設端點與金鑰 |
| `LLM_PROVIDER` | — | 設成 `openai` 時，沒有自己 Endpoint 的模型（含 Claude）都經 `OPENAI_BASE_URL` 呼叫；`npm run start:litellm` 會設定 |

管理員也可以在「管理後台 › 模型」為個別模型設定 Endpoint 與 API key：
- LiteLLM、magpie、OpenAI 用「OpenAI 相容」，原生 Anthropic API 用「Anthropic」。
- 「讀取模型」會列出端點提供的模型 ID。
- 在這裡輸入的 key 只存在這台 Mac 的 `data/secrets.json`（權限 600），同一個端點的模型共用，介面只顯示末四碼。

## 搜尋語法

| 寫法 | 找到的會議 |
|---|---|
| `kafka 延遲` | 兩個詞都有出現 |
| `"consumer lag"` | 完整片語 |
| `tag:平台`、`type:站立` | 標籤、摘要類型 |
| `who:小美`、`team:SPC`、`leader:Ken`、`group:ZTSA` | 講者或待辦負責人，依人、團隊、Y leader 或群組 |
| `after:2026-10-01`、`before:2026-10-31` | 會議日期範圍，含當天 |

## 資料與隱私

- 伺服器只接受 `127.0.0.1` 的連線。它沒有 HTTPS，不要開放到網路上。
- 音訊送到 OpenRouter 的零資料保留端點；逐字稿文字與 Agent 的 skill 送到你設定的 LLM 端點，建議用公司的 LiteLLM。
- 錄音時的即時字幕預設關閉。開啟後只用瀏覽器的本機語音辨識，不會改用雲端服務。
- `data/` 不進 git。每場會議存在 `data/<YYYY-MM-DD>/<id>/`，內容是原始錄音與 `meeting.json`。團隊術語與 benchmark 結果存在各自 Mac 的 `data/learned.json`，團隊知識存在 `data/knowledge.json`。兩者一律載入：團隊術語與團隊知識的術語用在每次轉錄與術語校對，團隊知識的常見誤聽用在術語校對，團隊知識也用在每次摘要。
- 密碼用 scrypt 雜湊。登入狀態是 HttpOnly cookie，存在伺服器記憶體，重新啟動後要重新登入。

## 開發

```bash
mise exec -- npm test        # 單元與 API 測試，不呼叫外部服務
mise exec -- npm run build   # 用 Bun 在 dist/ 產生單一執行檔
```

手動觸發的 GitHub Actions（`gh workflow run ci.yml`）會跑單元測試、建置 5 個平台的執行檔、核對 `SHA256SUMS`，並實際啟動 Linux x64 執行檔。處理流程的回歸測試（`eval/e2e.py`）和執行檔的發版檢查（`scripts/smoke-binary.sh`）會呼叫真的 API，所以手動執行，步驟寫在 `meetings-dev` skill。

### 轉錄診斷

轉錄失敗時，可在「管理後台 → 測試轉錄連線」執行診斷，或在 terminal 執行：

```bash
mise exec -- node server.js --debug-transcription
```

診斷會檢查這把 API key 的剩餘額度、ffmpeg，以及帶目前團隊術語與 ZDR 的 1 秒靜音轉錄請求。不會傳送會議錄音，但會產生少量 API 費用。

轉錄 API 實測最多接受 200 個術語。會議術語優先，只送前 200 個；超出的數量會顯示在診斷訊息、terminal 與會議用量明細。不會刪除術語，也不縮減後續校對使用的清單。

JSON 報告包含 `ok`、`message`，以及 `checks` 裡的各項檢查結果；通過時 exit 0，失敗時 exit 1。這不驗證長錄音或辨識品質。

正式轉錄失敗時，會議網頁與 terminal 也會顯示 HTTP status、模型、音訊大小、術語數與耗時，不輸出金鑰或音訊內容。`429` 代表限流，不代表 credit 用完；單靠回應不一定能分辨限制套在金鑰、帳戶、IP 或供應商共享容量。

更新後端程式後需重啟原始碼伺服器；既有失敗紀錄不會改寫。舊版 Release 執行檔不會因更新原始碼而取得診斷功能。

| 路徑 | 內容 |
|---|---|
| [docs/decisions.md](docs/decisions.md) | 決策與理由，改程式前先讀 |
| [docs/architecture.md](docs/architecture.md) | 處理流程、資料欄位、API |
| [docs/architecture.drawio](docs/architecture.drawio) | 可編輯的 0.9.0 元件與處理流程圖，包含診斷與轉錄術語 200 個上限 |
| [docs/plans/](docs/plans/) | 計畫，檔名是 `YYYY-MM-DD-<主題>.md`；總覽是 [下一步](docs/plans/2026-10-21-next-steps.md) |
| [docs/research/](docs/research/) | 評測報告；所有試過的設定與準確度整理在 [benchmark 標準](docs/research/2026-10-21-benchmark-standards.md) |
| `.claude/skills/meetings-dev` | 開發、測試、建置與發版 |
| `.claude/skills/stt-research` | 評估新的轉錄模型 |
