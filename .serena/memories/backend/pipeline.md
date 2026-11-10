# 後端處理流程（server.js）

- 轉錄共用 `transcribeClean(m, log)`：`termsFor()`＝`mergeTerms(會議術語, 團隊術語＋knowledge.json 術語)`（上限 500）；phraseList 另加 `m.participants`（只進 MAI，不進校對）→ OpenCC → `correctTerms` → `flagForeignScript`。摘要時 `summarize()` 與 `suggestSpeakers()` 並行，建議失敗不影響會議。Benchmark：`runBench()` 用同一份流程重跑凍結會議並記錄 `fingerprint`（轉錄模型、校對模型與 effort、路徑、端點主機／校對提示＋知識檔別名（`aliasLines()`）／團隊術語的雜湊，每場另有會議術語雜湊）；整體分數依各場 `refSeconds` 加權；`benchMetrics()`＝講者正確率（`speakerAccuracy()`：時間軸切成互不重疊的時間片（0.6.1，重疊或重複的輸出片段只算一次，正確率不超過 100%），匈牙利演算法 `bestAssignment()` 一對一配對，只計配對正確的時間，列出 `missed` 與 `refSeconds`，跨 15 分鐘邊界切開；0.6.0 前會高估，0.6.0 遇到重疊片段會重複計算）、CER、術語命中、【?】數。
- JSON 建立的會議先為 `draft`。需轉錄時依序為 `transcribing` → `correcting`（有術語時）→ `summarizing` → `done` | `error`；全部已有轉錄時可直接摘要。前端每 2 秒輪詢，前後端的 `BUSY` 清單與 409 檢查必須同步。
- `transcribe(m)`：ffmpeg 轉單聲道 16 kHz 48 kbps `transcode.mp3`（finally 刪除）→ `requestTranscription(audio, lang, terms, log, meetingId)` 呼叫 OpenRouter `/api/v1/audio/transcriptions`，model `microsoft/mai-transcribe-2`，JSON base64 `input_audio`，`response_format: verbose_json`，`provider.options.azure.diarization.enabled`，有術語才帶 `azure.phraseList.phrases`（空陣列可能報錯）。`language` 取 `m.lang` 的 `-` 前段；`auto` 不送。
- MAI 即使 `language: zh` / `zh-TW` 仍輸出簡體 → `toTaiwan`（opencc-js `cn`→`twp`）。只在 `lang === 'zh-TW'` 或 `auto` 且偵測 `zh*` 時轉；`zh-CN` 不轉。
- `correctTerms()`：送 `[n] text` 行給 Claude（`CORRECT_SYSTEM`），附 `aliasLines(knowledge)`「誤聽 → 術語」（D-025，放在 user content；寫進 system prompt 實測讓嚴苛 e2e 掉到 41～42，不要移過去），`applyNumbered()` 回填；缺行、越界、空字串保留原文。再經 `keepTermEdits(before, after, terms)`：token 級 LCS diff，只空白相隔的 hunk 合併判斷；hunk 落在 after 的某個術語範圍內、或只加【?】才保留，其餘逐處還原（不是整行），憑空插入術語也還原；有還原時 usage 的 correct 紀錄記 `rejected` 行數。講者與時間戳不經過 LLM。
- `llm(system, content, {model, effort, log, kind})`（0.5.0 起取代 `claude()`）：沒給 model 時用預設模型；先 `checkContext()`（估 tokens＋maxOutput > contextWindow 就報錯，不截斷）；`viaEnv()` 在 `LLM_PROVIDER=openai` 時把沒有自己 Endpoint 的模型改走 `OPENAI_BASE_URL` 並去掉 `codex/` 這類 magpie 前綴；依 provider 分派：`openai` 用 fetch 呼叫 `/chat/completions`（`reasoning_effort`，xhigh/max→high；拒答、content_filter、length 轉成錯誤；`x-litellm-response-cost` 記成 `costUsd`），`anthropic` 用 Anthropic SDK（只有 opus-5-5／sonnet-5-5／fable-5-1 送 `fallbacks: 'default'`）。`apiKeyFor()`：`LLM_PROVIDER=openai` 而且模型沒有自己的 Endpoint 時一律用啟動時的 `OPENAI_API_KEY`（0.6.1，避免舊的已存 key 被送到 LiteLLM）；否則依序是模型的 apiKeyEnv → `secrets.json` 依 Endpoint 的 key → `OPENAI_API_KEY`。暫時性錯誤（`isTransient()`：408/409/429/5xx/529、串流截斷）與空的回應內容（0.6.1）重試 2 次（`RETRY.delays`，預設 2 秒、8 秒，測試會縮短），每次失敗都記進 log。校對用 `pickFor(cfg, 'correct')`、講者建議用 `pickFor(cfg, 'speakers')`、摘要用 Agent 的 `pickAI`。
- 摘要經 `pickAI(cfg, m.agentId)` 選模型，可使用 Anthropic 或 OpenAI 相容 provider；Agent 停用或指定模型不可用時沿用既有預設選擇規則。系統提示組合 `SUMMARY_SYSTEM`、模型附加提示、Agent 提示、skills 與團隊背景知識。`teamKnowledge()` 每次重讀知識檔，改檔不必重啟；產生後寫入 `summaryBy`。
- 啟動檢查（0.7.0）：`llmKeyMissing()` 用 `apiKeyFor(viaEnv(預設模型))`，Anthropic 另認 `ANTHROPIC_API_KEY`／`ANTHROPIC_AUTH_TOKEN`；缺 key 只印警告，不阻擋啟動，也不檢查用途另指定的模型。
- 用量：`llm(..., {log, kind})`、`transcribe(m, log)` 把紀錄推進 `log`，`processMeeting` 的 finally 寫入 `meeting.usage`（失敗也存）。顯示總輸入要加快取讀寫（magpie 自動快取，`input_tokens` 只有個位數）。
- 資料夾：`data/<本機上傳日>/<id>/`，一律經 `dir(id)`（快取＋掃描日期資料夾）與 `meetingIds()`，不要自己拼 `DATA/id`；啟動時 `migrateLayout()` 搬舊版。
- magpie 會默默丟掉 `mcp_servers`（2026-10-21 實測），remote MCP 尚未支援。
- `openrouterKey()`：`OPENROUTER_API_KEY` 定義（含空字串）就用它，否則每次讀 `~/.config/openrouter/key`；空字串＝停用，測試靠這點避免呼叫真 API。
- `POST /:id/summarize` 以排隊的 `update()` 預留處理狀態，同時啟動會回 409。`retranscribe: true` 才將所有 section 標為未轉錄，清空既有逐字稿並重跑；一般處理重用已轉錄部分。
- 講者與參與者：PATCH 的 `speakers` 經 `cleanSpeakers()`；`segSpeakers` 經 `reassignSpeakers()` 改段落講者。`participants` 經 `cleanMeta()`，`attendees()` 合併講者與手動參與者，摘要提示列出全部參與者。變更後的過期追蹤見下方多 section 規則，不自動重跑。
- 摘要完成後 `parseActions(summary, 現存 actions)` 寫入 `actions`；`done` 只靠文字完全相同保留。`withActions()` 讓 GET/PATCH/list 對舊會議即時推導。PATCH 的 `actions` 經 `cleanActions()` 清理。
- 讀取一律經 `view()`／`loadAll()`：`withDefaults()` 補舊會議欄位，`enrich()` 依 `data/directory.json` 補 `people`、`teams`、`actions[].team/leader`；這些衍生欄位不得寫回 `meeting.json`。
- 搜尋 `searchMeetings()` 為純函式（輸入已 enrich 的會議），`normQ()`＝NFKC＋小寫＋`s2twp`；注意 `s2twp` 會把「台」轉成「臺」，查詢與資料兩邊都轉，所以仍能互相比對。
- 寫入：`update(id, patch)` 每場會議排隊；依現有內容計算的改動傳函式 `update(id, cur => ({...}))`，不要先 `load()` 再傳結果；暫存檔名每次不同。
- 實測（2026-10-21，三段內部錄音）：一人主講的會議 MAI 分講者合理；多人快速輪流的站立會議會拆錯也併錯。經 OpenRouter 傳 `maxSpeakers`：camelCase 回 400，snake_case 被忽略。`loudnorm` 沒有幫助。團隊術語表能修正大部分術語誤聽。2026-10-22：43～51 分鐘整段送 MAI 都成功（2.7～5.3 分鐘）；同一音檔轉兩次 MAI 輸出不同（段落、講者數、文字），phraseList 裡已有的詞仍會聽錯（例如產品名被聽成近音詞），要靠知識檔 `aliases` 讓校對修。
- 已知捷徑：每個媒體檔各用一次 base64 轉錄請求，更長的單檔仍可能遇到 413；術語校對也是逐檔單次請求，受輸出上限限制。

## 草稿與多 section（D-026）

- JSON `POST /api/meetings` 建立無媒體草稿，不呼叫 AI；舊的原始檔上傳 API 保留自動處理。新增 section 也不自動處理，先確認名稱與順序，再由使用者啟動摘要。
- `sections[]` 管理各檔的 id、標題、檔案與 `transcribed`。舊單檔會議讀取時轉為 `legacy` section；不得刪除原始錄音。音訊 API 以 `section` 選檔，省略時取第一個。
- 每個 section 的時間從各自 00:00 起算。`sectionSpeakerMap` 隔離各檔的講者編號，僅供後端使用，不從 API 回傳；不同檔案的同號講者不代表同一個人。
- 排序只能送全部既有 section 的完整排列及標題。逐字稿隨之重排，並同步維持摘要、action、留言與講者建議的引用；不要只改 `sections[]`。
- 筆記、講者或 section 變更會標示摘要過期。產生摘要時取筆記快照；若處理期間又改筆記，完成後仍保留 `summaryStale`，不可一律清成 false。

## 轉錄診斷與錯誤邊界

- `debugTranscription()` 共用於管理員 `POST /api/admin/transcription-test` 與 `mise exec -- node server.js --debug-transcription`。CLI 不開 HTTP server，成功 exit 0、失敗 exit 1；回 `{ok, message, at, model, checks}`。
- 診斷先查 key 額度，再用 ffmpeg 產生 1 秒靜音，經正式 `requestTranscription()` 送目前團隊術語、ZDR 與分講者選項。不讀會議錄音、不帶個別會議術語與參與者；仍會有少量 API 費用。通過只表示短請求被接受，不代表長錄音或辨識品質通過。
- `[transcribe]` 記開始／完成／失敗與安全的請求統計。HTTP、斷線與 JSON 解析失敗都進 `log`；正式流程存 `meeting.usage`，可用時包含 `httpStatus`／`requestId`，另記 `audioBytes`／`phraseCount`／`language`／`zdr`。排查訊息經 `meeting.error` 顯示在網頁；診斷結果不存進會議用量。
- 不回傳或記錄上游原始 body，避免洩漏 key、音訊或術語。429 不足以分辨 key／帳戶／IP／供應商共享容量限流。轉錄沒有自動重試，勿與 `llm()` 的重試混淆。
- 轉錄 API 的術語上限為 200（D-003 補充實測，200 成功／201 回 400）。`requestTranscription()` 取前 200 個，維持會議術語優先的順序；超量以 `omittedPhraseCount`／`warning` 記入 log，並顯示在診斷與會議用量明細。不要降低 `mergeTerms()` 的 500 個上限，完整合併清單仍供校對使用；不刪學習資料。
