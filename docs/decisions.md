# 決策紀錄

本檔是 notion-meetings 技術決策的唯一來源。改動轉錄、校對、摘要流程或服務商之前，先讀相關決策；要推翻某項決策，就新增一筆決策並把舊的標成「已取代」，不要直接改寫舊內容。

評測方法與完整數據在 [research/2026-10-20-stt-evaluation.md](research/2026-10-20-stt-evaluation.md)。

## D-001 最小技術堆疊

- 日期：2026-10-20。狀態：採用。
- 決策：後端只用 Node 內建 `http`，前端是單一 `public/index.html`，不用框架。相依套件只有 `@anthropic-ai/sdk` 和 `opencc-js`；ffmpeg 是系統工具。
- 理由：功能範圍小，單人本機使用。每多一個框架就多一層要維護的東西。
- 後果：路由、Range 下載、上傳串流都在 `server.js` 自己處理。要加多人、登入或部署到外部時，再重新評估。

## D-002 驗收基準：台灣繁中＋英文專業術語

- 日期：2026-10-20。狀態：採用。
- 決策：逐字稿必須是台灣繁體中文與台灣用詞，中英夾雜的專業術語（例如 Karpenter、IRSA、PgBouncer、二代健保）必須正確。選模型以 `eval/` 的實測為準，公開排行榜只用來挑候選。
- 理由：使用者的會議是台灣的技術與商務會議，大量中英夾雜。英文為主的 WER 排行無法反映這個情境；實測中，英文排行第一的模型在中文仍輸出簡體並聽錯術語。
- 後果：`eval/e2e.py` 的門檻就是這個基準的可執行版本。

## D-003 轉錄採用 OpenRouter 的 MAI-Transcribe 2

- 日期：2026-10-20。狀態：採用，取代原本的 Deepgram Nova-3。
- 決策：`microsoft/mai-transcribe-2`，透過 OpenRouter `/api/v1/audio/transcriptions`，強制 `provider.zdr: true`，開啟 `azure.diarization`，有術語時帶 `azure.phraseList.phrases`。
- 理由：在受測的專用轉錄模型中，它的術語正確率最高（乾淨 44/45、嚴苛 36/45，皆帶術語清單）；分講者在兩種音檔都是 3/3；有 ZDR 端點；每小時約 0.10 美元。聽錯時通常產生看得出來的亂碼，而不是通順的假內容。
- 不採用的選項與原因：
  - Deepgram Nova-3：英文 AA-WER 5.2%，落後其他候選；沒有金鑰可實測。
  - ElevenLabs Scribe v2：43/24，`keyterms` 參數經 OpenRouter 沒有效果，乾淨音檔把兩位女聲併成一人。
  - AssemblyAI Universal-3.6 Pro：40/30，經 OpenRouter 沒回傳講者，插入原文沒有的「哇哦！」。
  - Google Gemini 3.5 Transcribe：乾淨音檔是繁體但只有 40/45，嚴苛音檔大段內容消失（0/45），而且沒有 ZDR 端點。
  - Qwen3-ASR 1.7B（DeepInfra）：簡體、35/14，嚴苛音檔冒出泰文；`initial_prompt` 只作用於第一個 30 秒。
  - Qwen-Audio-3.1-ASR：功能最符合（分講者、兩級熱詞），但只在阿里雲 Model Studio 提供，沒有實測。列入 [plans/2026-10-20-roadmap.md](plans/2026-10-20-roadmap.md) 待評估。
- 後果：MAI 輸出簡體，靠 D-005 轉換；聽錯但不是術語的地方（例如「調到」聽成「降到」）不會被抓出來。

## D-004 不用聊天型 LLM 直接轉錄

- 日期：2026-10-20。狀態：採用。
- 決策：magpie 上的 Gemini（`antigravity/gemini-4-argon`、`gemini-3.8-flash`）不作為逐字稿來源。
- 理由：Argon 的術語分數最高（45/44）且是繁體，但聽不清楚時會用常識補出通順的假內容，例如把「要另外算」寫成「要預扣 2.11%」；flash 在嚴苛音檔整句編造。讀者無法分辨哪句是真的，這對會議記錄是最嚴重的錯誤。另外，音訊必須用 chat 的 `file` 欄位送；用 `input_audio` 時 gateway 會丟掉音訊，flash 會照樣產生假逐字稿。
- 後果：LLM 只用在已有文字的步驟（D-006、D-007）。

## D-005 用 OpenCC s2twp 轉成台灣繁體與用詞

- 日期：2026-10-20。狀態：採用。
- 決策：語言選「中文（台灣）」，或自動偵測為中文時，每段逐字稿都用 `opencc-js` 的 `cn → twp` 轉換。選「中文（簡體）」則不轉。
- 理由：規則式轉換結果固定、不會改內容，也會換掉大陸用詞（軟件→軟體、默認→預設、數據庫→資料庫）。

## D-006 術語校對只修術語表，不確定就標【?】

- 日期：2026-10-20。狀態：採用。
- 決策：會議有術語清單時，Claude 依段落編號 `[n]` 逐行校對，只把明顯是術語表詞彙的誤聽改成術語表寫法；疑似聽錯但無法確定的地方保留原文並加【?】。每段同時保存 `raw`（MAI 原始輸出），介面可切換對照。
- 理由：實測中，嚴格校對把嚴苛音檔從 36/45 提升到 43/45，並把無法辨識的地方標出來。另一種「改成台灣用語與語氣」的寬鬆改寫雖然得到 45/45，卻把亂碼改寫成通順但錯誤的句子（「CPU 介紹到來的 KPC」→「順便調整 HPA 的 CPU threshold」，70% 消失）。
- 後果：逐字稿的語氣維持說話者原樣，台灣口吻只出現在摘要。沒有術語清單的會議只做 D-005。

## D-007 摘要用 Claude Opus 5.5，經 magpie gateway

- 日期：2026-10-20。狀態：採用。
- 決策：`claude-opus-5-5`，`effort: medium`，開啟 server-side fallback。以 `ANTHROPIC_BASE_URL=http://127.0.0.1:3425`、`ANTHROPIC_API_KEY=magpie` 指向本機 magpie gateway。摘要一律用台灣繁體與台灣用詞，重點後面用 `[n]` 標註逐字稿行號，【?】內容寫成「待確認」。
- 理由：2026 年 10 月 Artificial Analysis Intelligence Index 第一名（57.6）；magpie 使用既有的 Claude 訂閱額度，不另付 API 費用。
- 後果：magpie 沒開時，校對與摘要會失敗並顯示錯誤；改用官方 API 只需換掉兩個環境變數。觀察到 magpie 會額外注入約 1,900 token 的系統提示，內容與影響未查證。

## D-008 隱私邊界

- 日期：2026-10-20。狀態：採用；「沒有登入」一項已由 D-013 取代，只綁本機仍然有效。
- 決策：伺服器只綁 `127.0.0.1`，沒有登入。錄音原檔只存在本機 `data/<id>/`。音訊只送 OpenRouter 的 ZDR 端點（Azure）；逐字稿文字送 Claude。金鑰存在 `~/.config/<服務>/key`（權限 600），不放在專案裡。
- 理由：會議內容屬於內部資料，使用者要求 ZDR。
- 後果：要開放給其他人使用前，必須先加上驗證機制。

## D-009 即時字幕只是預覽

- 日期：2026-10-20。狀態：已由 D-019 取代。
- 決策：錄音時的即時字幕用瀏覽器 Web Speech API，只顯示、不存檔；正式逐字稿在停止錄音後才產生。
- 理由：不需要另一個串流服務；Firefox 沒有這個 API 時，錄音照常運作。

## D-010 介面依照 Notion 原生使用習慣

- 日期：2026-10-21。狀態：採用。
- 決策：左側工作區導覽；「會議紀錄」是資料庫表格（名稱、日期、類型、狀態、參與者、待辦完成數）；會議是有屬性欄的頁面，內含 AI 會議筆記區塊，分「摘要／筆記／逐字稿」分頁，底部有「指示」下拉與重新產生摘要；另有跨會議的 Action Items 追蹤表。參考 Notion AI Meeting Notes 區塊，以及 Meeting Notes & Action Item Tracker 類模板的「會議＋待辦」雙資料庫組合。
- 待辦事項由伺服器解析摘要的待辦行而來，不另外呼叫 LLM。勾選狀態存在 `actions[].done`，摘要與 Action Items 表共用同一份資料。
- 理由：使用者要求貼近 Notion 原生操作；解析既有摘要格式不增加成本，也不會讓 LLM 另外產生一份可能不一致的清單。
- 後果：重新產生摘要時，只靠文字完全相同來保留勾選，模型改寫措辭後會變回未完成。負責人和截止日目前不能在介面上編輯。

## D-011 會議屬性與搜尋

- 日期：2026-10-21。狀態：採用。
- 決策：會議新增使用者設定的時間、地點、一句話摘要、標籤。搜尋由伺服器逐場掃描標題、標籤、摘要、地點、參與者、團隊、筆記、AI 摘要、待辦與逐字稿：
  - 多個關鍵字要全部符合，可以分散在同一場會議的不同欄位。
  - 查詢與內容都先做 NFKC、轉小寫、OpenCC `s2twp`，所以簡體、繁體、大小寫都能互相找到。
  - 支援 `tag:`、`who:`、`team:`、`leader:`、`type:`、`after:`、`before:` 與 `"片語"`。
  - 計分依欄位權重：標題 10、標籤 8、摘要 6、待辦 5、AI 摘要 4、筆記／地點／參與者／團隊 3、逐字稿每段 1（最多 5）；同分時新的排前面。
- 理由：本機會議數量不多，線性掃描最簡單，也不必維護索引；中英夾雜與簡繁混用是這個使用情境最常見的漏找原因。
- 後果：會議數到數千場時要改成倒排索引（程式內有 `shortcut:` 註解）。語意搜尋（向量）暫不做，需要時再評估本機 embedding。

## D-012 成員名錄對應團隊與 Y leader

- 日期：2026-10-21。狀態：採用。
- 決策：名錄是 `姓名, 團隊, Y leader, 別名` 的 CSV，存在 `data/directory.json`（不進 git，避免真實名單流到公開 repo）。講者名字與待辦負責人在讀取時對應：
  1. 完全符合姓名或別名。
  2. 完全符合團隊名。
  3. 文字中包含的最長團隊名。
  4. 文字中包含的最長姓名。

  對應到團隊時，Y leader 取該團隊成員最常見的 Y leader。已知團隊的參與者資訊也會提供給摘要，讓 Claude 指派負責人時參考。
- 理由：摘要寫出的負責人常是自由文字，例如「Speaker B（Rex）」「Platform team（Ken 說明）」；在讀取時才對應，改名錄就會回溯套用到所有會議。
- 後果：短名字可能誤判，所以包含比對只用兩個字以上的名字。名錄目前只有一份，誰都能改；登入與權限見 docs/plans/2026-10-20-roadmap.md。

## D-013 帳號、角色與會議權限

- 日期：2026-10-21。狀態：採用。使用者確認：維持只開本機；新會議預設所有登入者可檢視；分享連結需登入；個人資料與名錄合併。
- 決策：
  - **帳號與 Session**：帳號密碼用 Node 內建 scrypt 雜湊（不加套件）。Session 是 32 bytes 隨機 token，存在伺服器記憶體，cookie 為 HttpOnly、SameSite=Lax，有效 7 天。
  - **第一個帳號**：自動成為管理員，並接管既有會議。
  - **角色**：admin、member、readonly；readonly 的有效權限最多到檢視，分享連結也不會提高。
  - **會議權限**：每場會議有擁有者與 `access`（private／view／comment／edit，預設 view）。分享連結是隨機 token，登入者開啟後取得 `grants`；撤銷時同時移除授權。看不到的會議一律回 404，不透露是否存在。
  - **管理後台**：開關註冊、調整角色（不能移除自己的管理員權限）、重設密碼（產生只顯示一次的臨時密碼，並登出該使用者）。
  - **防護**：同一帳號連錯 5 次鎖 1 分鐘；有 Origin 標頭的跨來源寫入一律拒絕。
- 理由：使用者需要多人共用與權限分級；只開本機時不需要 HTTPS 與分散式 session，記憶體 session 最簡單。
- 後果：重新啟動伺服器後所有人要重新登入。要開放到網路之前，至少要加上 HTTPS、Secure cookie、持久化 session、更嚴格的密碼與稽核紀錄。

## D-014 模型設定與會議 Agent

- 日期：2026-10-21。狀態：採用。
- 決策：
  - **模型設定**：存在 `data/ai.json`，由管理員編輯。每個模型有 provider、model ID、endpoint、API key 環境變數名稱、context window、輸出上限、effort、附加提示、連線測試結果。
  - **預設模型**：Claude Opus 5.5（effort medium，預設）與 Sonnet 5.5（effort high），context window 1M、輸出上限 64K。OpenAI GPT-6.1 Sol、Gemini 4 只保留設定，目前不能啟用。
  - **Agent**：Agent 是會議的系統提示，可以指定模型、effort 與 skills（SKILL.md 本機路徑或 URL，最多 50KB，內容放進系統提示）。內建 14 個 Agent：一般、DRI 交接、架構討論、AWS EKS 升級、EKS 元件升級、CI/CD、AISDLC、Skill 開發與 Eval、Daily standup，以及 5 種 design review。
  - **摘要的組成**：基本規則（只寫逐字稿內容、`[n]` 引用、台灣用語、【?】寫成待確認）＋模型附加提示＋Agent 提示＋skills。
  - **Context window**：送出前估算 tokens（中日韓字元每字約 1.1 token，其他每 3 字元 1 token），加上輸出上限超過 context window 就報錯，不會截斷內容。
- 理由：使用者要依會議性質切換整理焦點，並集中管理模型參數。新舊會議共用同一套必備段落（`## 待辦事項` 格式），Action Items 才能照常解析。
- 後果：
  - **Remote MCP 暫不支援**：實測 magpie 會默默丟掉 Anthropic MCP connector 的 `mcp_servers`（2026-10-21：送出 deepwiki MCP，模型回覆「沒有工具可用」）。要支援，需要直連 Anthropic API，或在伺服器實作 MCP client，見 docs/plans/2026-10-20-roadmap.md。
  - **skill 內容會送給模型**：路徑或 URL 只有管理員能設定。

## D-015 錄音依日期分資料夾，並記錄 AI 用量

- 日期：2026-10-21。狀態：採用。
- 決策：
  - **資料夾**：會議資料夾改成 `data/<上傳當天的本機日期>/<id>/`，程式一律以 id 查找，日期只用來在磁碟上瀏覽。舊的 `data/<id>/` 在啟動時自動搬移。
  - **用量紀錄**：每次 AI 呼叫都寫一筆用量到 `meeting.usage`（連線測試寫在 `ai.json` 的測試結果）。轉錄記 OpenRouter 回報的音訊秒數與實際費用；Claude 記 `usage` 的四種 tokens、模型、effort、耗時，失敗的呼叫也記耗時與錯誤。
  - **介面呈現**：總輸入是 `input_tokens`＋快取讀取＋快取寫入。
- 理由：使用者要依日期整理錄音、掌握 token 與時間的消耗。實測經 magpie 時 `input_tokens` 只有個位數，大部分輸入都算在快取裡，只看 `input_tokens` 會嚴重低估。
- 後果：Claude 走訂閱額度，不換算美元；要估 API 費用時再加價格表。用量跟著會議存放，刪除會議時用量也一起消失。

## D-016 時間一律用台灣時間（GMT+8）

- 日期：2026-10-21。狀態：採用（使用者要求）。
- 決策：伺服器與介面都固定用 `Asia/Taipei`，不依賴機器或瀏覽器的時區。
  - **伺服器**：日期資料夾、依日期統計與 `after:`／`before:` 篩選都用台灣日期；新寫入的時間戳記用 `nowIso()`，格式如 `2026-10-21T07:18:08.000+08:00`。
  - **預約時間**：`scheduledAt` 視為 GMT+8 的時刻。排序前一律換算成 UTC，所以舊資料的 `Z` 時間戳記可以和新格式一起正確排序。
  - **介面**：日期時間一律用 `timeZone: 'Asia/Taipei'` 顯示（24 小時制），時間輸入欄的預設值也是台灣時間。
- 理由：使用者在台灣，存檔與畫面都要直接看得懂；伺服器未來不一定在台灣時區執行。
- 後果：台灣沒有日光節約時間，固定 +8 小時不會出錯。改成多時區使用時，要改為存 UTC、依使用者時區顯示。

## D-017 用 Bun 打包單一執行檔

- 日期：2026-10-21。狀態：採用。
- 決策：開發與測試仍用 Node；發佈時用 `bun build --compile` 打包各平台執行檔（`scripts/build.sh`）。
  - **介面**：建置時把 `public/index.html` 轉成字串模組 `.build/ui.js`，只有在執行檔裡（`import.meta.url` 含 `/$bunfs/`）才載入；原始碼執行時照舊讀檔，避免讀到過期內容。
  - **資料**：執行檔的程式路徑是虛擬的 `/$bunfs/root`，資料預設改存 `~/.notion-meetings`。
- 理由：讓沒有 Node 與專案原始碼的人也能使用；Bun 可以交叉編譯，不必在各平台各自建置。
- 不採用：直接把 HTML 交給 Bun 當入口打包，Bun 會改寫 HTML（實測 12 bytes 變成 93 bytes），對內嵌腳本的頁面有風險。
- 後果：
  - **外部依賴**：ffmpeg、OpenRouter 金鑰、Anthropic 端點仍需使用者自備。
  - **macOS 簽章**：執行檔只有 ad-hoc 簽章，從網路下載後要移除 quarantine 屬性才能執行。
  - **大小**：每個平台約 70～95 MB。
  - **Bun 版本**：只用正式版建置。canary 版無法下載其他平台的執行環境（0.3.0 時實測 404）。

## D-018 改講者後提示重新產生摘要，不自動重跑

- 日期：2026-10-21。狀態：採用（使用者要求重新對標）。
- 決策：改了講者名字、段落講者或參與者，而且已經有摘要時，在會議上記 `summaryStale: true`。介面在摘要與 Action Items 上方提示，由使用者按「重新產生摘要」；摘要完成時清掉。摘要提示列出所有參與者（含沒發言的人），並要求待辦負責人只用這些名字。
- 理由：校正講者常常要連改好幾段，每改一次就重跑會浪費 tokens，也會在使用者還沒改完時產生半套結果。
- 後果：摘要可能暫時和逐字稿不一致，所以用提示標明。待辦的勾選狀態仍依 D-010，只有文字相同的待辦會保留。

## D-019 即時字幕預設關閉，只用本機辨識

- 日期：2026-10-21。狀態：採用（外部 review 指出，經使用者同意）。取代 D-009。
- 決策：即時字幕改為使用者勾選才啟用（記在瀏覽器的 localStorage）。啟用時先用 `SpeechRecognition.available({langs, processLocally: true})` 確認能在本機辨識，必要時 `install()` 下載語言包，再以 `processLocally = true` 啟動。不能在本機辨識時就不顯示字幕，絕不改用雲端辨識。
- 理由：Chrome 的 Web Speech API 預設把音訊送到雲端語音服務，違反 D-008「音訊只送 OpenRouter ZDR」。D-009 當初沒有處理這個衝突。
- 後果：多數瀏覽器（Firefox、沒有本機語言包的 Chrome）看不到即時字幕，但錄音與正式逐字稿不受影響。即時字幕仍只是預覽，不存檔。

## D-020 學習迴圈：只學確認過的內容，benchmark 把關

- 日期：2026-10-21。狀態：採用，0.4.0 實作 P1～P3；P4、P5 見計畫。
- 決策：每台 Mac 一份 `data/learned.json`。
  - **團隊術語**：會議的術語自動累積成團隊術語，每場轉錄併入 MAI 術語清單與 Claude 校對。
  - **文字系統檢查**：中文會議出現韓文或日文假名時標【?】。
  - **講者建議**：Claude 依點名線索建議講者名字，只能用參與者、名錄人員與 Y leader 的名字，使用者按「套用」才生效。
  - **Benchmark**：使用者凍結校正過的會議當參考答案，由管理員手動觸發；在伺服器內用正式流程重跑，不另寫 Python 版本。
- 理由：三段內部錄音實測（docs/plans/2026-10-21-learning-loop.md）。
  - 團隊術語讓站立會議不填會議術語也能聽對 Bastion、cron job、Istio、EKS、runbook、GoAlert。
  - 點名線索在三場會議都有。
  - 經 OpenRouter 傳 `maxSpeakers` 無效，`loudnorm` 沒有改善。
- 後果：
  - 講者建議多一次 Claude 呼叫（`kind: speakers`，約 7～13 秒），和摘要同時執行。
  - 名錄只有 Kenny、會議裡說「Ken 大大」時，模型曾硬配成 Kenny。所以候選名單加入 Y leader，並要求名字不完全相同時不要對應，代價是拼法不同的正確名字（Kennie 對 Kenny）也不會被建議。
  - Benchmark 每次會重新呼叫 OpenRouter 與 Claude，三段約 $0.07、3 分鐘。

## D-021 LLM 改用使用者設定的端點，以 OpenAI 相容為主

- 日期：2026-10-21。狀態：採用（使用者要求），0.5.0 實作。補充 D-008、D-014、D-015。
- 決策：每個模型設定 provider、LLM Endpoint 與 API key。
  - `openai`（OpenAI 相容，給公司 LiteLLM、magpie、OpenAI 用）是主要路徑；`anthropic` 保留原生 SDK。
  - API key 可以在管理後台輸入，存在本機 `DATA_DIR/secrets.json`（權限 600），依 Endpoint 共用；API 只回「已設定、末四碼」。也可以改用環境變數。
  - 術語校對與講者建議可以各自指定模型。
  - 暫時性錯誤自動重試 2 次。
  - 內建 gpt-6.1-sol、gpt-6-luna 的設定（預設停用），預設模型仍是 Opus 5.5。
- 理由：
  - 每位使用者在自己的 Mac 上安裝，公司以 LiteLLM 統一提供模型，所以端點與金鑰要由使用者自行設定。
  - 實測 gpt-6.1-sol 校對與摘要都能用，而且快很多（docs/research/2026-10-21-openai-models.md）。
- 資料邊界（更新 D-008）：
  - 逐字稿、筆記與 Agent 的 skill 會送到使用者在後台設定的端點，後台頁面明確寫出這一點。
  - 建議用公司的 LiteLLM。轉錄仍只送 OpenRouter ZDR。
- 後果：
  - gpt-6-luna 校對嚴苛音檔只有 39/45，不建議用在校對。
  - gpt-6.1-sol 曾把不確定的誤聽直接改成另一個術語（Postres→Postgres，原文是 OAuth），不如 Opus 保守。要靠 reliability 計畫第 4 項的 diff 驗證補強。
  - magpie 每次請求會多約 4K tokens 的提示。

## D-022 `npm run start:litellm`：文字 LLM 全部走公司 LiteLLM，轉錄暫留 OpenRouter

- 日期：2026-10-21。狀態：採用（使用者要求），0.6.0 實作。
- 決策：
  - `npm run start:litellm` 從 `~/.config/litellm/base_url`、`~/.config/litellm/key` 讀端點與 key（可以用 `LITELLM_BASE_URL`、`LITELLM_API_KEY` 覆寫），設定 `LLM_PROVIDER=openai`。
  - 這樣沒有自己 Endpoint 的模型（含 Claude）都經 OpenAI 相容端點呼叫，模型 ID 裡 magpie 的前綴（`codex/`、`copilot/`、`devin/`）自動去掉，`x-litellm-response-cost` 記成 `costUsd`。
  - 預設仍是 magpie（`npm run start:magpie`），內建模型 ID 用 magpie 的名稱；LiteLLM 是使用者自行選用的設定。
  - 端點網址與 key 只放在每台 Mac，不寫進 repo（repo 是公開的）。
- 理由：
  - 使用者要一個指令就讓所有呼叫走公司 LiteLLM。
  - 實測文字模型的分數和走 magpie 時相同，而且更快，也沒有 gateway 注入的提示。
- 不採用：轉錄改走 LiteLLM。LiteLLM 上只有 `gpt-4o-transcribe` 系列與 `whisper-1`：
  - 有分講者的那個，術語只有 27／11。
  - 有術語的兩個沒有講者，而且會改寫內容或吐出提示詞（docs/research/2026-10-21-litellm.md）。
  - LiteLLM 加上 MAI-Transcribe 2，並用 `eval/` 驗證通過後再改。
- 後果：使用 `start:litellm` 時，轉錄仍需要 OpenRouter 金鑰，音訊仍送到 OpenRouter ZDR。

## D-023 逐字稿預設精簡顯示，只在介面去掉語助詞

- 日期：2026-10-21。狀態：採用（使用者要求）。
- 決策：逐字稿分頁加上「精簡顯示」，預設開啟，設定記在瀏覽器的 `localStorage`。
  - 刪掉所有「呃」。
  - 「嗯、欸、哦、喔、啊」只在句首或標點後面、單獨出現時刪掉；跟在詞後面的語尾（對啊、好啊、等一下哦）保留。
  - 去掉後沒有內容的段落隱藏，但段落編號不變，摘要的引用 `[n]` 與跳轉照常可用。
  - 只影響顯示。存下來的 `text`、`raw`、摘要的輸入、benchmark 都不變；勾「顯示原始辨識結果」時不精簡。
- 理由：使用者要和 Notion Meeting Notes 一樣好讀。一場 40 分鐘的會議有 477 段，其中 51 段只有語助詞、91 段夾著語助詞。D-006 不改寫逐字稿的原則不變：這裡用固定規則在顯示時處理，不呼叫 LLM。
- 不採用：
  - 在轉錄或校對時刪除，會違反 D-006，也無法還原。
  - 請 Azure 移除不流暢的語音，OpenRouter 是否傳遞這類選項未經驗證。
- 後果：「對。」「OK。」這類附和仍然顯示；重複的詞（「所以所以所以」）不處理。

## D-024 團隊知識檔 `knowledge.json`，所有 Agent 的摘要都帶入

- 日期：2026-10-21。狀態：採用（使用者要求）。
- 決策：`DATA_DIR/knowledge.json` 存團隊背景知識，手動編輯，不進 git。每次產生摘要時，不論選哪個 Agent，都把它加進 system prompt，並註明「是背景知識，不是會議內容」。格式：

  ```json
  {
    "glossary": [{ "term": "EKS", "meaning": "AWS 的 Kubernetes 服務", "aliases": ["EKS cluster", "常見誤聽"] }],
    "notes": ["一句話的團隊流程或慣例"]
  }
  ```

  - `term` 必填；`meaning`、`aliases` 可省略。`aliases` 放別名與常見誤聽，讓摘要能把逐字稿裡聽錯的寫法還原。
  - 檔案不存在時不帶入；JSON 格式錯誤時在終端機印警告並略過，不讓摘要失敗。
- 理由：團隊術語（D-020）只告訴轉錄與校對「怎麼拼」，摘要模型仍不知道縮寫代表什麼（例如 SPC、DRI、SEG）。用 JSON 是因為不需要新增依賴，其他工具也能直接讀。
- 不採用：
  - 放進 repo：repo 是公開的，團隊知識屬於內部資料。
  - 只放在個別 Agent 的 system prompt：每個 Agent 都要重複維護。
- 後果：
  - 知識檔越長，每次摘要的輸入 token 越多。目前約 2,400 字元。
  - 誤聽對照只影響摘要。逐字稿仍靠團隊術語與術語校對修正。
