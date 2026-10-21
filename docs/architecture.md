# 架構

為什麼這樣設計，見 [decisions.md](decisions.md)。程式碼：`server.js`（路由與處理流程）、`auth.js`（帳號、session、權限、名錄合併，D-013）、`ai.js`（模型設定、Agent、context window 檢查、skills，D-014）、`public/index.html`（介面）。

## 處理流程

```text
瀏覽器
  ├─ 錄音：MediaRecorder（webm/opus 或 mp4），即時字幕預設關閉，勾選後只用本機 Web Speech 辨識（D-019）
  └─ 上傳：mp4 / mov / m4a / mp3 / wav / webm …
        │  POST /api/meetings?filename&lang&title&glossary   （request body 就是檔案本身）
        ▼
server.js  create()
  data/<YYYY-MM-DD>/<id>/recording.<ext>   原始檔，當附件下載（日期是 GMT+8 的上傳日）
  data/<YYYY-MM-DD>/<id>/meeting.json      會議資料
        │  processMeeting(id)，背景執行
        ▼
  transcribing  ffmpeg → 單聲道 16 kHz 48 kbps mp3（暫存 transcode.mp3，用完刪除）
                → OpenRouter microsoft/mai-transcribe-2
                  provider.zdr=true，azure.diarization，azure.phraseList（有術語時）
  （zh-TW 或自動偵測為中文）
                → OpenCC cn→twp，每段 text 轉台灣繁體；raw 保留原文
  correcting    （有術語時）Claude 依 [n] 逐行只修術語，不確定加【?】
  summarizing   依會議的 Agent 選模型與 effort（ai.pickAI），系統提示＝基本規則＋模型附加提示＋Agent 提示＋skills；
                先檢查 context window，再產生 Markdown 摘要（[n] 指向逐字稿行號），記錄 summaryBy
  done | error
```

前端每 2 秒輪詢 `GET /api/meetings/:id`，直到狀態不是 `transcribing`、`correcting` 或 `summarizing`。使用者正在輸入時，輪詢不會重畫頁面。

介面路由（hash）：`#` 會議紀錄資料庫、`#new` 新會議、`#search=<查詢>` 搜尋、`#actions` Action Items、`#people` 成員與團隊、`#me` 個人設定、`#admin` 管理後台、`#share/<token>` 開啟分享連結、`#<id>` 會議頁；`#<id>:seg-<n>` 會開啟逐字稿並跳到第 n 段，`#<id>:notes` 開啟筆記分頁。

讀取會議時（`view()`、`loadAll()`）會用名錄即時補上 `people`、`teams`，以及 `actions[].team/leader`。這些欄位不寫回 `meeting.json`，所以改了名錄，所有舊會議都會跟著更新。

## 學習迴圈（D-020）

設計與階段在 [plans/2026-10-21-learning-loop.md](plans/2026-10-21-learning-loop.md)；0.4.0 實作了 P1～P3。

```text
data/learned.json（jsonStore，修改排隊執行）
  terms[]  {term, source: "meeting:<id>"|"manual", addedBy, addedAt, enabled}
  rules[]  P4 才使用
  voices[] P5 才使用
  bench    {cases[{meetingId, frozenAt, frozenBy}], runs[], running?, lastError?}

transcribeClean(m)：processMeeting 與 benchmark 共用
  transcribe：phraseList＝mergeTerms(會議術語, 啟用的團隊術語)，上限 500
  → OpenCC → correctTerms（同一份合併術語）→ flagForeignScript（中文會議裡的韓文、假名後加【?】）
summarizing：summarize() 與 suggestSpeakers() 同時執行；建議失敗不影響會議
```

- **團隊術語**：建立會議或修改 `glossary` 時，`learnTerms()` 把新詞加進 `terms`（不分大小寫去重）。
- **講者建議**：`suggestSpeakers()` 只處理還沒命名的講者。
  - 候選名字＝參與者＋名錄人員＋名錄裡的 Y leader。
  - Claude 以 effort low 回 JSON。`cleanHints()` 只保留候選名單裡的名字、一位講者一個建議、行號在範圍內的結果。
  - 結果存進 `meeting.speakerHints`，介面按「套用」才會改名。
- **Benchmark**：
  - 擁有者凍結時，在會議資料夾寫 `reference.json`（講者名字與去掉【?】的文字），並在會議記 `benchmarkAt`。
  - 管理員執行時，`runBench()` 對每個案例跑 `transcribeClean()`，再用 `benchMetrics()` 算指標，結果寫進 `bench.runs`（保留最近 50 次）。整體的講者正確率與 CER 依各場參考語音的時長加權（0.6.1 起）。每次執行附上 `fingerprint`：轉錄模型、校對模型與 effort、路徑（`llmRoute`）、端點主機的雜湊、校對提示的雜湊、團隊術語的雜湊；每一場另記會議術語的雜湊。只存雜湊，不存 key 或完整網址。會議本身不會被改動。
  - 指標：
    - 講者正確率（`speakerAccuracy()`，0.6.0、0.6.1 修正）：
      - 時間軸在每個片段與視窗的邊界切成互不重疊的時間片，所以重疊或重複的輸出片段只算一次。
      - 每個時間片裡，每位正在說話的參考講者都計入時長：有任何和他配對的輸出標籤正在作用就算正確；完全沒有輸出時算漏掉（`missed`）。
      - 輸出標籤與參考名字用匈牙利演算法（`bestAssignment()`）一對一配對，取總共同時間最大的組合。
      - 正確率不會超過 100%。每 15 分鐘一個視窗；也回傳參考語音時長（`refSeconds`）。
    - CER：去空白標點、簡繁統一後計算。
    - 術語命中、【?】數量。

## meeting.json

| 欄位 | 說明 |
|---|---|
| `id`, `title`, `createdAt` | 識別與顯示 |
| `originalName`, `file`, `mime` | 原始檔名、儲存檔名（`recording.<ext>`）、上傳時的 Content-Type |
| `lang` | 使用者選的語言：`zh-TW`（預設）、`auto`、`zh-CN`、`en`、`ja`… 送給 MAI 時取 `-` 前面的部分 |
| `glossary` | 術語清單原文；`parseTerms()` 以逗號、頓號、分號、換行切分並去重 |
| `status`, `error` | 處理狀態與錯誤訊息 |
| `language` | MAI 偵測到的語言 |
| `segments[]` | `{start, end, speaker, text, raw}`；`text` 是轉換與校對後版本，`raw` 是 MAI 原始輸出 |
| `speakers` | `{ "0": "Amy" }`，講者改名對照；由 `cleanSpeakers()` 驗證 |
| `participants` | 手動加入的參與者（可能沒發言）；參與者＝逐字稿講者＋這份名單 |
| `summaryStale` | 摘要完成後改了講者、段落講者或參與者時為 `true`，介面提示重新產生摘要；摘要完成時清掉 |
| `speakerHints` | `[{speaker, name, evidence: [行號], reason}]`，講者名字建議（D-020），按「套用」才改名 |
| `benchmarkAt` | 凍結為 benchmark 的時間；參考答案在同一資料夾的 `reference.json` |
| `notes` | 使用者手寫筆記，摘要時一起參考 |
| `summary`, `template`, `instructions`, `outputLang` | 摘要內容與產生設定；`template` 也是介面上的「類型」 |
| `scheduledAt`, `location`, `brief`, `tags` | 使用者設定的會議時間（`YYYY-MM-DDTHH:mm`，本機時間）、地點、一句話摘要、標籤；由 `cleanMeta()` 驗證，格式不對就存成空值 |
| `ownerId`, `access`, `grants[]` | 擁有者、其他登入者的權限（private／view／comment／edit）、分享連結授權 `{userId, perm, token}` |
| `comments[]` | `{id, userId, name, text, seg, createdAt}` |
| `usage[]` | 每次 AI 呼叫：`{kind: transcribe｜correct｜summary, provider, model, label, effort, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, audioSeconds, costUsd, ms, at, error?}`；一次處理的紀錄在 `processMeeting` 結束（含失敗）時寫入 |
| `agentId`, `summaryBy` | 會議的 Agent；產生摘要的 Agent、模型、effort、時間 |
| `actions[]` | `{text, owner, done, cite}`，摘要完成時由 `parseActions()` 從摘要的 `- [ ] 事項 — 負責人 [n]` 行解析；重新產生時，文字相同的待辦保留 `done`。舊會議沒有這個欄位時，讀取時才從摘要推導 |

`PATCH /api/meetings/:id` 的 `segSpeakers: { 段落索引: 講者編號 }` 用 `reassignSpeakers()` 改段落的講者（新講者用下一個編號，另外送 `speakers` 命名）。摘要提示會列出全部參與者，並說明講者標籤已由使用者校正，待辦負責人只用這些名字。

寫入一律走 `update(id, patch)`：同一場會議的寫入排隊執行，每次都重新讀檔、合併、存檔後才輪到下一個，背景處理和使用者編輯不會互相覆蓋。需要依現有內容計算的改動（留言、用量、分享授權、段落講者）傳函式 `update(id, cur => ({...}))`，在佇列裡讀到最新內容；不要先 `load()` 再把結果傳給 `update()`。存檔先寫每次不同名稱的 `.tmp` 再 rename。

## API

| 方法與路徑 | 用途 |
|---|---|
| `GET /` | 介面 |
| `GET /api/meetings` | 會議清單，依會議時間新到舊；含 `template`、`actions`、`attendees`、`people`、`teams` 與使用者屬性 |
| `POST /api/auth/register`、`/login`、`/logout`，`GET /api/auth/me` | 帳號與 session（cookie `sid`）；`/me` 也回傳 `app: {version, repo}`（取自 `package.json`），側欄用來顯示版本並查 GitHub 最新 Release |
| `PUT /api/me/profile`、`/api/me/password` | 個人資料（團隊、Y leader、成員、群組）與密碼 |
| `GET /api/admin`（含 `usage`：total、byKind、byModel、byDay）；`PUT /api/admin/settings`、`/api/admin/users/:id`；`POST /api/admin/users/:id/reset-password` | 管理後台（admin） |
| `GET /api/ai`；`PUT /api/admin/ai`；`POST /api/admin/ai/models/:id/test` | 模型與 Agent 設定（非 admin 只看到啟用的 Agent 名稱） |
| `POST`／`GET /api/meetings/:id/shares`；`POST`／`DELETE /api/shares/:token` | 建立、列出、開啟、撤銷分享連結 |
| `POST`／`DELETE /api/meetings/:id/comments` | 留言（需 comment 權限；刪除限本人或擁有者） |
| `GET /api/search?q=` | 搜尋，回傳 `{terms, results[]}`；語法與計分見 D-011 |
| `GET` / `PUT /api/directory` | 讀取或以 `{csv}` 覆寫名錄，回傳 `{people, csv}`；存在 `data/directory.json` |
| `POST /api/meetings?filename&lang&title&glossary&scheduledAt&location&brief&tags` | 上傳並開始處理 |
| `GET /api/meetings/:id` | 會議資料 |
| `PATCH /api/meetings/:id` | 只接受 `title`、`speakers`、`notes`、`glossary`、`actions`、`scheduledAt`、`location`、`brief`、`tags`；`actions` 會被清理成固定欄位，最多 500 筆 |
| `GET /api/meetings/:id/audio` | 播放，支援 Range；加 `?download` 會用原檔名下載 |
| `GET /api/learned` | 管理員：整份學習資料；其他人：只有啟用的團隊術語 |
| `POST /api/learned/terms` `{term}` | 新增團隊術語（唯讀帳號不行）；`PATCH` `{term, enabled}`、`DELETE ?term=` 限管理員 |
| `PUT /api/admin/ai/keys` `{modelId, key}` | 管理員設定該模型 Endpoint 的 API key；空字串＝清除。存在 `secrets.json`（600），回應只有 `keyStatus {set, last4, setAt}` |
| `POST /api/admin/ai/models/:id/list` | 讀取 OpenAI 相容端點的 `GET /models`，回傳模型 ID 清單 |
| `POST /api/learned/bench` | 管理員執行 benchmark，回 202；沒有案例回 400、執行中回 409 |
| `POST`／`DELETE /api/meetings/:id/benchmark` | 擁有者凍結或取消凍結；會議尚未完成回 409 |
| `POST /api/meetings/:id/summarize` | `{template, instructions, outputLang, retranscribe}`；`retranscribe: true` 會清空逐字稿並從轉錄重跑；處理中回 409 |

## LLM 呼叫（D-021）

`llm(system, content, {model, effort, log, kind})` 依 `model.provider` 分派：
- `openai`：用 `fetch` 呼叫 `{endpoint}/chat/completions`，送 `max_completion_tokens` 與 `reasoning_effort`（xhigh、max 先對應到 high）。拒答、`content_filter`、`length` 都轉成明確的錯誤。用量由 `openaiUsage()` 換算：快取的 prompt tokens 記成 `cacheReadTokens`。
- `anthropic`：原本的 Anthropic SDK 呼叫（beta stream、server-side fallbacks）。

暫時性錯誤會自動重試 2 次，間隔 2 秒與 8 秒（`RETRY.delays`，測試會縮短），判斷由 `isTransient()` 負責：408、409、429、5xx、529，以及串流截斷、連線重設。空的回應內容也視為暫時性錯誤（0.6.1 起），不會讓會議在摘要空白時顯示完成。每次失敗都記進 `usage`（帶 `error`）。

`apiKeyFor()` 的順序：`LLM_PROVIDER=openai` 而且模型沒有自己的 Endpoint 時，一律用啟動時的 `OPENAI_API_KEY`（0.6.1 起，避免把後台存過的舊 key 送到 LiteLLM）；其他情況依序是模型指定的環境變數、後台存的 key、`OPENAI_API_KEY`。

用到的模型：
- 術語校對：`pickFor(cfg, 'correct')`。
- 講者建議：`pickFor(cfg, 'speakers')`。
- 摘要：依會議的 Agent（`pickAI`）。

`ai.json` 的 `uses` 沒設定時，校對與講者建議用預設模型。

`LLM_PROVIDER=openai`（`npm run start:litellm`，D-022）時，`viaEnv()` 會把 `provider: anthropic` 而且沒有自己 Endpoint 的模型改走 `OPENAI_BASE_URL`。LiteLLM 回應的 `x-litellm-response-cost` 記成 `usage[].costUsd`。

## 外部相依與設定

| 項目 | 設定方式 |
|---|---|
| OpenRouter（轉錄） | `OPENROUTER_API_KEY`；沒設定時讀 `~/.config/openrouter/key`；設成空字串代表停用（測試用） |
| LLM（校對、摘要、講者建議；D-021） | 每個模型各有 provider、LLM Endpoint、API key。`openai`＝OpenAI 相容 `/chat/completions`（LiteLLM、magpie、OpenAI），Endpoint 留空用 `OPENAI_BASE_URL`；`anthropic`＝Anthropic SDK，留空用 `ANTHROPIC_BASE_URL`。API key 的順序：模型指定的環境變數 → 後台輸入、存在 `secrets.json` 的 key（依 Endpoint 共用）→ `OPENAI_API_KEY`／`ANTHROPIC_API_KEY`。`npm run start:magpie` 會把兩組變數都指向 magpie |
| ffmpeg | 系統 PATH |
| 埠號、資料夾 | `PORT`（預設 3000）、`DATA_DIR`（預設 `./data`） |

## 已知限制

程式裡用 `shortcut:` 註解標出，對應的後續工作在 [plans/2026-10-20-roadmap.md](plans/2026-10-20-roadmap.md)。

- 整場會議用一個 base64 請求送轉錄；會議很長時，OpenRouter 可能回 413。
- 術語校對一次送完整逐字稿，輸出上限是 64k tokens。
- 錄音停止前，資料都在瀏覽器記憶體裡，分頁當掉就會遺失。
- MediaRecorder 產生的 webm 沒有時長資訊，播放時拖曳跳段可能不準。

## 執行檔（D-017）

`scripts/build.sh` 先產生 `.build/ui.js`（內嵌介面字串），再依平台執行 `bun build --compile`。`server.js` 用 `COMPILED`（`import.meta.url` 含 `/$bunfs/`）判斷是否在執行檔內：在執行檔內，介面取自內嵌字串，資料預設在 `~/.notion-meetings`。`dist/` 與 `.build/` 不進 git。

## 時間

一律台灣時間（D-016）：伺服器的 `TZ`、`localDay()`、`nowIso()`，介面的 `TZ`、`day()`、`dt()`、`localInput()`。新的時間戳記帶 `+08:00`，比較與排序前先換算成 UTC。

## 權限

所有 `/api` 除了 `/api/auth/*` 都要登入。有效權限 `permOf(user, meeting)`：

- admin 永遠是 owner。
- 擁有者是 owner。
- 其他人取 `access` 與 `grants` 中最高者；private 視為 none。
- readonly 最多 view。

規則：

- 會議清單與搜尋只回傳看得到的會議。
- PATCH 需要 edit；改 `access` 需要 owner。
- 留言需要 comment；重新轉錄或摘要需要 edit。
- 看不到的會議回 404。

介面在權限不足 edit 時停用所有編輯欄位。帶 `data-keep` 的元素維持可用，例如留言框和原始辨識切換。

## 檔案（皆在 `DATA_DIR`，不進 git）

| 檔案 | 內容 |
|---|---|
| `<YYYY-MM-DD>/<id>/meeting.json`、`recording.*` | 會議與錄音原檔；日期是上傳當天的本機日期。`dir(id)` 以 id 查找（快取在記憶體），`migrateLayout()` 在啟動時把舊的 `<id>/` 搬進日期資料夾 |
| `auth.json` | 註冊開關、使用者（scrypt 雜湊）、分享連結；權限 600 |
| `directory.json` | CSV 名錄，讀取時與使用者個人資料合併（`auth.mergePeople`） |
| `<YYYY-MM-DD>/<id>/reference.json` | 凍結為 benchmark 時的參考答案（D-020） |
| `ai.json` | 模型設定、Agent 與各用途的模型（`uses`）；缺少的內建項目在讀取時補上（`ai.withBuiltins`） |
| `secrets.json` | 後台輸入的 LLM API key，依 Endpoint 存；權限 600，不經任何 API 回傳（D-021） |
| `learned.json` | 團隊術語、benchmark 案例與歷次結果（D-020）；權限 600 |
