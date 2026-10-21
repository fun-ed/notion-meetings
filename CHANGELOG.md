# 變更紀錄

每一版列出新增內容與當時的驗證結果；版本號在 `package.json`，時間一律是台灣時間（GMT+8）。決策理由在 [docs/decisions.md](docs/decisions.md)，評測數據在 [docs/research/](docs/research/)。

## 未發版

### 新增

- **逐字稿精簡顯示**（D-023）：預設隱藏呃、嗯、欸等語助詞，只有語助詞的段落不顯示；段落編號與存檔內容不變，可以關閉。
- **啟動時檢查 LLM 金鑰**：用 `npm run start` 啟動、預設模型拿不到金鑰時，終端機會印出警告，提示改用 `start:magpie` 或 `start:litellm`。以前要等到摘要失敗才會發現。

### 驗證

- `npm test` 23 項全過。新增：啟動警告的三種啟動方式，以及精簡顯示的規則。
- 實際啟動：沒有 LLM 環境變數時印出警告，設定 magpie 的環境變數時不印。
- 精簡顯示套用在一場 40 分鐘的真實會議：477 段中隱藏 51 段、精簡 91 段。

## 0.6.1（2026-10-21）

依 v0.6.0 的外部 review 修正（[docs/plans/2026-10-21-next-steps.md](docs/plans/2026-10-21-next-steps.md)）。

### 修正

- **重疊的輸出片段被重複計算**：兩個標籤蓋同樣 5 秒時，漏掉的語音算成 0%（應為 50%）；同一個標籤重複兩段時，正確率算成 200%。改成先把時間軸切成互不重疊的時間片再累加，正確率不會超過 100%。
- **`start:litellm` 可能沿用舊 key**：後台曾替「沒填 Endpoint 的 OpenAI 模型」存過 key 時，會把那把 key 送到公司 LiteLLM。現在 `LLM_PROVIDER=openai` 而且模型沒有自己的 Endpoint 時，一律用啟動時的 key。
- **空的 LLM 回應被當成成功**：OpenAI 相容端點回傳空內容或沒有 `choices` 時，摘要會空白卻顯示完成。現在空回應視為暫時性錯誤並重試，最後仍失敗就讓會議顯示失敗；Anthropic 路徑也一樣。

### 新增

- **benchmark 整體分數依時長加權**：各場的講者正確率與 CER 依參考語音時長加權，長會議的份量較重。
- **更完整的設定指紋**：加入校對的 effort、端點主機雜湊、校對提示雜湊、每場會議術語雜湊；只存雜湊，不存 key 或完整網址。
- **GitHub Actions（手動觸發）**：在 Actions 頁面按 Run workflow，或執行 `gh workflow run ci.yml`。會跑單元測試、用 Bun 1.4.3 建置 5 個平台、核對 `SHA256SUMS`，並實際啟動 Linux x64 執行檔確認版本與內嵌介面。推送時不會自動執行；不放任何憑證，真 API 的回歸測試仍在本機手動執行。

### 驗證

- `npm test` 21 項全過。新增：重疊與重複片段的計分、`start:litellm` 的金鑰順序、空回應的重試（先 503、再空內容、第三次成功）。測試的重試間隔縮短，整體從約 2 秒變成 0.7 秒。
- 執行檔：5 個平台用官方 Bun 1.4.3 建置；`scripts/smoke-binary.sh` 測 macOS arm64，三行 PASS（乾淨 45/45、嚴苛 42/45、講者 9/9）。其他 4 個平台沒有實際執行；CI 的 Linux x64 啟動檢查要手動觸發後才會跑。
- 發版後補測：
  - `npm run start:litellm` 接公司 LiteLLM，先在後台故意存一把錯的舊 key，Opus 的連線測試仍用啟動時的正確 key 回 OK；`eval/e2e.py` 乾淨 45/45、嚴苛 42/45、講者 9/9，兩項 PASS。
  - 手動觸發 CI（`gh workflow run ci.yml`）：單元測試、5 個平台建置、`SHA256SUMS` 核對、Linux x64 執行檔啟動全部成功。

## 0.6.0（2026-10-21）

公司 LiteLLM 實測與一鍵切換（D-022，報告見 [docs/research/2026-10-21-litellm.md](docs/research/2026-10-21-litellm.md)）。

### 新增

- **`npm run start:litellm`**：從 `~/.config/litellm/base_url`、`~/.config/litellm/key` 讀端點與 key，所有內建模型（含 Claude）的校對、摘要、講者建議都經公司 LiteLLM。端點與 key 不進 repo。執行檔改設 `LLM_PROVIDER=openai`、`OPENAI_BASE_URL`、`OPENAI_API_KEY`。
- **記錄 LiteLLM 的實際費用**：`x-litellm-response-cost` 記進每次呼叫的用量；會議頁與後台的費用欄不再只限轉錄。
- 預設仍用 magpie（`npm run start:magpie`）。內建 GPT 模型 ID 維持 magpie 的名稱（`codex/gpt-6.1-sol`、`codex/gpt-6-luna`）；`start:litellm` 會自動去掉 `codex/` 這類前綴，換成 LiteLLM 的名稱，不用手動修改。上限依 LiteLLM 的 `/model/info` 改成 1.05M／64K。
- README（英文、繁中）新增「改用公司 LiteLLM」的步驟與「模型搭配」表：每個模型在 magpie 與 LiteLLM 的 ID、適合的用途與實測結果。

### 修正

- **benchmark 的講者正確率會高估**（外部 review 指出）：原本只要重疊最多的輸出段配對正確，就把整段參考時長算成正確；例如 10 秒的發言只被輸出覆蓋 1 秒，也算 100%。現在只計實際重疊而且配對正確的時間，另外列出漏掉的語音比例；跨越 15 分鐘邊界的發言會拆開計算；講者配對改用匈牙利演算法，取整體最佳的一對一組合。之前算出的真實錄音「講者 100%」作廢。
- 模型連線測試第一次失敗、重試成功時，顯示的是失敗那次的用量；改成顯示最後一次。

### 驗證

- `npm test` 20 項全過。新增：`LLM_PROVIDER` 的切換規則、費用標頭的記錄。
- 公司 LiteLLM：
  - 232 個模型；Opus／Sonnet 5.5、gpt-6.1-sol、gpt-6-luna 都能呼叫，也都接受 `reasoning_effort`。
  - 沒有 gateway 注入的提示；`/model/info` 可以取得上限。
- `npm run start:litellm` 不改任何設定跑 `eval/e2e.py`：乾淨 45/45、嚴苛 42/45、講者 9/9；每場都記到實際費用。
- 轉錄模型（`gpt-4o-transcribe-diarize`、`gpt-4o-transcribe`、`whisper-1`）都不達標，轉錄維持 OpenRouter。
- 啟動腳本確認不會把 key 印出。
- 執行檔：5 個平台用官方 Bun 1.4.3 建置；`scripts/smoke-binary.sh` 測 macOS arm64，三行 PASS（乾淨 45/45、嚴苛 42/45、講者 9/9）。其他 4 個平台沒有實際執行。
- benchmark：新增測試涵蓋「1 秒覆蓋 10 秒發言＝10%」「跨視窗拆開」「最佳配對優於貪婪配對（61.1% 對 38.9%）」；每次執行記錄設定指紋，後台顯示。
- [benchmark 標準](docs/research/2026-10-21-benchmark-standards.md) 新增「各設定的準確度總表」。
- 文件同步：架構文件更新講者計分與設定指紋；`meetings-dev`、`stt-research` skill 補上新的計分規則、準確度總表與 LiteLLM 轉錄的評測方式；`CLAUDE.md` 與 README 指向計畫總覽與準確度總表。

## 0.5.0（2026-10-21）

LLM 改用使用者設定的端點，以 OpenAI 相容為主（D-021，計畫見 [docs/plans/2026-10-21-llm-endpoints.md](docs/plans/2026-10-21-llm-endpoints.md)）。

### 新增

- **OpenAI 相容端點**：模型的 provider 選「OpenAI 相容（LiteLLM）」，就經 `/chat/completions` 呼叫公司 LiteLLM、magpie 或 OpenAI。用量的 tokens、快取讀取與耗時都會記錄。
- **LLM Endpoint 與 API key**：每個模型可以在管理後台設定 Endpoint 與 API key。key 只存在本機 `data/secrets.json`（權限 600），同一個 Endpoint 的模型共用，介面只顯示末四碼；也可以改用環境變數。
- **讀取模型**：從端點的 `GET /models` 列出模型 ID 讓管理員挑選。
- **gpt-6.1-sol、gpt-6-luna**：內建設定，預設停用。`npm run start:magpie` 會同時設定 `OPENAI_BASE_URL`、`OPENAI_API_KEY` 指向 magpie。
- **各用途的模型**：術語校對與講者建議可以各自指定模型，摘要依會議的 Agent。
- **自動重試**：LLM 遇到 429、5xx、串流截斷等暫時性錯誤時，自動重試 2 次。0.4.0 截圖時遇到的摘要失敗就是這種錯誤。

### 驗證

- `npm test` 20 項全過。新增：
  - 用量換算、暫時性錯誤判斷、Endpoint 對應的 key、各用途的模型選擇。
  - 用假的 OpenAI 相容伺服器實測：API key 不會出現在任何回應裡、`secrets.json` 的權限是 600、讀取模型清單、送出存起來的 key、遇到 503 會重試一次後成功。
- magpie 實測：
  - 讀到 86 個模型。sol 與 luna 的連線測試都回 OK（2.3 秒、1.5 秒）。
  - 用 `eval/e2e.py` 讓整條流程改用 OpenAI 模型：
    - 校對 luna、摘要 sol：乾淨 44/45、嚴苛 39/45，FAIL。
    - 校對與摘要都用 sol：乾淨 45/45、嚴苛 42/45，PASS；校對 10～13 秒、摘要約 15 秒。
  - 逐句檢查嚴苛音檔：sol 把「Postres」直接改成術語表裡的 Postgres（原文是 OAuth），沒有標【?】。詳見 [docs/research/2026-10-21-openai-models.md](docs/research/2026-10-21-openai-models.md)。預設模型維持 Opus 5.5。
- 執行檔：5 個平台用官方 Bun 1.4.3 建置；`scripts/smoke-binary.sh` 測 macOS arm64，三行 PASS（乾淨 45/45、嚴苛 43/45、講者 9/9）。其他 4 個平台沒有實際執行。
- README 的 3 張截圖用虛構名字重拍；README 沒用到的 15 張舊截圖已從 repo 移除。管理後台的模型表格用 Camofox 確認顯示正常。

## 0.4.0（2026-10-21）

學習迴圈 P1～P3（D-020，設計見 [docs/plans/2026-10-21-learning-loop.md](docs/plans/2026-10-21-learning-loop.md)）。

### 新增

- **團隊術語**：會議的術語自動累積成團隊術語，之後每場轉錄都併入 MAI 術語清單與 Claude 校對。逐字稿分頁可以「加入團隊術語」；管理後台「學習」區塊可以新增、停用、刪除。
- **文字系統檢查**：中文會議的逐字稿出現韓文或日文假名時（MAI 偶爾把 platform 聽成「플랫폼」），自動標【?】。
- **講者建議**：摘要時另外請 Claude 依點名線索（「謝謝 X」「還給 X」「X 這張」）建議匿名講者是誰。只能用參與者、名錄人員與 Y leader 的名字，附上依據的行號，按「套用」才改名。
- **Benchmark**：擁有者把校正好的會議「凍結為 benchmark」。管理員在後台執行時，會用目前的設定重跑每場凍結的會議，計算時間加權的講者正確率、每 15 分鐘的講者漂移、CER、術語命中與【?】數量，並保留歷次結果。

### 文件

- [docs/research/2026-10-21-benchmark-standards.md](docs/research/2026-10-21-benchmark-standards.md)：驗收標準、benchmark 指標定義，以及已測過的錄音長度、人數、語言與模型。
- [docs/plans/2026-10-21-llm-endpoints.md](docs/plans/2026-10-21-llm-endpoints.md)：下一步計畫。讓使用者自行設定 OpenAI 相容端點與 API key（LiteLLM 為主），並適配 gpt-6.1-sol、gpt-6-luna；已實測 magpie 上兩個模型可以呼叫。

### 驗證

- `npm test` 18 項全過。新增：術語合併、文字系統偵測、講者建議清理、CER、講者正確率（含漂移）、術語命中，以及學習 API 的權限與 benchmark 前置條件。
- 三段內部會議錄音（站立會議 18 分、DRI 交接 13 分、架構討論 11 分；內容不進 repo）：
  - 站立會議不填會議術語，只靠團隊術語，Bastion、cron job、Istio、EKS、runbook、GoAlert 都直接聽對；架構會議的韓文被標【?】。
  - 三場都產生講者建議，並附依據行號。發現「Ken 大大」被硬配成 Kenny 後，修正候選名單與規則，再跑一次就不再出現這個錯誤建議。
  - 凍結三場後執行 benchmark：2 分 47 秒、$0.071。參考答案未經人工校正，講者 100%、CER 0，只代表重跑穩定。
  - Camofox：按「套用」後講者改名、建議消失；管理後台列出團隊術語與 benchmark。
- 5 個平台的執行檔用官方 Bun 1.4.3 建置。`scripts/smoke-binary.sh` 測 macOS arm64：啟動、版本、內嵌介面 PASS；跑了兩次（第二次是改掉文件裡的真實人名、重新建置之後），乾淨都是 45/45；嚴苛分別是 42/45 與 40/45，第二次剛好壓在門檻 40，漏的術語每次不同（OAuth、refresh token、CI；node group、threshold、OAuth、勞退、自提）。兩次都 0 簡體、講者 9/9。其他 4 個平台沒有實際執行。
- 移除文件、測試資料與介面範例中的真實人名，改成虛構名字。之前已推送的 0.2.0～0.3.x commit 仍含有這些名字。
- 重拍 README 的會議頁與逐字稿截圖（合成資料）時，嚴苛音檔的摘要遇到 magpie 回報上游串流被截斷，整場變成失敗；重新產生摘要後恢復。自動重試已列入 reliability 計畫。

## 0.3.2（2026-10-21）

依外部程式碼 review 修正三項，其餘排入 [docs/plans/2026-10-21-reliability.md](docs/plans/2026-10-21-reliability.md)。

### 修正

- **即時字幕的隱私**（D-019，取代 D-009）：錄音時原本會自動啟動瀏覽器語音辨識，Chrome 預設把音訊送到雲端，違反 D-008 的 ZDR 邊界。現在預設關閉，勾選才啟用；只用本機辨識（`processLocally`），必要時下載本機語言包；不能在本機辨識就不顯示，不改用雲端。
- **同一場會議的並行寫入**：`update()` 改為每場會議排隊執行，暫存檔名每次不同。留言、AI 用量、分享授權、段落講者改用函式 patch，在佇列裡依最新內容計算，不再先讀檔再寫入。
- **講者評分**：`eval/e2e.py` 原本只要求三種聲音的多數標籤不同（`voices_separated`），講者中途飄掉也會 PASS。現在還要求 `spk_consistent` 全對。

### 驗證

- `npm test` 17 項全過。新增並行寫入測試：同時送 20 則留言和兩個不同欄位的 PATCH，全部保留，也沒有殘留暫存檔；這個測試在舊程式上會失敗。
- 講者評分：以一個聲音在第 3 句飄到另一個標籤的例子確認，`voices_separated` 仍是 2/2，`spk_consistent` 是 2/3，新條件會判 FAIL。
- 回歸測試（原始碼、magpie）：乾淨 44/45、嚴苛 42/45、0 簡體、講者 9/9，兩項 PASS；摘要、待辦與 3 筆用量都經由佇列寫入。
- 即時字幕（Chromium 156，headless）：預設不勾選，勾選會記住。headless 無法取得麥克風權限，所以在頁面直接呼叫 `startCaptions()` 並模擬錄音狀態：未勾選時不建立辨識器；真實 Chrome 回報 `unavailable` 時只顯示說明、不啟動；替換成回報 `available` 的辨識器時以 `processLocally = true` 啟動；回報 `downloadable` 時先 `install()` 再啟動。沒有用實體麥克風在有本機語言包的 Chrome 上測過。

## 0.3.1（2026-10-21）

### 新增

- **版本與 repo 固定在側欄左下角**：顯示 `notion-meetings v<版本>`、`github.com/fun-ed/notion-meetings` 與「版本紀錄 →」；GitHub 有較新的 Release 時改成「⬆ 有新版」。
- **發版檢查腳本** `scripts/smoke-binary.sh`：用暫存資料夾啟動執行檔，檢查版本與內嵌介面，再跑 `eval/e2e.py`，結束後清掉暫存資料。`meetings-dev` skill 寫入完整的建置與發版測試步驟。
- **README 改版**：精簡成正式版，英文 `README.md` 與繁中 `README.zh-TW.md` 兩份，截圖只放 3 張（會議頁、逐字稿、Action Items），並用 0.3.1 重拍。詳細維護步驟移到 skills（`meetings-dev` 的例行維護、`stt-research` 的 DeepInfra 金鑰設定）。
- **計畫檔加上日期**：`docs/plan.md` 改名為 `docs/plans/2026-10-20-roadmap.md`；之後的計畫用 `docs/plans/YYYY-MM-DD-<主題>.md`。

### 修正

- 原始碼更新後，伺服器還沒重啟就重新整理頁面時，新介面拿不到 `/api/auth/me` 的版本資訊，登入後會卡在登入畫面。現在介面會略過版本區塊，照常登入。

### 驗證

- 用 0.2.1 的伺服器搭配新介面，重現使用者回報的情況。修正後登入會直接進到個人設定，側欄正常，只是沒有版本區塊。
- `npm test` 17 項全過。
- 5 個平台的執行檔都用官方 Bun 1.4.3 建置。用 `scripts/smoke-binary.sh` 測 macOS arm64 執行檔：啟動、版本、內嵌介面都 PASS；`e2e.py` 乾淨 45/45、嚴苛 44/45（漏 OAuth）、0 簡體、3/3 講者。其他 4 個平台沒有實際執行。
- Camofox：側欄左下角顯示版本、repo 網址與版本紀錄連結，位置貼齊視窗底部。
- 截圖用的執行檔又跑一次 `e2e.py`：乾淨 45/45、嚴苛 45/45，兩項 PASS；執行中的內嵌介面與 `public/index.html` 完全相同。

## 0.3.0（2026-10-21）

### 新增

- **校正講者**：點逐字稿段落的名字，可以把這一段或一整段範圍（Shift＋點另一段，或輸入「第 __ 到 __ 段」）改成其他講者、參與者或新的人；「併入…」把整個講者合併到另一位。
- **版本與 repo 連結**：側欄底部顯示 `notion-meetings v<版本>`，連到 GitHub repo 與 Releases；瀏覽器每次登入查一次 GitHub 最新 Release，比目前版本新就顯示「⬆ 有新版」（查不到時只顯示連結）。
- **手動參與者**：會議屬性的「參與者」可以加入沒發言的人，也能移除；參與者會帶出團隊與 Y leader，也會列進摘要提示。
- **摘要重新對齊**：改過講者或參與者後，摘要與 Action Items 上方提示「重新產生摘要」；重跑後待辦負責人與團隊用新的名字。
- **下拉選單與統一寫法**：個人設定的團隊、Y leader，會議的標籤與參與者，都會列出既有的值；大小寫或空白不同時改成既有的寫法，團隊成員與群組成員也一樣。

### 修正

- 會議頁的「AI 用量」明細表太寬時撐出版面；現在留在內容欄內，可以橫向捲動。

### 驗證

- `npm test` 17 項全過（新增 `reassignSpeakers`、參與者、`summaryStale` 測試）。
- Camofox（獨立的測試資料夾與虛構資料）：
  - 用量表在 1100 px 視窗內不再超出內容欄。
  - 把第 3 段改成名錄裡的 Ryan 後，參與者與團隊多出 Ryan／Platform team，並出現重新產生提示。
  - 「併入…」可以把 Ryan 併回 Leo；輸入 `kenny ` 存成 `Kenny`，標籤 `platform` 不會重複產生。
  - 個人設定：`platformteam`、`ann  lee`、`mia, LEO , ryan` 分別存成 `Platform team`、`Ann Lee`、`Mia, Leo, Ryan`。
- 實際用 Claude（magpie）重新產生摘要：把「我這週補 IRSA 權限」改給 Kenny 後，待辦負責人從 Leo 改成 Kenny（Platform team），`summaryStale` 清掉。
- `npm test` 17 項全過（另含 `/api/auth/me` 回傳版本與 repo）。
- 5 個平台的執行檔都用官方 Bun 1.4.3 建置（SHA256 驗證過）。本機 mise 的 Bun 是 canary（1.4.4-canary），canary 無法下載其他平台的執行環境，所以不用它交叉編譯。
- 用 macOS arm64 執行檔跑 `eval/e2e.py`：乾淨 45/45、嚴苛 45/45、0 簡體、3/3 講者，兩項 PASS。
- Camofox 操作執行檔：範圍選取（Shift＋點）把第 7～8 段一起改成阿哲；輸入段號可以擴大範圍，「取消」會關閉選取；側欄顯示 `notion-meetings v0.3.0`。
- 重拍 4 張 README 截圖：會議頁、逐字稿（暗色，含範圍選取）、AI 用量、個人設定。其他截圖沒有重拍，底部還沒有版本連結。

## 0.2.1（2026-10-21）

### 新增

- **單一執行檔**（D-017）：`npm run build` 用 `bun build --compile` 打包 macOS arm64／x64、Linux x64／arm64、Windows x64，產生 `dist/` 與 `SHA256SUMS`。介面內嵌在執行檔裡；執行檔的資料預設存在 `~/.notion-meetings`；啟動時印出版本與資料位置。

### 驗證

- 原始碼在 Bun 1.4.3 下直接執行：介面、註冊、上傳、錯誤處理、搜尋都正常。
- macOS arm64 執行檔（87 MB）從其他資料夾啟動：內嵌介面正常，資料寫到 `~/.notion-meetings/<日期>/<id>/`，14 個 Agent 都有載入。
- 用執行檔跑 `eval/e2e.py`：乾淨 45/45、嚴苛 43/45、0 簡體、3/3 講者，兩項都 PASS。
- `npm test` 16 項全過（Node 執行原始碼的行為不變）。

## 0.2.0（2026-10-21）

### 新增

- **Notion 風格介面**（D-010）：工作區側欄、「會議紀錄」資料庫表格、有屬性欄的會議頁、AI 會議筆記區塊（摘要／筆記／逐字稿分頁）。
- **Action Items**：從摘要的待辦行解析成 `actions`，可勾選並與會議頁同步；預設依會議分組、可收合，也能依團隊、負責人、Y leader 分組，並用文字、標籤、團隊、Y leader 篩選。
- **會議屬性與搜尋**（D-011）：時間、地點、摘要、標籤；伺服器端搜尋支援多關鍵字 AND、簡繁互通，以及 `tag:` `who:` `team:` `leader:` `group:` `type:` `after:` `before:` 與片語；逐字稿結果可跳到該句。⌘K／Ctrl+K 開啟。
- **播放**：倒退／快轉 10 秒、1×／1.2×／1.5×／2× 速度（會記住），逐字稿依播放位置以藍框標示並自動捲動。
- **成員與團隊**（D-012）：CSV 名錄、講者與待辦負責人自動對應團隊與 Y leader（含自由文字負責人），講者改名時會自動提示名錄裡的名字。
- **帳號與權限**（D-013）：
  - 登入、登出；第一個帳號是管理員；管理員、成員、唯讀三種角色。
  - 會議權限分為私人、檢視、留言、編輯。
  - 需登入、可撤銷的分享連結；會議留言。
  - 個人資料：團隊、Y leader、成員、常合作群組，會合併進名錄。
  - 管理後台：註冊開關、角色、重設密碼、分享連結。
- **模型與 Agent**（D-014）：
  - 管理後台可設定模型：endpoint、API key 環境變數、context window、輸出上限、effort、附加提示，並可做連線測試。
  - 內建 14 個會議 Agent，可開關、自訂、指定模型與 effort、掛 SKILL.md。
  - 每場會議可選 Agent，摘要會註記是哪個 Agent、模型與 effort 產生的。
  - 送出前會檢查內容是否超過 context window。
- **亮色／暗色模式**。
- **時間一律 GMT+8**（D-016）：日期資料夾、依日期統計、預約時間都以 Asia/Taipei 計算；新寫入的時間戳記帶 `+08:00`；介面所有日期時間固定顯示台灣時間（24 小時制），不受瀏覽器或伺服器時區影響。
- **錄音依日期分資料夾**：`data/<上傳日期>/<id>/`，以 id 查找；舊的 `data/<id>/` 在啟動時自動搬移。
- **AI 用量紀錄**：每次轉錄（音訊秒數、OpenRouter 實際費用）、術語校對、摘要、連線測試（輸入、輸出、快取讀寫 tokens、模型、effort、耗時，失敗也記）寫入 `meeting.usage`；會議頁顯示明細，管理後台依項目、模型、日期彙總。
- **側欄可縮放**：拖曳右緣調整寬度（180～480 px，雙擊恢復 240）、「«」或 ⌘\ 收合；整個介面固定貼齊視窗，高度一定鋪滿（修正部分瀏覽器 `100vh` 算得比視窗短，下方留白的問題）。

### 驗證

- `npm test`：14 項全過。
  - 純函式：待辦解析、屬性驗證、查詢解析、搜尋排序與篩選、名錄解析與對應、模型與 Agent 選擇、context window 檢查、skill 讀取。
  - 整合測試：帳號、角色、權限、留言、分享連結與撤銷、重設密碼、登入鎖定、跨來源拒絕、個人資料合併、模型與 Agent 管理 API。
- `eval/e2e.py` 回歸（已改成先登入）：乾淨 45/45、嚴苛 43/45（漏「勞退」「自提」）、0 簡體、3/3 講者，通過門檻。
- Camofox 實際操作：
  - **登入與角色**：以管理員和成員兩個帳號登入；成員在「留言」權限的會議中，標題鎖住、「重新轉錄」隱藏、待辦不能勾，但可以留言。
  - **分享連結**：讓成員從「檢視」升為「編輯」。
  - **暗色模式、搜尋、播放同步**：搜尋時簡體「延迟」可以找到繁體「延遲」；切到 1.5 倍速並跳到 33 秒時，第 5 段亮起。
  - **Agent 摘要**：Opus 連線測試回應「OK」，約 2.8 秒。把會議改成「AWS EKS 升級」Agent（Sonnet 5.5）並掛 SKILL.md 後，摘要多了「升級計畫」「Skill 檢查」，沒討論到的項目標成「未討論」。
- 側欄：Camofox 在 1000×1300 視窗中，側欄與主內容高度都是 1300；拖曳到 330 px 後放開即停止跟隨；收合、重新整理後仍收合，⌘\ 展開，雙擊右緣恢復 240 px。
- 用量：實際跑一場（含校對）記到 轉錄 70 秒音訊 $0.0019、校對與摘要的 tokens 與耗時，連線測試也有紀錄；後台彙總 4 次、42.2 秒。發現 magpie 會自動快取，`input_tokens` 只有 2，所以介面改以「總輸入＝輸入＋快取讀＋快取寫」呈現。
- 資料夾：新會議存在 `data/2026-10-21/<id>/`；測試涵蓋舊資料夾搬移後仍可用 id 讀取。實際資料搬移前已完整備份到 `~/temp/notion-meetings-data-backup-20261021071346`。
- `npm test` 16 項全過（含 GMT+8：UTC 17:44 算成台北隔天、`+08:00` 與舊 `Z` 時間戳記一起正確排序）。
- 18 張 README 截圖全部以 0.2.0 重拍（Camofox，合成資料與虛構帳號）。
- **已知限制**：magpie 不會轉送 Anthropic MCP connector 的 `mcp_servers`，實測請求被默默丟掉，所以 remote MCP 尚未支援（docs/plans/2026-10-20-roadmap.md）。

## 0.1.0（2026-10-20）

### 新增

- 本機復刻 Notion AI Meeting Notes：錄音或上傳、分講者逐字稿、Claude 摘要（範本、自訂指示、輸出語言、`[n]` 引用）、手寫筆記、錄音下載。
- 轉錄流程（D-003～D-006）：OpenRouter `microsoft/mai-transcribe-2`（ZDR、分講者、術語清單），接著用 OpenCC `s2twp` 轉成台灣繁體，再由 Claude 只修術語、不確定處標【?】，並保留原始辨識結果。
- `eval/` 評測工具、決策與架構文件、`meetings-dev` 與 `stt-research` skills、Serena 記憶。

### 驗證

- 轉錄模型實測（docs/research/2026-10-20-stt-evaluation.md）：只有「MAI＋術語＋OpenCC＋嚴格校對」的組合達到台灣繁中加術語的基準。
- 回歸測試：乾淨 45/45、嚴苛 44～45/45、0 簡體、3/3 講者。
