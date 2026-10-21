# LLM 端點計畫：OpenAI 相容（LiteLLM 為主），適配 gpt-6.1-sol、gpt-6-luna（2026-10-21）

目標：
- 每位使用者可以在自己的 Mac 上設定 LLM 端點與 API key。主要路徑是 OpenAI 相容的 `/v1/chat/completions`，以公司的 LiteLLM proxy 為首要對象；magpie、OpenAI 官方 API 也走同一條路徑。
- 校對、摘要與講者建議可以使用這些端點上的任何模型，第一批適配 gpt-6.1-sol、gpt-6-luna。
- 依實測結果，決定每個用途的預設模型。

轉錄仍用 MAI-Transcribe 2（OpenRouter），不在這份計畫的範圍。

狀態：O1、O1b、O2 已在 0.5.0 實作（D-021），O3 完成合成測試部分（[評測](../research/2026-10-21-openai-models.md)）。

實作時的調整：
- 沒有另外做「端點」設定，而是沿用每個模型的 Endpoint 欄位。API key 依 Endpoint 存，所以同一個 LiteLLM 的模型共用同一把 key。
- 舊設定不需要轉換。

還沒做：
- 用公司 LiteLLM 實測（需要端點與 key）。
- 用三段真實錄音比較摘要與講者建議。

## 現況實測（2026-10-21，magpie）

- magpie 的 `/v1/models` 有 `codex/`、`copilot/`、`devin/` 三種前綴的 `gpt-6.1-sol`、`gpt-6-luna`（另有 `gpt-6-sol`、`gpt-6-astra`）。
- `POST http://127.0.0.1:3425/v1/chat/completions`（金鑰 `magpie`）用 `codex/gpt-6.1-sol`、`codex/gpt-6-luna` 都能回應，也都把 Bation 改成 Bastion。
- `reasoning_effort`：
  - low 時，sol 用了 14 個 reasoning tokens，luna 用了 0 個。
  - `minimal`、`xhigh`、`max` 都不報錯，但在簡單問題上都是 0 個 reasoning tokens。magpie 是轉送還是忽略這些值，還沒確認。
- 用量欄位：`prompt_tokens`（含 `prompt_tokens_details.cached_tokens`）、`completion_tokens`（含 `completion_tokens_details.reasoning_tokens`）。
- 一句話的請求，`prompt_tokens` 就有 3,500～4,300：gateway 自己注入了提示。計算 context window 和比較成本時都要考慮這一點。

## 設計

### 1. 端點設定（使用者自行設定）

管理後台新增「LLM 端點」，可以設定多個端點，每個端點有：

| 欄位 | 說明 |
|---|---|
| 名稱 | 例如「公司 LiteLLM」「magpie」「OpenAI」 |
| 類型 | `openai-compatible`（預設，LiteLLM、magpie、OpenAI、vLLM 等）或 `anthropic`（原生 Anthropic API，保留 server-side fallbacks 等功能） |
| Base URL | 例如 LiteLLM 的 `https://litellm.<公司內網>/v1`，或 magpie 的 `http://127.0.0.1:3425/v1` |
| API key | 在介面輸入，或指定環境變數名稱（兩者擇一） |
| 模型清單 | 按「讀取模型」呼叫 `GET {baseURL}/models` 自動列出，讓使用者挑選，不用手打模型 ID |

API key 的保存方式：
- 存在本機 `DATA_DIR/secrets.json`（權限 600，和 `auth.json` 同一套 `jsonStore`），不進 git。
- 只能寫入，不能讀出：API 只回傳「已設定、末四碼」，介面看不到完整金鑰，`ai.json` 與匯出也不包含。
- 更換或刪除金鑰都會記錄時間與操作者，不記金鑰本身。
- 有設定環境變數名稱時，以環境變數為準，給偏好不把金鑰寫進檔案的人使用。

模型設定（現有的 `ai.json` models）改成引用端點：`{ endpointId, model, contextWindow, maxOutput, effort }`。現有的 `baseURL`、`apiKeyEnv` 欄位在讀取時自動轉成一個端點，舊設定不會失效。

第一次啟動、還沒有任何端點時，介面引導使用者設定：建議先填公司 LiteLLM，再按「讀取模型」與「測試」。

### 2. 模型呼叫抽象化

把 `claude()` 改成 `llm(system, content, opts)`，依端點類型分派：

| 端點類型 | 呼叫方式 | effort | 用量對應到 `usage[]` |
|---|---|---|---|
| `openai-compatible`（主要） | 用 `fetch` 呼叫 `{baseURL}/chat/completions`，不新增套件；送 `Authorization: Bearer <key>` | `reasoning_effort`：low、medium、high 直接對應；xhigh、max 先對應到 high，確認端點會轉送後再開放；不支援的模型（例如 LiteLLM 後面的非推理模型）不送 | `inputTokens`＝prompt − cached，`cacheReadTokens`＝cached，`outputTokens`＝completion（含 reasoning） |
| `anthropic`（選用） | 現有 Anthropic SDK（beta stream、fallbacks） | `output_config.effort` | 不變 |

經 LiteLLM 呼叫 Claude 時走 `openai-compatible`，所以公司只要提供一個 LiteLLM 端點，所有模型都能用。

- 拒答、空回應、`finish_reason: length` 都要轉成明確的錯誤訊息，並記進 `usage`（`error`）。
- 送出前照樣用 `checkContext()` 檢查，估算時加上 gateway 注入的約 4K tokens。
- 校對、摘要、講者建議、連線測試都改用 `llm()`，現有的 `kind` 不變。

### 3. 內建模型設定

`ai.js` 的 `BUILTIN_MODELS` 把現有的 `gpt` 佔位，換成兩個實際可用的設定，預設停用，由管理員啟用：

| id | label | model | context／輸出上限 | effort |
|---|---|---|---|---|
| `gpt-sol` | OpenAI GPT-6.1 Sol | `codex/gpt-6.1-sol` | 待查官方規格，查到前用保守值，並在後台標示「未確認」 | medium |
| `gpt-luna` | OpenAI GPT-6 Luna | `codex/gpt-6-luna` | 同上 | low |

這兩個是 magpie 上的模型 ID。用 LiteLLM 時，模型 ID 由「讀取模型」帶入，不寫死。magpie 的前綴要先確認：`codex/`、`copilot/`、`devin/` 的帳號、速率限制與資料政策可能不同，選定後記在決策裡。

### 4. 每個用途可以指定模型

現在 Agent 可以指定模型，但校對與講者建議只用預設模型。在管理後台加上「校對模型」「講者建議模型」兩個設定，預設維持目前的行為。

## 評估方式

每個用途比較 Opus 5.5、gpt-6.1-sol、gpt-6-luna，資料用合成測試組和三段真實錄音（見 [benchmark 標準](../research/2026-10-21-benchmark-standards.md)）：

| 用途 | 指標 | 通過條件 |
|---|---|---|
| 術語校對 | `e2e.py` 術語分數；嚴苛音檔逐句檢查有沒有改寫非術語內容；【?】數量 | 達到現有門檻，而且沒有編造；最好接著做 diff 驗證（reliability 計畫第 4 項） |
| 摘要 | 必備段落齊全；`- [ ] 事項 — 負責人 [n]` 能被 `parseActions()` 解析；`[n]` 行號都存在且內容相符；有沒有逐字稿外的內容 | 三段真實錄音都通過人工檢查 |
| 講者建議 | 建議的名字都在候選名單；依據行號真的有點名；和人工判斷一致的比例 | 不比 Opus 差 |
| 共通 | 耗時、tokens、失敗率 | 記錄在 `usage`，並寫進這份計畫的結果 |

## 資料邊界（實作前先決定）

D-008 寫的是「逐字稿文字送 Claude」。改成可自訂端點後，逐字稿會送到使用者設定的端點：
- 公司 LiteLLM：資料邊界由公司的 LiteLLM 設定決定，這是建議的預設。
- magpie：經 codex、copilot 或 devin 的帳號送到各家服務商。

實作前要先確認公司規範允許哪些端點，並新增一筆決策，更新 D-008 的資料邊界。介面在端點設定頁明確寫出「逐字稿會送到這個端點」。

## 階段與完成條件

| 階段 | 內容 | 完成條件 |
|---|---|---|
| O1 | 端點設定（類型、Base URL、API key 只寫不讀、讀取模型清單），舊設定自動轉換 | 單元測試涵蓋金鑰不外流（API 回應、`ai.json`、錯誤訊息都不含金鑰）、舊設定轉換；在後台設定 magpie 端點後能讀到模型清單 |
| O1b | `llm()` 分派、OpenAI 相容呼叫、用量對應、錯誤處理；兩個內建模型設定；後台「測試」可用 | 單元測試涵蓋用量對應與錯誤轉換；後台對兩個模型的連線測試都成功並記錄用量；用公司 LiteLLM 端點實測一次（需要使用者提供端點與金鑰） |
| O2 | 校對與講者建議可以指定模型 | 設定生效，並有測試 |
| O3 | 依上面的評估方式比較三個模型 | 結果寫進 `docs/research/`，並依結果決定每個用途的預設模型 |
| O4 | 文件與決策 | 新增決策（OpenAI 的資料邊界與預設模型），更新 architecture、README、`meetings-dev` skill |
