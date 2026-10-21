# 任務完成檢查

1. `mise exec -- npm test` 全過；新邏輯要在 `server.test.js` 有對應測試，測試不得呼叫外部 API（`OPENROUTER_API_KEY=''`）。
2. 動到轉錄、OpenCC、校對、摘要：跑 `eval/e2e.py`（步驟見 `mem:suggested_commands`），兩行 PASS，並人工讀嚴苛版逐字稿與摘要確認無編造。
3. 只動介面：用瀏覽器實際開頁確認（Camofox 或 agent-browser），看 console 無錯。介面每次請求從磁碟讀、伺服器程式要重啟才更新，所以介面必須容忍舊伺服器沒有的欄位（0.3.1 的登入 bug）。
4. 新 API 要有權限不足的測試（403／404）；介面改動用非擁有者帳號與暗色模式各看一次。
5. 文件同步：CHANGELOG.md 記新增與驗證結果；README 的 3 張截圖（meeting、transcript-dark、action-items）畫面改了就重拍；欄位或路由變 → `docs/architecture.md`；完成待辦 → 刪 `docs/plans/` 計畫裡的該項；決策變 → `docs/decisions.md` 新增一筆；指令變 → README 與 skills 一併改。
6. 發版：照 `meetings-dev` skill 的「建置與發版」九步（升版與 CHANGELOG、npm test、確認 Bun 正式版、建置、`scripts/smoke-binary.sh`、介面測試、文件、`gwho` 後 commit＋annotated tag＋push、使用者同意後 `gh release create`）。已推送的 tag 不移動，有問題就再升 patch。
7. 無 linter/formatter/type checker 可跑；`node --check server.js` 可做語法檢查。
