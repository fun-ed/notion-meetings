// Model profiles and meeting agents (system prompts + skills), stored in DATA/ai.json and edited by admins.
import fsp from 'node:fs/promises';
import os from 'node:os';

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
// anthropic: native Anthropic API; openai: any OpenAI-compatible /chat/completions endpoint (LiteLLM, magpie, OpenAI); gemini: placeholder (D-021)
export const PROVIDERS = ['anthropic', 'openai', 'gemini'];
export const CALLABLE = ['anthropic', 'openai'];

// Limits from the Claude model table (1M context, 128K output); effort defaults follow each model's own default.
export const BUILTIN_MODELS = [
  { id: 'opus', label: 'Claude Opus 5.5', provider: 'anthropic', model: 'claude-opus-5-5', baseURL: '', apiKeyEnv: '',
    contextWindow: 1_000_000, maxOutput: 64_000, effort: 'medium', enabled: true, default: true, systemAddition: '' },
  { id: 'sonnet', label: 'Claude Sonnet 5.5', provider: 'anthropic', model: 'claude-sonnet-5-5', baseURL: '', apiKeyEnv: '',
    contextWindow: 1_000_000, maxOutput: 64_000, effort: 'high', enabled: true, default: false, systemAddition: '' },
  // OpenAI models use OPENAI_BASE_URL / OPENAI_API_KEY. Model IDs are magpie's (the default gateway); npm run start:litellm drops
  // the codex/ prefix to get LiteLLM's names. Limits are from LiteLLM's /model/info (1.05M input; output capped at 64K).
  { id: 'gpt', label: 'OpenAI GPT-6.1 Sol', provider: 'openai', model: 'codex/gpt-6.1-sol', baseURL: '', apiKeyEnv: '',
    contextWindow: 1_050_000, maxOutput: 64_000, effort: 'medium', enabled: false, default: false, systemAddition: '' },
  { id: 'gpt-luna', label: 'OpenAI GPT-6 Luna', provider: 'openai', model: 'codex/gpt-6-luna', baseURL: '', apiKeyEnv: '',
    contextWindow: 1_050_000, maxOutput: 64_000, effort: 'low', enabled: false, default: false, systemAddition: '' },
  { id: 'gemini', label: 'Gemini 4（規劃中）', provider: 'gemini', model: 'gemini-4-argon', baseURL: '', apiKeyEnv: 'GEMINI_API_KEY',
    contextWindow: 0, maxOutput: 0, effort: 'medium', enabled: false, default: false, systemAddition: '' },
];

const agent = (id, name, description, systemPrompt) => ({ id, name, description, systemPrompt, model: '', effort: '', skills: [], enabled: true, builtin: true });
const REVIEW = '以設計審查的角度整理，每個發現標註嚴重度（高／中／低）、依據的逐字稿行號、建議與負責人；沒有討論到的面向寫「未討論」，不要自行補充。';
export const BUILTIN_AGENTS = [
  agent('general', '一般會議', '預設，不加額外焦點', ''),
  agent('dri-handover', 'DRI 交接', '交接範圍、現況、風險與交接清單',
    '這是 DRI（負責人）交接會議。另外整理「## 交接清單」：交接範圍與系統、目前狀態、進行中的事件與風險、待決事項、相關文件與 runbook、交接後的 owner 與期限、尚待確認的問題。'),
  agent('architecture', '架構討論', '選項比較、取捨與決策紀錄',
    '這是架構討論。另外整理「## 選項與取捨」（每個方案的優缺點、成本、風險）與「## 決策紀錄」（ADR 格式：背景、決策、理由、後果），並列出未決問題與需要的驗證。'),
  agent('eks-upgrade', 'AWS EKS 升級', '版本、相依元件、步驟、回滾',
    '這是 AWS EKS 叢集升級會議。另外整理「## 升級計畫」：叢集與版本（from→to）、受影響的 add-on 與元件（VPC CNI、CoreDNS、kube-proxy、Karpenter 等）相容性、已棄用 API、升級步驟順序、維護時段、回滾計畫、驗證項目與風險。'),
  agent('eks-component', 'EKS 元件升級', '元件版本、相容性、rollout 策略',
    '這是 EKS 元件升級會議。另外整理「## 元件升級」：元件與版本、變更重點、相容性矩陣、測試環境驗證結果、rollout 策略（分批、canary）、回滾方式、監看指標。'),
  agent('cicd', 'CI/CD', 'pipeline 變更、部署策略、品質關卡',
    '這是 CI/CD 會議。另外整理「## Pipeline 與部署」：pipeline 變更、失敗原因與修正、部署策略、品質關卡（測試、掃描、審查）、權限與 secrets 風險、後續改善。'),
  agent('aisdlc', 'AISDLC 流程', 'AI 在開發生命週期的使用點與管控',
    '這是 AISDLC（AI 輔助軟體開發生命週期）流程會議。另外依階段（需求、設計、實作、測試、部署、維運）整理 AI 的使用點、guardrail、人工審核點、評估指標與風險。'),
  agent('skill-eval', 'Skill 開發與 Eval', 'skill 目的、測試案例、eval 結果',
    '這是 agent skill 開發與評測會議。另外整理「## Skill 與 Eval」：skill 目的與觸發條件、測試案例、eval 指標與結果、失敗案例與原因、下一輪迭代項目。'),
  agent('standup', 'Daily standup', '每人昨天／今天／阻礙',
    '這是每日站立會議。「## 重點」改為依人整理：昨天完成、今天計畫、阻礙；另外列出需要他人協助的事項。'),
  agent('review-security', 'Design review：Security', '威脅、權限、機密、資料保護',
    `${REVIEW}審查面向：威脅模型、身分驗證與授權、secrets 管理、資料保護與加密、網路暴露、稽核與合規。`),
  agent('review-architecture', 'Design review：Architecture', '可擴充性、可靠度、耦合、成本',
    `${REVIEW}審查面向：可擴充性、可靠度與故障模式、元件耦合、資料一致性、成本、演進與相容性。`),
  agent('review-k8s', 'Design review：Kubernetes', '資源、探針、PDB、安全設定',
    `${REVIEW}審查面向：資源 requests/limits、liveness/readiness probe、PDB 與高可用、securityContext、NetworkPolicy、HPA/Karpenter、升級與相容性。`),
  agent('review-aws', 'Design review：AWS', 'Well-Architected、IAM、配額、成本',
    `${REVIEW}審查面向：AWS Well-Architected 六大支柱、IAM 最小權限（含 IRSA）、服務配額、跨 AZ／Region 可用性、成本。`),
  agent('review-observability', 'Design review：Observability', 'SLI/SLO、log/metric/trace、告警',
    `${REVIEW}審查面向：SLI 與 SLO、logs／metrics／traces 覆蓋、告警與值班、dashboard、runbook。`),
];

const str = (v, n) => String(v ?? '').trim().slice(0, n);
const int = (v, max) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
export function cleanModel(m) {
  return {
    id: str(m?.id, 40).replace(/[^\w-]/g, '') || `m${Date.now()}`, label: str(m?.label, 80) || str(m?.model, 80),
    provider: PROVIDERS.includes(m?.provider) ? m.provider : 'anthropic', model: str(m?.model, 80),
    baseURL: /^https?:\/\/[^\s]+$/.test(m?.baseURL ?? '') ? m.baseURL : '', apiKeyEnv: /^[A-Z][A-Z0-9_]{0,63}$/.test(m?.apiKeyEnv ?? '') ? m.apiKeyEnv : '',
    contextWindow: int(m?.contextWindow, 10_000_000), maxOutput: int(m?.maxOutput, 128_000),
    effort: EFFORTS.includes(m?.effort) ? m.effort : 'medium', enabled: m?.enabled === true, default: m?.default === true,
    systemAddition: str(m?.systemAddition, 8000), test: m?.test ?? null,
  };
}
export function cleanAgent(a) {
  return {
    id: str(a?.id, 40).replace(/[^\w-]/g, '') || `a${Date.now()}`, name: str(a?.name, 60) || '未命名 Agent', description: str(a?.description, 200),
    systemPrompt: str(a?.systemPrompt, 20000), model: str(a?.model, 40), effort: EFFORTS.includes(a?.effort) ? a.effort : '',
    skills: (Array.isArray(a?.skills) ? a.skills : String(a?.skills ?? '').split('\n')).map(x => str(x, 500)).filter(Boolean).slice(0, 10),
    enabled: a?.enabled === true, builtin: a?.builtin === true,
  };
}

// Stored settings plus any built-ins added in later versions.
export function withBuiltins(cfg) {
  const models = [...(cfg.models ?? [])], agents = [...(cfg.agents ?? [])], uses = cleanUses(cfg.uses);
  for (const b of BUILTIN_MODELS) if (!models.some(m => m.id === b.id)) models.push({ ...b, test: null });
  for (const b of BUILTIN_AGENTS) if (!agents.some(a => a.id === b.id)) agents.push(b);
  if (!models.some(m => m.default && m.enabled)) (models.find(m => m.enabled) ?? {}).default = true;
  return { models, agents, uses };
}

// Which model the term correction and speaker hints use; empty means the default model.
export const USES = ['correct', 'speakers'];
export const cleanUses = u => Object.fromEntries(USES.map(k => [k, str(u?.[k], 40).replace(/[^\w-]/g, '')]));

// The meeting's agent (if enabled) and the model it asks for, else the default model.
export function pickAI(cfg, agentId) {
  const { models, agents } = withBuiltins(cfg);
  const usable = m => m?.enabled && CALLABLE.includes(m.provider);
  const a = agents.find(x => x.id === (agentId || 'general') && x.enabled) ?? null;
  const model = (a?.model && usable(models.find(m => m.id === a.model)) && models.find(m => m.id === a.model))
    || models.find(m => m.default && usable(m)) || models.find(usable);
  if (!model) throw Object.assign(new Error('沒有可用的模型，請到管理後台啟用模型'), { status: 400 });
  return { model, agent: a, effort: a?.effort || model.effort };
}

// The model set for one use (term correction, speaker hints), else the default model.
export function pickFor(cfg, use) {
  const { models, uses } = withBuiltins(cfg);
  const m = models.find(x => x.id === uses[use] && x.enabled && CALLABLE.includes(x.provider));
  return m ? { model: m, effort: m.effort } : pickAI(cfg);
}

// Conservative token estimate: CJK ≈ 1 token per character, other text ≈ 1 token per 3 characters.
export const estimateTokens = text => { const cjk = (String(text).match(/[　-鿿＀-￯]/g) ?? []).length; return Math.ceil(cjk * 1.1 + (String(text).length - cjk) / 3); };
export function checkContext(model, text) {
  const need = estimateTokens(text) + model.maxOutput;
  if (model.contextWindow && need > model.contextWindow) {
    throw Object.assign(new Error(`內容約 ${estimateTokens(text).toLocaleString()} tokens，加上輸出上限 ${model.maxOutput.toLocaleString()} 已超過 ${model.label} 的 context window（${model.contextWindow.toLocaleString()}）`), { status: 400 });
  }
}

// Skills are SKILL.md files (local path or URL) whose text becomes part of the agent's system prompt.
export async function loadSkill(src) {
  const MAX = 50_000;
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`skill 下載失敗（${res.status}）：${src}`);
    return (await res.text()).slice(0, MAX);
  }
  if (!/\.md$/i.test(src)) throw new Error(`skill 只接受 .md 檔：${src}`);
  return (await fsp.readFile(src.replace(/^~(?=\/)/, os.homedir()), 'utf8')).slice(0, MAX);
}
