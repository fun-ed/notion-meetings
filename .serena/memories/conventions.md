# 寫法慣例

- 最小改動、無框架；能用標準庫就不加相依。註解只寫「為什麼」，一行。
- 已知限制的捷徑加 `// shortcut: <限制>, <何時升級>`。
- `meeting.json` 寫入一律 `update(id, patch)`（先重讀再合併），存檔 `.tmp` + rename；PATCH 只收白名單欄位（`title`、`speakers`、`notes`、`glossary`）。
- 會議 id 以 `ID` regex 驗證；上傳檔名只取 `path.basename`，副檔名經 `extOf()` 白名單；語言參數經 `LANG` regex。
- 錯誤以 `Object.assign(new Error(msg), { status })` 帶 HTTP 狀態碼，最外層統一轉 JSON；ENOENT → 404。
- 純函式（`parseTranscription`、`toTaiwan`、`parseTerms`、`applyNumbered`、`transcriptText`、`extOf`）都 export 供測試；伺服器只在 `import.meta.main` 時 listen。
- 前端：`esc()` 跳脫所有插入 HTML 的值；講者預設名 `Speaker A/B/...` 前後端各一份，要同步。
- 時間：一律 GMT+8（D-016）。伺服器 `nowIso()`（帶 +08:00）、`localDay()`；介面 `dt()`／`day()`／`localInput()` 都帶 `timeZone: 'Asia/Taipei'`。排序前用 `new Date(x).toISOString()` 正規化（舊資料是 Z）。
- 版面：`body` 用 `position:fixed; inset:0` 的 grid（不要用 100vh）；側欄寬度是 `--side-w`（localStorage `sideW`），收合是 `body.side-collapsed`（`sideCollapsed`）。
- 主題：顏色一律用 CSS 變數（`:root` 亮色、`[data-theme=dark]` 暗色），不要寫死色碼；`<head>` 內聯腳本先設 `data-theme` 避免閃爍。
- 權限不足 edit 時，`render()` 結尾會 disable 所有 `main input/textarea/select`，需要保留可用的元素加 `data-keep`；伺服器端仍要檢查。
- 前端 `api()` 遇 401（非 `/api/auth/*`）會回登入頁；`boot()` 先打 `/api/auth/me` 再 route。
- 前端是 Notion 風格（D-010）：hash 路由 `#`／`#new`／`#actions`／`#<id>`；`render(m)` 只用 `current` 重畫，`openMeeting()` 才打 API；`<audio>` 以 `dataset.id` 跨重畫保留；類型與狀態用 Notion 標籤色（`TYPES`、`STATUS`）。
- 標籤、團隊、Y leader 一律用 `qLink()`（`tagLink`／`teamLink`／`leaderLink`）連到 `#search=`，表格列裡要 `stopPropagation`。
- Action Items 頁：`showActions()` 畫工具列，`renderActions()` 只重畫 `#act-list`（保留搜尋框焦點）；收合狀態存在 `openGroups`，有篩選時自動展開。
- 摘要裡的 `- [ ]` 行與 `actions[]` 依出現順序一一對應；改摘要格式或 `parseActions()` 時兩邊要一起改。
- 使用者介面與文件用台灣繁體中文；commit 訊息英文 conventional commits，不加 AI 標記。
