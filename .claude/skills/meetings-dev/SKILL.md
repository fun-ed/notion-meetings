---
name: meetings-dev
description: Develop, fix, or maintain the notion-meetings app (server.js routes and pipeline, auth.js accounts and permissions, ai.js models and agents, public/index.html UI, keys). Use before changing code here, when a transcript, summary, permission or login looks wrong, or when a provider, model ID, agent, or key changes.
---

# notion-meetings 開發與維護

決策是這個專案的地基。先讀 `docs/decisions.md` 裡和這次改動相關的決策，在既有決策之內做改動。如果改動必須推翻某項決策，就停下來先和使用者確認，再新增一筆決策。

## 步驟

1. **定位。** 讀 `docs/architecture.md`，找出這次改動會碰到的流程階段（transcribing、correcting、summarizing）、`meeting.json` 欄位、API 路由與所需權限（`permOf`：none／view／comment／edit／owner）。完成條件：能說出要改哪幾個函式，以及哪些呼叫端和測試會受影響。
2. **改動。** 照 `server.js` 現有的寫法：寫入一律走 `update()`，它會讓同一場會議的寫入排隊；要依現有內容計算的改動用 `update(id, cur => ({...}))`，不要先 `load()` 再傳結果；有已知限制的捷徑要加 `shortcut:` 註解；PATCH 只接受白名單欄位。
3. **單元測試。** `mise exec -- npm test`。新邏輯要在 `server.test.js` 加一個小測試；打 API 的測試用 `client()`（各自的 cookie jar）以 admin、member、readonly 身分呼叫，新路由要測到權限不足時的 403／404。測試把 `OPENROUTER_API_KEY` 設成空字串，絕不呼叫真的轉錄或 Claude API。完成條件：全部 pass。
4. **回歸測試。** 改到轉錄、OpenCC、校對或摘要時，一定要跑：

   ```bash
   T=$(mktemp -d) && ./eval/make-testset.sh "$T"
   PORT=3919 DATA_DIR=$(mktemp -d) mise exec -- npm run start:magpie &
   mise exec -- python3 -I eval/e2e.py http://127.0.0.1:3919 "$T"   # exit 0 才算過
   ```

   `e2e.py` 會在空的 `DATA_DIR` 自動建立第一個帳號並登入；對既有資料要設 `E2E_USER`／`E2E_PASS`。完成條件：兩行都是 PASS。再讀一遍嚴苛音檔的逐字稿和摘要，確認沒有出現原文沒有的數字或句子，因為分數抓不到編造。跑完用 `lsof -ti tcp:3919 -sTCP:LISTEN | xargs kill` 關掉伺服器（不要用 `pkill -f "node server.js"`，會連 Camofox 一起關掉），再刪掉暫存資料夾。只改介面時，用瀏覽器（例如 Camofox 或 agent-browser）登入後實際操作，並至少用一個非擁有者帳號確認權限鎖定是否正確；亮色、暗色都要看。
5. **更新文件。** 資料欄位或路由變了就改 `docs/architecture.md`；完成了 `docs/plans/2026-10-20-roadmap.md` 的項目就刪掉那一項；決策變了就在 `docs/decisions.md` 新增一筆；在 `CHANGELOG.md` 記下這次的新增與驗證結果；README 用到的 3 張截圖（`meeting.png`、`transcript-dark.png`、`action-items.png`）畫面變了就重拍，用 `eval/` 的合成資料與虛構帳號。完成條件：文件描述和程式碼一致。

## 不變的規則

- 逐字稿保留說話者原本的用詞和語氣。校對只修術語表裡的詞，不確定就標【?】；`raw` 一定要保存。台灣口吻只出現在摘要。
- 音訊只送 ZDR 端點（`provider.zdr: true`）。伺服器只綁 `127.0.0.1`。瀏覽器即時字幕預設關閉，只能用本機辨識（`processLocally`），不能改用雲端（D-019）。
- 金鑰只從環境變數、`~/.config/<服務>/key`，或後台輸入後存在 `DATA_DIR/secrets.json`（權限 600）的 key 讀取。不寫進專案、不印出，也不從任何 API 回傳（只回 `keyStatus` 末四碼，D-021）。
- LLM 一律經 `llm()` 呼叫，不要直接用 Anthropic SDK 或 fetch；用量、費用與重試都由它處理。公司 LiteLLM 用 `npm run start:litellm`（D-022），端點網址與 key 只放在 `~/.config/litellm/`，不寫進 repo、文件或測試。
- 時間一律 GMT+8：伺服器用 `nowIso()`／`localDay()`，介面用 `dt()`／`day()`；不要直接寫 `new Date().toISOString()` 或沒有 `timeZone` 的 `toLocaleString()`。
- 會議資料夾一律經 `dir(id)`／`meetingIds()`（`data/<日期>/<id>/`），不要自己拼 `DATA/id`。
- 每個新 API 都先決定需要的權限，在伺服器端檢查（`need(can(...))`）；看不到的會議回 404。介面的鎖定只是輔助。
- 帳號、名錄、模型設定都在 `data/`（不進 git）；真實名單與錄音不能出現在 repo 或截圖裡。
- 摘要一律保留必備段落與 `- [ ] 事項 — 負責人 [n]` 格式，Agent 提示只能增加段落，否則 Action Items 解析不到。
- 學習迴圈（D-020）：只學使用者確認過的內容。講者建議只是建議，程式不能自動改名；候選名字只能來自參與者、名錄人員與 Y leader。轉錄流程一律走 `transcribeClean()`，正式處理與 benchmark 共用同一份程式；`data/learned.json` 只能經 `learned.mutate()` 修改。
- 改到轉錄、術語、校對或講者建議時，除了 `eval/e2e.py`，若有凍結的 benchmark 會議，也要在管理後台執行一次 benchmark，分數不能下降。

## 建置與發版

使用者要求發版時照順序做。每一步的完成條件都要達到，才能做下一步。

1. **升版與紀錄。** `package.json` 升版：功能用 minor，修正用 patch。`CHANGELOG.md` 新增「## x.y.z（日期，GMT+8）」，寫明新增內容與驗證結果。已經推送的 tag 不要移動，有問題就再升一個 patch。
2. **原始碼測試。** `mise exec -- npm test` 全過。
3. **確認 Bun 是正式版。** 執行 `bun --revision`。版本含 `canary` 時無法交叉編譯，會出現 `Target platform ... is not available for download`。這時改用正式版建置，而且不要改動 mise 的安裝：

   ```bash
   B=$(mktemp -d) && cd "$B" && v=1.4.3   # 用 oven-sh/bun 最新的正式版
   curl -fsSLO https://github.com/oven-sh/bun/releases/download/bun-v$v/bun-darwin-aarch64.zip
   curl -fsSLO https://github.com/oven-sh/bun/releases/download/bun-v$v/SHASUMS256.txt
   grep " bun-darwin-aarch64.zip$" SHASUMS256.txt | shasum -a 256 -c && unzip -q bun-darwin-aarch64.zip
   ```

4. **建置。** `mise exec -- bash -c 'PATH="<bun 目錄>:$PATH"; bash scripts/build.sh'`；Bun 本來就是正式版時，直接 `mise exec -- npm run build`。完成條件：`dist/` 有 5 個執行檔與 `SHA256SUMS`，`file dist/*` 的架構和檔名相符。
5. **執行檔測試。** 至少測本機平台的執行檔：

   ```bash
   T=$(mktemp -d) && ./eval/make-testset.sh "$T"
   ANTHROPIC_BASE_URL=http://127.0.0.1:3425 ANTHROPIC_API_KEY=magpie \
     mise exec -- bash scripts/smoke-binary.sh dist/notion-meetings-v<版本>-darwin-arm64 "$T"
   ```

   `smoke-binary.sh` 會用空的暫存 `DATA_DIR` 啟動執行檔。它檢查啟動訊息與 `/api/auth/me` 的版本、內嵌介面是否等於 `public/index.html`，接著跑 `eval/e2e.py`，結束後關掉執行檔並刪除暫存資料。完成條件：三行都是 PASS（啟動、乾淨音檔、嚴苛音檔）。其他平台的執行檔沒有實際執行，要在 CHANGELOG 寫明。
6. **介面測試。** 用執行檔或新啟動的伺服器，在瀏覽器（Camofox）以虛構帳號登入，確認：
   - 側欄左下角顯示 `notion-meetings v<版本>` 和 repo 網址。
   - 這次改到的畫面，亮色、暗色都正常。
   - 非擁有者帳號的權限鎖定正確。

   完成條件：README 的 3 張截圖如果畫面有變，用合成資料重拍。只改了介面又沒有重啟伺服器時，頁面會拿到新介面，`/api/auth/me` 卻還是舊的；介面必須能處理缺少的欄位，不能卡在登入頁。
7. **文件。** 更新 README（英文 `README.md`、繁中 `README.zh-TW.md` 兩份一起改）、`docs/plans/` 的計畫，決策有變就更新。
8. **commit、tag、push。** 先 `gwho` 確認 Git 身分，再 commit、打 `v<版本>` annotated tag，一起推送。完成條件：`git ls-remote --tags origin` 看得到新 tag。
9. **GitHub Release。** Release 會公開執行檔，要先得到使用者同意。

   ```bash
   gh release create v<版本> dist/* --title v<版本> --notes-file <CHANGELOG 該版段落>
   ```

   不要標成 prerelease，因為側欄的「⬆ 有新版」讀的是 latest release。發佈後下載一個資產，用 `SHA256SUMS` 核對；再用舊版開一次側欄，確認會出現「⬆ 有新版」。

## 例行維護

| 時機 | 做法 |
|---|---|
| 換金鑰或金鑰外洩 | 到服務商後台撤銷舊金鑰，請使用者照 README 的指令存新金鑰。OpenRouter 每次轉錄都重讀金鑰，不必重啟 |
| 摘要模型改名或下架 | 「管理後台 › 模型」改 Model ID 並按「測試」；轉錄模型 `microsoft/mai-transcribe-2` 改在 `server.js`。兩者都跑回歸測試並新增決策 |
| 每季，或出現新的轉錄模型 | 用 `stt-research` 重新評測 |
| 更新套件 | `mise exec -- npm outdated`，更新後跑單元測試與回歸測試 |
| 備份 | 複製整個 `data/`（或 `DATA_DIR`） |

## 疑難排解

| 現象 | 先檢查 |
|---|---|
| `OPENROUTER_API_KEY 未設定` | `~/.config/openrouter/key` 是否存在，以及環境變數是不是被設成空字串 |
| `OpenRouter 413` | 會議太長，見 `docs/plans/2026-10-20-roadmap.md` 的長會議分段 |
| 一直回到登入頁 | 伺服器重啟過（session 在記憶體）；或 cookie 被擋，確認用 `http://localhost` 開 |
| 忘記管理員密碼 | 另一位管理員重設；只有一位時，停伺服器後從 `data/auth.json` 移除該帳號再註冊 |
| 摘要報「超過 context window」 | 管理後台的模型 context window／輸出上限設定，或逐字稿太長（見 plan 的長會議分段） |
| Agent 的 skill 載入失敗 | 路徑必須是 `.md`、檔案存在；URL 要在 5 秒內回應 |
| 校對或摘要失敗、連線被拒 | magpie 有沒有開：`curl -s http://127.0.0.1:3425/v1/models -H 'Authorization: Bearer magpie'` |
| 逐字稿是簡體 | 會議的 `lang` 是不是 `zh-CN`，或自動偵測沒判斷成中文 |
| 術語沒有被修正 | 這場會議的 `glossary` 有沒有內容；改完術語要按「用目前的術語重新轉錄」 |
| `ffmpeg` 錯誤 | `which ffmpeg`；上傳檔可能損壞 |

換轉錄模型或服務商前，先用 `stt-research` skill 評測。
