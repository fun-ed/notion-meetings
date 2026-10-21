# 帳號與權限（auth.js、server.js accountRoute）

- `permOf(user, m)`：admin→owner；擁有者→owner；其他取 `m.access`（private=none，預設 view）與 `m.grants[].perm` 最高者；readonly 封頂 view（含擁有的會議）。
- 伺服器每個會議路由：`need(can('view'), 404)` 先擋（不透露存在），PATCH 需 edit、改 `access` 需 owner、留言需 comment、shares 需 owner、summarize 與其他動作需 edit。
- Session 在記憶體 `Map`（重啟全登出）；cookie `sid` HttpOnly SameSite=Lax 7 天；非 GET 若有 Origin 且 host 不同→403。
- `jsonStore()` 以 promise chain 串行 read-modify-write；`auth.json` 權限 600。新增寫入一律走 `db.mutate()`。
- 第一個註冊者成為 admin，並以 `adoptOrphanMeetings()` 接管沒有 `ownerId` 的舊會議。
- 重設密碼：產生只顯示一次的臨時密碼、`mustChangePassword`、`endUserSessions()`。
- 分享：token 用 `randomBytes(24)`；開啟（POST /api/shares/:token）寫入 grant `{userId, perm, token}`；撤銷時移除該 token 的 grants。
- 名錄合併 `mergePeople(csv, users)`：個人列出的成員 < CSV < 使用者本人；群組掛在成員的 `groups`，供 `group:` 搜尋。
- 測試：`server.test.js` 的 `client()` 為每個身分維持 cookie；第一個 API 測試建立 admin，後續測試共用。
