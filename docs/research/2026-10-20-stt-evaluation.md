# 2026-10-20 語音轉錄模型評測

結論：沒有任何轉錄模型能單獨達到 [D-002](../decisions.md) 的基準。採用的組合是 MAI-Transcribe 2＋術語清單，接著用 OpenCC 轉台灣繁體，再由 Claude 嚴格校對術語。整條流程在兩份測試音檔都得到 45/45 術語、0 簡體字、3/3 講者。

## 方法

測試集由 `eval/make-testset.sh` 產生，內容見 `eval/lines.tsv`：

- 9 句台灣技術會議對話，3 位講者：Meijia（台灣女聲）、Eddy（台灣男聲）、Samantha（英文女聲）。
- 45 個術語（`eval/terms.txt`），包含 Karpenter、IRSA、PgBouncer、CodeRabbit、二代健保、勞退自提。
- 兩份音檔：`meeting.mp3` 是乾淨錄音（約 70 秒）；`meeting-hard.mp3` 加了粉紅噪音、電話頻寬、語速 1.15 倍和回音（約 60 秒）。

計分方式見 `eval/score.py`：

- 術語：先把簡體轉繁體再比對，只衡量有沒有聽對。
- 簡體字：計算參考句中會出現的字有多少以簡體形式輸出。
- 講者：取每句的中點時間，對應到模型輸出的講者標籤，再看 3 個聲音是否被分成 3 個不同標籤。
- 編造：人工逐句比對。分數抓不到編造，所以每次評測都必須讀完整輸出。

限制：測試音檔是合成語音；術語清單剛好就是答案，所以「帶術語」的分數偏樂觀；每個設定只跑一次，而 MAI 的輸出每次略有不同。

## 結果：轉錄模型

術語數格式為「乾淨／嚴苛」。

| 模型（通道） | 術語 | 字體 | 講者 | ZDR | 備註 |
|---|---|---|---|---|---|
| MAI-Transcribe 2＋phraseList（OpenRouter） | 44 / 36 | 簡體 | 3/3 / 3/3 | Azure | phraseList 有效（沒帶時 38/28）；指定 `zh-TW` 仍輸出簡體 |
| ElevenLabs Scribe v2（OpenRouter） | 43 / 24 | 簡體 | 2/3 / 3/3 | 有 | `keyterms` 沒有效果，加不加結果相同 |
| AssemblyAI Universal-3.6 Pro（OpenRouter） | 40 / 30 | 簡體 | 沒回傳 | 有 | 插入「哇哦！」 |
| Gemini 3.5 Transcribe（OpenRouter） | 40 / 0 | 繁體 | 沒回傳 | 沒有 | 嚴苛音檔只剩少數片段 |
| Qwen3-ASR 1.7B（DeepInfra） | 35 / 14 | 簡體 | 不適用 | DeepInfra 美國 | 嚴苛音檔冒出泰文；`initial_prompt` 沒有效果 |
| Qwen3-ASR 0.6B（DeepInfra） | 20 / 12 | 簡體 | 不適用 | 同上 | |
| Nemotron-3-Diarization（DeepInfra） | 只分講者 | 不適用 | 2/3 / 3/3 | 同上 | 乾淨音檔把兩位女聲併成一人 |
| Gemini 4 Argon（magpie，chat `file` 欄位） | 45 / 44 | 繁體 | 3/3 / 3/3 | 不適用 | 會編出看似合理的內容：「要另外算」寫成「要預扣 2.11%」 |
| Gemini 3.8 Flash（magpie） | 44 / 30 | 繁體 | 3/3 | 不適用 | 嚴苛音檔整句編造；用 `input_audio` 時音訊被丟掉，仍產生假逐字稿 |

不能用或沒測的選項：

- Copilot（magpie）：只接受文字和圖片，沒有轉錄 API；Free 方案不開放 Gemini。
- magpie 的 `/v1/audio/transcriptions`：沒有任何模型支援。
- Qwen-Audio-3.1-ASR：只在阿里雲 Model Studio 提供，沒有實測。

## 結果：後處理

輸入是 MAI＋phraseList 的輸出。

| 做法 | 術語 | 簡體字 | 編造 |
|---|---|---|---|
| 不處理 | 41 / 34 | 21 | 不適用 |
| OpenCC s2twp | 44 / 36 | 0 | 不會 |
| OpenCC＋Claude 嚴格校對（只修術語，標【?】） | 45 / 43 | 0 | 未發現；有一處猜對但沒標【?】 |
| Claude 寬鬆改寫（台灣用語＋語氣） | 45 / 45 | 0 | 會：把亂碼改寫成通順的錯句 |

## 結果：整條流程（`eval/e2e.py`）

| 音檔 | 術語 | 簡體字 | 講者 | 【?】 |
|---|---|---|---|---|
| 乾淨 | 45/45 | 0 | 3/3 | 0 |
| 嚴苛 | 45/45 | 0 | 3/3 | 2 到 3 |

嚴苛音檔的摘要把辨識不清的目標值寫成「待確認」，沒有編造數字。

尚未解決：MAI 把「調到 70%」聽成「降到 70%」。這不是術語，校對不會處理，也不會標【?】。

## 外部 benchmark 摘要

公開排行只用來挑候選。中文和中英夾雜的資料很少，而且多半是廠商自己發表的。

- Artificial Analysis AA-WER（以英文為主）：MAI-Transcribe 2 2.0%、Scribe v2 2.2%、Gemini 3.5 Transcribe 2.6%、Deepgram Nova-3 5.2%。
- Qwen3-ASR 技術報告（Qwen 自行量測）：CommonVoice zh-TW CER 為 1.7B 3.77、Flash 3.30；比較對象是 GPT-4o-Transcribe、Gemini 2.5 Pro 這類上一代模型；沒有中英夾雜評測。
- GigaSpeechBench（第三方，2026-07）：中文 12 個專業領域平均 B-CER，SeedASR 14.79、Qwen3-ASR-Flash 17.56、Gemini 3.0 Flash 19.74、Scribe v2 22.98、Azure 27.64、GPT-4o Transcribe 32.68。
- Breeze ASR 25（聯發科，台灣華語與中英夾雜）：CSZS-zh-en 13.01，Whisper v3 為 26.43；沒有分講者。

## 來源

- Artificial Analysis Speech-to-Text：https://artificialanalysis.ai/speech-to-text
- OpenRouter STT collection：https://openrouter.ai/collections/speech-to-text-models
- OpenRouter STT guide：https://openrouter.ai/docs/guides/overview/multimodal/stt
- OpenRouter ZDR 端點清單：`GET https://openrouter.ai/api/v1/endpoints/zdr`
- Qwen3-ASR Technical Report：https://arxiv.org/html/2601.21337
- GigaSpeechBench：https://arxiv.org/html/2606.28884
- Qwen-Audio-3.1-ASR：https://qwenaudio.github.io/qwen-audio-3.1-asr/
- Breeze ASR 25：https://github.com/mtkresearch/Breeze-ASR-25
- DeepInfra Data Privacy：https://docs.deepinfra.com/account/data-privacy
- Notion AI Meeting Notes 評測（功能對照來源）：https://tldv.io/blog/notion-ai-meeting-notes-review/
