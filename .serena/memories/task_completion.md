# 任務完成檢查

1. `mise exec -- npm test` 全過；後端與 API 邏輯用 `server.test.js`，前端邏輯用 `ui.test.js`。測試不得呼叫外部 API，使用 `OPENROUTER_API_KEY=''`。
2. 動到轉錄、OpenCC、校對、摘要：跑 `eval/e2e.py`（步驟見 `mem:suggested_commands`），確認兩行 PASS，並人工讀嚴苛版逐字稿與摘要。失敗須依 `mem:eval/core` 如實報告，不降低閘門或把其他檢查視為替代。
3. 介面改動實際檢查草稿、待轉錄、已完成、唯讀及亮暗色；窄版必須包含首次開啟、側欄展開／收合及鍵盤焦點，不能只檢查手動收合後的畫面。各分頁與草稿的 `#copy-current`／`#copy-status` 應只出現一組，並驗證實際剪貼簿內容與失敗提示。
   原始碼 HTML 每次從磁碟讀，但後端路由與 Markdown 程式在伺服器啟動時載入；變更資產路由或套件後須重啟並重新整理。執行檔則須重建，不能把原始碼介面的驗證當成內嵌資產驗證。
4. 新 API 要有權限不足的測試（403／404）；介面改動用非擁有者帳號與暗色模式各看一次。
5. 文件同步：CHANGELOG.md 記新增與驗證結果；README 的 3 張截圖（meeting、transcript-dark、action-items）畫面改了就重拍；欄位或路由變 → `docs/architecture.md`；完成待辦 → 刪 `docs/plans/` 計畫裡的該項；決策變 → `docs/decisions.md` 新增一筆；指令變 → README 與 skills 一併改。
6. 發版照 `meetings-dev` skill 的完整流程。區分本機程式、遠端提交、建置產物與實際 Release；CHANGELOG「未發布」不因同一版本號或 push 就自動視為發布。所有平台的建置與校驗不能取代各平台的實際執行，已推送的 tag 不移動，需使用者同意才建立 Release。
7. 無 linter/formatter/type checker 可跑；`node --check server.js` 可做語法檢查。
