# notion-meetings 核心

Notion AI Meeting Notes 本機復刻：錄音或上傳 → 分講者台灣繁體逐字稿 → LLM 摘要（預設 Claude Opus 5.5，可換 Sonnet、GPT-6.1 Sol 等）。

## 原始碼地圖
- `server.js`：路由、上傳串流、Range 播放、處理流程 `processMeeting()`、搜尋。流程、共用轉錄請求與 Web／CLI 診斷的安全邊界見 `mem:backend/pipeline`。
- `auth.js`：帳號（scrypt）、記憶體 session、`permOf()` 權限、`mergePeople()` 名錄合併、`jsonStore()`；權限與帳號規則見 `mem:backend/auth`。
- `ai.js`：模型設定、內建 Agent、`pickAI()`、`checkContext()`、`loadSkill()`；見 `mem:backend/pipeline`。
- `public/index.html`：全部前端，單檔，inline CSS/JS，無框架、無 build。
- `server.test.js`：`node --test` 單元與 API 測試。
- `eval/`：測試音檔產生、轉錄模型評測、端對端回歸閘門，見 `mem:eval/core`。
- `CHANGELOG.md`：每版新增與驗證結果；目前版本號與 `repository` 以 `package.json` 為準，`/api/auth/me` 回傳 `app {version, repo}` 給側欄左下角。
- `scripts/build.sh`（Bun 打包）、`scripts/smoke-binary.sh`（執行檔發版檢查：版本、內嵌介面、e2e）、`scripts/start-litellm.sh`（`npm run start:litellm`）。
- `.github/workflows/ci.yml`：只能手動觸發（使用者決定，`gh workflow run ci.yml`），跑 `npm test`、Bun 1.4.3 建置 5 平台、`sha256sum -c`、啟動 Linux x64 執行檔檢查版本與內嵌介面；不含任何憑證，真 API 回歸留在本機。
- `README.md`（英文）＋`README.zh-TW.md`（繁中），精簡版，只放 3 張截圖；兩份一起改。
- `docs/decisions.md`：決策 D-001..D-025，唯一權威來源；`docs/architecture.md`：欄位、路由、設定；`docs/plans/`：計畫，總覽是 `2026-10-21-next-steps.md`（P0／P1／P2），細節在 `learning-loop`、`llm-endpoints`、`reliability`、`roadmap`、`team-knowledge-quality`（團隊知識分團隊、Agent 自動建議、摘要台灣用詞檢查）；`docs/research/`：評測，所有設定的分數在 `2026-10-21-benchmark-standards.md` 的準確度總表。
- `docs/architecture.drawio`：可編輯元件總覽與轉錄／摘要流程圖；與 `docs/architecture.md` 一起維護，包含診斷及資料安全邊界。具體流程約束見 `mem:backend/pipeline`。
- Git 歷史在 2026-10-21 壓成單一 commit（`e66e5eb notion-meetings v0.5.0`），只有 `v0.5.0` tag 與 Release；之前的 commit 編號都失效。
- `.claude/skills/meetings-dev`、`.claude/skills/stt-research`：開發維護與模型評測的步驟。

## 全專案不變式
- 驗收基準 D-002：台灣繁體＋台灣用詞，中英夾雜術語正確。換模型以 `eval/` 實測為準，不看英文 WER 排行。
- 逐字稿保留原話：校對只修術語表詞彙，不確定加【?】，`segments[].raw` 必存；台灣口吻只在摘要。不得讓 LLM 改寫逐字稿語氣（實測會編造）。
- 瀏覽器即時字幕預設關閉，只能本機辨識（`processLocally`），絕不改用雲端（D-019）。
- 學習迴圈（D-020，0.4.0 實作 P1～P3）：`data/learned.json` 存團隊術語與 benchmark；講者建議只是建議（`meeting.speakerHints`），按「套用」才改名；只學使用者確認過的內容，`raw` 保留，新規則要 benchmark 不下降才啟用；學習資料與聲紋只在本機 `DATA_DIR`。
- 團隊知識一律載入：`data/learned.json` 的團隊術語進每次轉錄（MAI phraseList）與術語校對；`data/knowledge.json`（D-024，手動編輯、不進 git）的術語也進 phraseList 與校對，別名與常見誤聽進術語校對（D-025）；術語意思、別名、流程筆記進每個 Agent 的摘要 system prompt，標明是背景知識、不是會議內容。壞的 JSON 只印警告並略過，不擋轉錄與摘要。兩檔內容是公司內部資料：不得進 repo、測試、截圖或公開文件。
- 逐字稿精簡顯示（D-023）只在介面：`tidy()` 是 `public/index.html` 的單行定義（`server.test.js` 讀檔 eval 測試）；只有語助詞的段落加 `.filler` 隱藏，但保留 `seg-n` 編號，存檔 `text`／`raw` 不變。
- LLM 端點（D-021、D-022）：每個模型有 provider（`openai`＝OpenAI 相容／LiteLLM、`anthropic`）、Endpoint、API key；後台輸入的 key 存在 `DATA_DIR/secrets.json`（600），依 Endpoint 共用，API 只回 `keyStatus` 末四碼。預設 `npm run start:magpie`；`npm run start:litellm` 讀 `~/.config/litellm/` 讓所有 LLM 走公司 LiteLLM。公司端點網址與 key 絕不寫進 repo、文件或測試（repo 是 public）。
- 音訊只送 OpenRouter ZDR（`provider.zdr: true`），`start:litellm` 也一樣：LiteLLM 上的轉錄模型實測不達標；伺服器只綁 `127.0.0.1`。有帳號與權限（D-013），但無 HTTPS，不可對外。
- `data/`（會議、`auth.json`、`directory.json`、`ai.json`、`learned.json`、`knowledge.json`）不進 git；截圖只用 `eval/` 合成資料與虛構帳號。
- 金鑰只來自環境變數或 `~/.config/<服務>/key`（600），不進 repo、不印出。
- 推翻決策 → `docs/decisions.md` 新增一筆，舊的標「已取代」。

相關：技術堆疊 `mem:tech_stack`；常用指令 `mem:suggested_commands`；寫法慣例 `mem:conventions`；完成前必跑 `mem:task_completion`。
