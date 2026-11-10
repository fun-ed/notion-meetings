# 會議回顧提示研究（2026-11-10）

## 結論

六組提示分別處理自由提問、會議回顧、工作行為反思、專案里程碑、IC 成長，以及利害關係人溝通與試行推進。提示共同要求模型只依會議資料作答，區分事實、推測與建議，承認資料缺口，不推測他人動機，並在缺少必要脈絡時請使用者提供會議標題、日期、連結或逐字稿片段。

來源採用各組織公開的一手實務文件。這些文件用來支持提示的整理方法，不代表所有團隊都應採用相同的回顧流程、職級架構或 rollout 門檻。以下整理來源內容及其適用界線；所有頁面於 2026-11-10 查閱。

## 來源與提示設計

| 主題 | 一手來源與文件內容 | 用於提示的方式與界線 |
|---|---|---|
| 會議回顧 | [Google SRE：Postmortem Culture](https://sre.google/sre-book/postmortem-culture/) 將 postmortem 描述為事件、影響、處置、成因與防止重演措施的紀錄；其原則要求檢視促成事件的系統條件，不指責個人或團隊。 | 回顧提示整理目標、成果、決定、未解問題與促成條件，並把改進建議放在流程與環境等可調整處。這份指南的情境是可靠度事故，提示只借用其避免歸咎個人的回顧原則，不假設每場一般會議都是事故檢討。 |
| 可控制的工作行為 | [Center for Creative Leadership：SBI／SBII](https://www.ccl.org/articles/leading-effectively-articles/closing-the-gap-between-intent-vs-impact-sbii/) 說明 Situation、Behavior、Impact，建議描述具體情境、可觀察行為與影響；若要了解意圖，透過詢問確認，不從行為自行推斷。 | 工作反思提示優先尋找情境、可觀察行為與明確影響，再分開可由本人嘗試改變的行為與資源、流程、權限等外在條件。SBI 是回饋方法，不能單靠它判定工作表現或個人能力。 |
| 專案里程碑 | [Atlassian：How to create and use a milestone chart](https://www.atlassian.com/work-management/project-management/project-planning/milestone-chart) 區分里程碑與達成里程碑的任務，並列出日期、說明、相依關係與負責人等欄位。 | 專案提示依這些欄位整理進度與依賴；未出現在會議資料中的日期、負責人、狀態或承諾要標為未知，不自行補值。這是 Atlassian 的專案管理指引，不是跨組織的強制標準。 |
| IC 成長 | [GitLab Handbook：Backend Engineering](https://handbook.gitlab.com/job-description-library/engineering/backend-engineer/) 描述 Backend Engineer 的職責與 IC 成長範圍，涵蓋獨立交付、協作、技術問題範圍與資深工程師的跨團隊影響。[Technical Program Management](https://handbook.gitlab.com/job-description-library/engineering/technical-program-management/) 提供另一個職務的 IC 職級矩陣，依模糊度、影響範圍、執行、溝通、成果、專業能力與問題解決描述期待。[Growth and Development Fund](https://handbook.gitlab.com/handbook/people-group/learning-and-development/growth-and-development/) 建議先和主管討論學習機會、時間與職涯目標如何相連。 | IC 提示依會議證據規劃近期貢獻或技能練習、小範圍合作試行、整理結果並擴大影響；每階段都要寫可觀察成果與回饋檢查點。GitLab 的 Backend 與 TPM 架構只適用於各自職務和組織情境，不應當作其他職務或公司的通用職級表。會議沒有提供的日期與量化目標標為待確認；模型若提出數值或時程，必須標成建議草案。 |
| 利害關係人與分階段試行 | [Digital Public Services Wales：The phases of agile delivery](https://digitalpublicservices.gov.wales/guidance-and-standards/service-manual/delivering-services-agile-way/the-phases-of-agile-delivery) 說明 discovery、alpha、beta、live 各階段；alpha 以原型和少量使用者測試假設，beta 可先以小型 private beta 試行，再擴展為 public beta，並依使用者回饋和資料改進。[Google SRE Workbook：Canarying Releases](https://sre.google/workbook/canarying-releases/) 將 canary 定義為部分且限時的部署及評估，並討論評估訊號、暫停與回復部署。 | 推進提示要求先小範圍探索或試行，再檢視回饋、判斷是否擴大，並預先列出成功／停止條件、支援及回復方式。來源談的是數位服務交付與軟體部署；用在一般組織倡議時，仍須依使用者和組織的實際情境決定對象、指標、時程與核准者。 |
| 自由提問 | 本 preset 不採用特定回顧模型。 | 依使用者問題直接回答，遇到關鍵脈絡不足時先呈現可確認部分，再請求相關會議參照。 |

## 提示中的證據界線

- 有逐字稿行號時沿用原有 `[n]`；只有筆記時指出筆記名稱或段落，不編造引用。
- 會議沒有提供的日期、負責人、決議、完成狀態、利害關係人立場或意圖都標為未提及、待確認或待驗證假設。
- 單場會議不足以推斷職級、績效評等、升遷可能性或穩定人格特質。
- 需要跨會議脈絡時，請使用者提供會議標題、日期、連結或相關逐字稿片段。
- `review-prompts.js` 的自由提問 preset 沒有指定外部框架，因此其 `sources` 為空陣列；其他 preset 的來源網址也記錄在程式的 `sources` 欄位。
