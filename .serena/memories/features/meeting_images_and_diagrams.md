# v0.15.0 會議圖片與會議圖

- D-031 隨提交 `c1d209879b182fd0252b026ef9a8b985cc30e190` 發布。實作與 API 見 `docs/architecture.md` 的「會議圖片」及「會議圖」。
- 摘要與筆記的圖片附件和辨識結果跟隨會議分享，修改需 edit。私人檢討附件跟隨本人的問答回合。附件辨識走 `llm()` 和會議選用模型。
- `POST /api/meetings/:id/diagram` 以摘要或本人 `{turnId}` 出圖，需 view。共用 `MEETING_DIAGRAM_PROMPT`，透過 Magpie 用 `codex/gpt-image-2.6-flare` 輸出 PNG。其他帳號無法指定私有回合，LiteLLM 模式不會轉送至 Magpie。
- 變更出圖路徑時，依 `meetings-dev` 用合成摘要與私人檢討實測，核對模型 ID、可開啟的 PNG、404 隔離及下載。v0.15.0 的兩個入口已使用真實 Magpie 通過。
