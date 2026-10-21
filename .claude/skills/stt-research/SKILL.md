---
name: stt-research
description: Evaluate a speech-to-text model, audio LLM, or provider for notion-meetings against the zh-TW + English jargon baseline. Use when a new STT model, provider, or benchmark appears, before switching the transcription provider, or for the quarterly re-check.
---

# 語音轉錄模型評測

目標是用實測證據決定要不要換掉現行組合。現行組合寫在 `docs/decisions.md` 的 D-003 到 D-006；所有試過的設定與分數集中在 `docs/research/2026-10-21-benchmark-standards.md` 的「各設定的準確度總表」，新的評測結果也要加進這張表。公開排行榜只用來挑候選；能不能用，以 `eval/` 的實測結果為準。

## 步驟

1. **找候選。** 來源：OpenRouter STT collection、Artificial Analysis Speech-to-Text、中文評測（Qwen 技術報告、GigaSpeechBench、SpeechIO）、台灣在地模型（Breeze ASR）。每個候選記下：能不能分講者、能不能帶術語、價格、單次長度上限、中文的實際數據。完成條件：每個候選都有這五項，查不到的寫「未知」。
2. **隱私檢查。** OpenRouter 的模型先查有沒有 ZDR 端點：

   ```bash
   curl -s https://openrouter.ai/api/v1/endpoints/zdr -H "Authorization: Bearer $(cat ~/.config/openrouter/key)" \
     | python3 -c 'import sys,json;[print(e["model_id"],e["provider_name"],e["tag"]) for e in json.load(sys.stdin)["data"]]' | grep <model>
   ```

   其他服務商要查資料保存政策和機房所在國家。沒有 ZDR 的模型只能用合成測試音檔評測；要正式採用，必須先取得使用者同意。
3. **設定。** 在 `eval/configs/` 新增設定檔。服務商專屬參數放在 `provider.options.<tag>`，`<tag>` 取自上面查到的 `tag` 欄位；術語清單用 `"$TERMS"` 佔位。OpenRouter 會默默丟掉不認得的參數（實測 `elevenlabs.keyterms`、`assemblyai.speaker_labels` 都沒有效果），所以要比較「帶術語」和「不帶術語」的結果，確認參數真的生效。
4. **執行。** 乾淨和嚴苛音檔各跑一次：

   ```bash
   T=$(mktemp -d) && ./eval/make-testset.sh "$T"
   mise exec -- python3 -I eval/stt_eval.py "$T" meeting.mp3 1.0 eval/configs/<file>.json
   mise exec -- python3 -I eval/stt_eval.py "$T" meeting-hard.mp3 1.15 eval/configs/<file>.json
   ```

   不在 OpenRouter 上的服務商，照 `stt()` 的寫法另外寫一個呼叫函式，計分仍然用 `eval/score.py`。DeepInfra：`POST https://api.deepinfra.com/v1/inference/<model>`，multipart 欄位 `audio`，金鑰在 `~/.config/deepinfra/key`（請使用者在自己的終端機執行 `read -s "K?DeepInfra key: " && mkdir -p ~/.config/deepinfra && printf %s "$K" > ~/.config/deepinfra/key && chmod 600 ~/.config/deepinfra/key && unset K`；用 `curl -s -o /dev/null -w "%{http_code}\n" https://api.deepinfra.com/v1/me -H "Authorization: bearer $(cat ~/.config/deepinfra/key)"` 驗證，200 表示有效）。magpie 上的 Gemini：音訊必須放在 chat 的 `file` 欄位；放在 `input_audio` 會被丟掉，而且模型會編出假逐字稿。
   - 公司 LiteLLM（D-022）：用 OpenAI 的 multipart 格式 `POST {base_url}/audio/transcriptions`，送 `file`、`model`、`language`、`response_format`；分講者模型用 `diarized_json`，加上 `chunking_strategy=auto`。端點與金鑰讀 `~/.config/litellm/base_url`、`~/.config/litellm/key`，不要寫進 repo、腳本或報告。2026-10-21 的結果在 `docs/research/2026-10-21-litellm.md`：`gpt-4o-transcribe` 系列與 `whisper-1` 都不達標。LiteLLM 加上新的轉錄模型（例如 MAI-Transcribe 2）時，照這個方式重測。
5. **讀輸出。** 把每個設定的完整 `text` 從頭讀到尾，逐句和 `eval/lines.tsv` 比對，記下原文沒有的數字、句子或語言。完成條件：每個設定都標記為「有編造」或「未發現編造」。
6. **比較與記錄。** 候選至少要在術語、講者、編造三項都不輸給現行的 MAI＋phraseList（44/36、3/3、未發現編造），才考慮替換。把結果寫進 `docs/research/<日期>-<主題>.md`，格式照既有的評測報告。要替換時，在 `docs/decisions.md` 新增決策，再用 `meetings-dev` skill 實作並跑 `eval/e2e.py`。

## 解讀注意

- 計分時會先把簡體轉成繁體，所以術語分數只代表有沒有聽對；字體問題由 OpenCC 處理。
- 測試音檔是合成語音，術語清單就是答案，「帶術語」的分數偏樂觀。結論要用真實錄音確認。
- 用真實錄音比較時，正式流程會合併 `data/learned.json` 的團隊術語，「帶術語」的設定要用同一份術語，並核對設定指紋。挑測試術語時，參考 `data/knowledge.json` 的常見誤聽（`aliases`）。
- 同一個設定每次的結果會略有不同。差距在 1 到 2 個術語以內時，要重跑再下結論。
