# eval/ 評測與回歸

- `make-testset.sh <dir>`：macOS `say`（Meijia、Eddy (Chinese (Taiwan))、Samantha）＋ffmpeg 產生 `meeting.mp3`（乾淨）與 `meeting-hard.mp3`（噪音＋電話頻寬＋1.15 倍速＋回音）；同時留下 `lines.tsv`、`l<n>.wav` 供計分對時。嚴苛版必須經 WAV 再編 mp3，直接由濾鏡圖進 libmp3lame 會截斷尾端。
- `score.py`：術語先 S→T 再比對（量「聽對」，字體另計）；講者以每句中點對最近片段；`T2S` 只涵蓋參考句用字。
- `stt_eval.py <dir> <audio> <tempo> <configs.json>`：tempo 乾淨 1.0、嚴苛 1.15。設定檔 `"$TERMS"` 佔位。
- `e2e.py <base-url> <dir>` 處理乾淨與嚴苛合成音檔，門檻分別為術語 ≥44/45、≥40/45，簡體 0、`voices_separated` 3/3，且 `spk_consistent` 必須 n/n；失敗 exit 1。單元測試或短轉錄診斷通過不等於這個品質閘門通過。
- OpenRouter 會默默丟掉不認得的 `provider.options`（實測 `elevenlabs.keyterms`、`assemblyai.speaker_labels` 無效）→ 新參數一定比對帶/不帶的差異。
- 分數抓不到編造：每次都要逐句讀輸出。MAI 每次結果不同：嚴苛版同一程式可在 41～45 之間跳。評估校對或後處理的改動，要固定同一份 MAI 輸出（`segments[].raw` → `toTaiwan`）新舊各跑多次比較，不要只比兩次 e2e。
- 測試集是合成語音、術語表即答案 → 分數偏樂觀。
- 凍結的 benchmark 目前只接受單一 section。多檔各自從 00:00 起算，不可直接併成一條時間軸套用既有評分；多 section 的轉錄／摘要本身可正常使用。
