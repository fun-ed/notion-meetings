# 下一步總覽（2026-10-21，0.5.0 之後）

各項目的設計與完成條件在對應的計畫文件；這份只排優先順序。

| 計畫 | 內容 |
|---|---|
| [learning-loop](2026-10-21-learning-loop.md) | 團隊術語、講者建議、benchmark（已完成 P1～P3）、改正規則、聲紋 |
| [llm-endpoints](2026-10-21-llm-endpoints.md) | LLM 與轉錄改走公司 LiteLLM、相容性清單 |
| [reliability](2026-10-21-reliability.md) | 長會議、系統音訊、術語校對 diff 驗證 |
| [roadmap](2026-10-20-roadmap.md) | 其他功能與定期維護 |

## P0：下一輪

| # | 項目 | 計畫 | 需要使用者提供 |
|---|---|---|---|
| 1 | 真實會議 benchmark 的參考答案：三段內部錄音校正講者後凍結，取得講者正確率與 CER 的基準，再訂門檻 | learning-loop P3 | 在介面上校正講者（可以先用講者建議預填） |
| 2 | 公司 LiteLLM：文字模型已在 0.6.0 完成（`npm run start:litellm`）；轉錄要等 LiteLLM 加上 MAI-Transcribe 2，再用 `eval/` 驗證 | llm-endpoints、[LiteLLM 實測](../research/2026-10-21-litellm.md) | 請 LiteLLM 管理員加上 MAI-Transcribe 2 |
| 3 | 術語校對的 diff 驗證：只接受「改成術語」與加【?】 | reliability 第 4 項 | — |
| 4 | 長會議轉錄（先整段送、失敗才切段、逾時）與錄音中途保存；轉錄改成可恢復的工作：記錄已完成的段落，伺服器重啟後接續未完成的會議 | reliability 第 2 項、roadmap 第 4 項 | 一段 30～60 分鐘的錄音 |

## P1：接著做

| # | 項目 | 計畫 |
|---|---|---|
| 5 | 團隊聲紋：sherpa-onnx POC，再做建檔、比對與重新分人 | learning-loop P5 |
| 6 | 系統音訊擷取：線上會議錄到遠端與會者 | reliability 第 3 項 |
| 7 | 逐字稿文字可編輯，以及改正規則 | learning-loop P4 |
| 8 | 講者建議比對名錄的別名，讓拼法不同的名字（例如 Kennie 對 Kenny）也能對上 | learning-loop P2 的改進 |

## 已處理的 review 項目（0.6.0）

- benchmark 的講者正確率改用時間交集計分，跨視窗拆開，匈牙利演算法配對，並列出漏掉的語音比例。
- benchmark 每次執行記錄設定指紋（轉錄模型、校對模型與路徑、團隊術語雜湊）。

## 已處理的 review 項目（0.6.1）

- 講者計分改用互不重疊的時間片，重疊或重複的輸出片段只算一次（原本會算出 200%、漏掉 0%）。
- `start:litellm` 時一律使用啟動時的 key，不會沿用後台存過的舊 key。
- 空的 LLM 回應視為錯誤並重試，不會出現摘要空白卻顯示完成。
- benchmark 整體分數依參考語音時長加權；設定指紋加入 effort、端點主機雜湊、校對提示雜湊與會議術語雜湊。
- GitHub Actions（目前只能手動觸發）：跑單元測試、建置 5 個平台、核對 SHA256，並實際啟動 Linux x64 執行檔。之後要不要改成推送時自動執行，由使用者決定。

## P2：之後

- **標準指標**：真實會議的人工標準答案建好之後，加上 DER 與 cpCER，方便和 pyannote 等模型比較。
- **Endpoint 驗證**：目前只有管理員能設定 LLM Endpoint，伺服器也只綁本機。如果之後開放網路使用，要驗證網址、限制重新導向與內網目標，避免 SSRF 與金鑰被送到錯的地方。

依 [roadmap](2026-10-20-roadmap.md) 的「之後再考慮」：
- 功能：Agent 讀取 remote MCP、登入狀態跨重啟保存、逐字詞的播放同步、語意搜尋、待辦可以直接編輯、刪除與匯出會議、對逐字稿提問。
- 架構：資料量大時改用 SQLite。
- 評估：Gemini 4、Qwen-Audio-3.1-ASR，以及用兩個模型交叉比對、找出非術語的誤聽。
