const REVIEW_GROUNDING = `只根據提供的逐字稿、筆記與明確列出的背景資料作答，不把常識或背景知識當成本次會議事實。若逐字稿有段落編號，重要事實沿用原有 [n] 引用；若只有筆記，指出筆記名稱或段落，不要自造引用。清楚標示事實、推測與建議，不推測任何人的動機。若資料缺少必要脈絡，或無法確認要檢視哪場會議，請使用者提供會議標題、日期、連結或相關逐字稿片段。`;
export const REVIEW_PROMPTS = [
  {
    id: 'question',
    title: '自由提問',
    prompt: `${REVIEW_GROUNDING}\n\n請依照使用者提出的問題，整理本次會議資料並直接回答。若問題需要的資訊不足，先回答能由資料確認的部分，再指出缺口，並在缺口會影響結論時，請使用者提供相關會議的標題、日期、連結或逐字稿片段。`,
    sources: [],
  },
  {
    id: 'retrospective',
    title: '會議回顧',
    prompt: `${REVIEW_GROUNDING}\n\n請回顧本次會議或會議中提到的工作階段。整理原先目標、已確認的成果與決定、尚未解決的問題，以及哪些做法值得延續或調整。找出逐字稿支持的事件與可能的促成條件，但不要把個人或團隊當成問題根源，也不要推測任何人的動機。將觀察到的事實、尚待驗證的推測與建議分開呈現。建議應聚焦在流程、資訊、工具、分工或決策條件等可改善之處；待辦只填入會議明確指派的負責人與期限，缺少時標為「待指派」或「待確認」。`,
    sources: [
      {
        title: 'Postmortem Culture: Learning from Failure | Google SRE',
        url: 'https://sre.google/sre-book/postmortem-culture/',
      },
    ],
  },
  {
    id: 'work-reflection',
    title: '工作行為反思',
    prompt: `${REVIEW_GROUNDING}\n\n請協助使用者檢視自己在工作中的行為與影響。優先從逐字稿找出具體情境、可觀察到的行為，以及資料明確提到的結果；再區分哪些做法由使用者能控制或嘗試調整，哪些受到資源、流程、權限或他人決定等因素影響。不要把結果好壞直接等同於個人能力，也不要推測使用者或他人的意圖、性格與動機。若要理解某人的意圖，請將它寫成可在後續對話中確認的問題。提出一至數個具體、可自行嘗試的下一步，並說明還需要什麼回饋或資料才能判斷是否有效。若會議沒有足夠的第一人稱行為證據，請說明限制，並請使用者提供相關會議或逐字稿片段。`,
    sources: [
      {
        title: 'Use Situation-Behavior-Impact (SBI) to Inquire About Intent | Center for Creative Leadership',
        url: 'https://www.ccl.org/articles/leading-effectively-articles/closing-the-gap-between-intent-vs-impact-sbii/',
      },
    ],
  },
  {
    id: 'project-plan',
    title: '專案里程碑檢視',
    prompt: `${REVIEW_GROUNDING}\n\n請根據會議中明確提到的目標與計畫，整理專案里程碑。每個里程碑列出預期交付成果、日期、依賴條件、負責人與目前狀態；資料沒有提到的欄位寫「未提及」或「待確認」，不要自行補日期、承諾或完成狀態。比較已完成、進行中、受阻與尚未確認的工作，指出可能影響後續交付的依賴、風險或決策缺口，並清楚標示哪些是事實、推測與建議。最後列出下一個可確認的檢查點，以及需要向會議參與者補問的資訊。`,
    sources: [
      {
        title: 'How to create and use a milestone chart for project management | Atlassian',
        url: 'https://www.atlassian.com/work-management/project-management/project-planning/milestone-chart',
      },
    ],
  },
  {
    id: 'ic-growth',
    title: 'IC 成長反思',
    prompt: `${REVIEW_GROUNDING}\n\n請協助個人貢獻者（IC）從會議證據整理工作成長線索。列出具體貢獻、可觀察的工作行為、影響範圍、處理模糊問題或依賴的方式，以及會議明確指出的成果與待改善處；每項都附上可找到的來源。把已發生的事實、對能力或影響的推測、後續建議分開，不要從單一會議推斷職級、績效評等、升遷可能性或穩定的人格特質。只有在使用者提供自身職務期待、職涯目標或職級架構時，才依那些標準比較；否則請標示缺少的標準，避免套用其他公司的職級表。最後提出個人分階段計畫：近期選一項貢獻或技能練習，接著在小範圍任務或合作中試行，再整理結果並提出如何擴大影響。每階段都列出行動、可觀察成果與回饋檢查點。會議沒有提供的日期、量化目標、合作對象或回饋者，標為「待確認」；若提出時程或指標，明確標為建議草案，不可寫成會議承諾。`,
    sources: [
      {
        title: 'R&D PMO: Technical Program Management | The GitLab Handbook',
        url: 'https://handbook.gitlab.com/job-description-library/engineering/technical-program-management/',
      },
      {
        title: 'Backend Engineering | The GitLab Handbook',
        url: 'https://handbook.gitlab.com/job-description-library/engineering/backend-engineer/',
      },
      {
        title: 'Growth and Development Fund | The GitLab Handbook',
        url: 'https://handbook.gitlab.com/handbook/people-group/learning-and-development/growth-and-development/',
      },
    ],
  },
  {
    id: 'influence-plan',
    title: '利害關係人與試行推進',
    prompt: `${REVIEW_GROUNDING}\n\n請協助規劃一個循序推進的利害關係人溝通與試行方案。先從會議資料辨認已明確提及的利害關係人、使用者、決策者、需求、疑慮與決策權；資料沒有說明的動機或立場只能列為待驗證假設，不能當成事實。依序提出小範圍探索或試行、檢視回饋與結果、決定是否擴大，以及擴大後的檢查點。每階段列出目標對象、範圍、需要確認的假設、成功或停止條件、回饋方式、支援安排與回復原狀的做法；會議未提供的對象、日期、指標或核准者一律標為待確認。清楚區分會議事實、待驗證假設與建議，並指出還需要哪場會議或哪段資料才能確認方案。`,
    sources: [
      {
        title: 'The phases of agile delivery | Digital Public Services Wales',
        url: 'https://digitalpublicservices.gov.wales/guidance-and-standards/service-manual/delivering-services-agile-way/the-phases-of-agile-delivery',
      },
      {
        title: 'Canarying Releases | Google SRE Workbook',
        url: 'https://sre.google/workbook/canarying-releases/',
      },
    ],
  },
];
