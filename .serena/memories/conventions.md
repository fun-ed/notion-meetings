# 寫法慣例

- 最小改動、無框架；能用標準庫就不加相依。註解只寫「為什麼」，一行。
- 已知限制的捷徑加 `// shortcut: <限制>, <何時升級>`。
- `meeting.json` 寫入一律經 `update()` 排隊，暫存檔加 rename；依現有內容計算的變更用 `update(id, cur => ({...}))`，不可先 `load()` 再回寫。PATCH 僅接受白名單，完整欄位以路由及 `docs/architecture.md` 為準。
- 會議 id 以 `ID` regex 驗證；上傳檔名只取 `path.basename`，副檔名經 `extOf()` 白名單；語言參數經 `LANG` regex。
- 錯誤以 `Object.assign(new Error(msg), { status })` 帶 HTTP 狀態碼，最外層統一轉 JSON；ENOENT → 404。
- 純函式（`parseTranscription`、`toTaiwan`、`parseTerms`、`applyNumbered`、`transcriptText`、`extOf`）都 export 供測試；伺服器只在 `import.meta.main` 時 listen。
- 一般插入 HTML 的值用 `esc()`；Markdown 僅走共用解析與安全過濾，見 `mem:frontend`。講者預設名 `Speaker A/B/...` 前後端各一份，要同步。
- 時間：一律 GMT+8（D-016）。伺服器 `nowIso()`（帶 +08:00）、`localDay()`；介面 `dt()`／`day()`／`localInput()` 都帶 `timeZone: 'Asia/Taipei'`。排序前用 `new Date(x).toISOString()` 正規化（舊資料是 Z）。
- 桌面版 `body` 使用 `position:fixed; inset:0` 的 grid，不用 100vh；側欄寬度為 `--side-w`，存於 `sideW`。桌面收合偏好為 `sideCollapsed`；手機疊層與偏好隔離見 `mem:frontend`。
- 主題：顏色一律用 CSS 變數（`:root` 亮色、`[data-theme=dark]` 暗色），不要寫死色碼；`<head>` 內聯腳本先設 `data-theme` 避免閃爍。
- 不足 edit 權限時，`render()` 結尾會 disable `main input/textarea/select`；需保留的操作加 `data-keep`。摘要工具列隱藏編輯按鈕時也須排除 `[data-keep]`，否則會一起隱藏唯讀複製。伺服器仍須檢查權限。
- 前端 `api()` 遇 401（非 `/api/auth/*`）會回登入頁；`boot()` 先打 `/api/auth/me` 再 route。
- 前端沿用 Notion 文件式版面（D-010）與 hash 路由。`render(m)` 重畫目前資料，`openMeeting()` 才抓 API；`<audio>` 依 `dataset.id` 與 `dataset.section` 跨重畫保留，避免中斷播放。類型與狀態使用 `TYPES`、`STATUS`。
- 標籤、團隊、Y leader 一律用 `qLink()`（`tagLink`／`teamLink`／`leaderLink`）連到 `#search=`，表格列裡要 `stopPropagation`。
- Action Items 頁：`showActions()` 畫工具列，`renderActions()` 只重畫 `#act-list`（保留搜尋框焦點）；收合狀態存在 `openGroups`，有篩選時自動展開。
- 修改摘要格式或 `parseActions()` 時，同時核對後端衍生資料與前端互動映射；分別見 `mem:backend/pipeline`、`mem:frontend`，不可假設每個 Markdown checkbox 都是同索引的 action。
- 使用者介面與文件用台灣繁體中文；commit 訊息英文 conventional commits，不加 AI 標記。
