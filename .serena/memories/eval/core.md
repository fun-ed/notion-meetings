# eval/ 評測與回歸

- `make-testset.sh <dir>`：macOS `say`（Meijia、Eddy (Chinese (Taiwan))、Samantha）＋ffmpeg 產生 `meeting.mp3`（乾淨）與 `meeting-hard.mp3`（噪音＋電話頻寬＋1.15 倍速＋回音）；同時留下 `lines.tsv`、`l<n>.wav` 供計分對時。嚴苛版必須經 WAV 再編 mp3，直接由濾鏡圖進 libmp3lame 會截斷尾端。
- `score.py`：術語先 S→T 再比對（量「聽對」，字體另計）；講者以每句中點對最近片段；`T2S` 只涵蓋參考句用字。
- `stt_eval.py <dir> <audio> <tempo> <configs.json>`：tempo 乾淨 1.0、嚴苛 1.15。設定檔 `"$TERMS"` 佔位。
- `e2e.py <base-url> <dir>`：對執行中的 App 上傳兩檔，門檻乾淨 ≥44/45、嚴苛 ≥40/45、簡體 0、`voices_separated` 3/3；未過 exit 1。
- OpenRouter 會默默丟掉不認得的 `provider.options`（實測 `elevenlabs.keyterms`、`assemblyai.speaker_labels` 無效）→ 新參數一定比對帶/不帶的差異。
- 分數抓不到編造：每次都要逐句讀輸出。MAI 每次結果略有差異，1–2 個術語內的差距要重跑。
- 測試集是合成語音、術語表即答案 → 分數偏樂觀。
