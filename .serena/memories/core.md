# notion-meetings 核心

Notion AI Meeting Notes 本機復刻：錄音或上傳 → 分講者台灣繁體逐字稿 → LLM 摘要（預設 Claude Opus 5.5，可換 Sonnet、GPT-6.1 Sol 等）。

## 原始碼地圖
- `server.js`：路由、上傳串流、Range 播放、處理流程 `processMeeting()`、搜尋。流程細節見 `mem:backend/pipeline`。
- `auth.js`：帳號（scrypt）、記憶體 session、`permOf()` 權限、`mergePeople()` 名錄合併、`jsonStore()`；權限與帳號規則見 `mem:backend/auth`。
- `ai.js`：模型設定、內建 Agent、`pickAI()`、`checkContext()`、`loadSkill()`；見 `mem:backend/pipeline`。
- `public/index.html`：全部前端，單檔，inline CSS/JS，無框架、無 build。
- `server.test.js`：`node --test` 單元與 API 測試。
- `eval/`：測試音檔產生、轉錄模型評測、端對端回歸閘門，見 `mem:eval/core`。
- `CHANGELOG.md`：每版新增與驗證結果（目前 0.6.0）；版本號與 `repository` 在 `package.json`，`/api/auth/me` 回傳 `app {version, repo}` 給側欄左下角。
- `scripts/build.sh`（Bun 打包）、`scripts/smoke-binary.sh`（執行檔發版檢查：版本、內嵌介面、e2e）。
- `README.md`（英文）＋`README.zh-TW.md`（繁中），精簡版，只放 3 張截圖；兩份一起改。
- `docs/decisions.md`：決策 D-001..D-022，唯一權威來源；`docs/architecture.md`：欄位、路由、設定；`docs/plans/`：計畫，總覽是 `2026-10-21-next-steps.md`（P0／P1／P2），細節在 `learning-loop`、`llm-endpoints`、`reliability`、`roadmap`；`docs/research/`：評測，所有設定的分數在 `2026-10-21-benchmark-standards.md` 的準確度總表。
- Git 歷史在 2026-10-21 壓成單一 commit（`e66e5eb notion-meetings v0.5.0`），只有 `v0.5.0` tag 與 Release；之前的 commit 編號都失效。
- `.claude/skills/meetings-dev`、`.claude/skills/stt-research`：開發維護與模型評測的步驟。

## 全專案不變式
- 驗收基準 D-002：台灣繁體＋台灣用詞，中英夾雜術語正確。換模型以 `eval/` 實測為準，不看英文 WER 排行。
- 逐字稿保留原話：校對只修術語表詞彙，不確定加【?】，`segments[].raw` 必存；台灣口吻只在摘要。不得讓 LLM 改寫逐字稿語氣（實測會編造）。
- 瀏覽器即時字幕預設關閉，只能本機辨識（`processLocally`），絕不改用雲端（D-019）。
- 學習迴圈（D-020，0.4.0 實作 P1～P3）：`data/learned.json` 存團隊術語與 benchmark；講者建議只是建議（`meeting.speakerHints`），按「套用」才改名；只學使用者確認過的內容，`raw` 保留，新規則要 benchmark 不下降才啟用；學習資料與聲紋只在本機 `DATA_DIR`。
- LLM 端點（D-021、D-022）：每個模型有 provider（`openai`＝OpenAI 相容／LiteLLM、`anthropic`）、Endpoint、API key；後台輸入的 key 存在 `DATA_DIR/secrets.json`（600），依 Endpoint 共用，API 只回 `keyStatus` 末四碼。預設 `npm run start:magpie`；`npm run start:litellm` 讀 `~/.config/litellm/` 讓所有 LLM 走公司 LiteLLM。公司端點網址與 key 絕不寫進 repo、文件或測試（repo 是 public）。
- 音訊只送 OpenRouter ZDR（`provider.zdr: true`），`start:litellm` 也一樣：LiteLLM 上的轉錄模型實測不達標；伺服器只綁 `127.0.0.1`。有帳號與權限（D-013），但無 HTTPS，不可對外。
- `data/`（會議、`auth.json`、`directory.json`、`ai.json`）不進 git；截圖只用 `eval/` 合成資料與虛構帳號。
- 金鑰只來自環境變數或 `~/.config/<服務>/key`（600），不進 repo、不印出。
- 推翻決策 → `docs/decisions.md` 新增一筆，舊的標「已取代」。

相關：技術堆疊 `mem:tech_stack`；常用指令 `mem:suggested_commands`；寫法慣例 `mem:conventions`；完成前必跑 `mem:task_completion`。
