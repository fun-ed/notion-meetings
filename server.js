import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import * as OpenCC from 'opencc-js';
import * as auth from './auth.js';
import * as ai from './ai.js';

import pkg from './package.json' with { type: 'json' };

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// A `bun build --compile` binary runs from a virtual /$bunfs path: data goes to ~/.notion-meetings, the UI is embedded (scripts/build.sh).
const COMPILED = import.meta.url.includes('/$bunfs/');
const DATA = process.env.DATA_DIR ?? (COMPILED ? path.join(os.homedir(), '.notion-meetings') : path.join(ROOT, 'data'));
const EMBEDDED_UI = COMPILED ? (await import('./.build/ui.js')).default : null;
const ID = /^[0-9a-f-]{36}$/;
const LANG = /^(auto|[a-zA-Z]{2,5}(-[a-zA-Z]{2,4})?)$/;

export const TEMPLATES = {
  auto: '依會議內容自行決定最合適的結構。',
  sales: '業務會議：客戶需求、痛點、預算與時程、異議處理、下一步。',
  standup: '站立會議：每位成員昨天完成、今天計畫、遇到的阻礙。',
  team: '團隊會議：議題、討論重點、決策、待辦事項。',
};

export const toTaiwan = OpenCC.Converter({ from: 'cn', to: 'twp' });
export const parseTerms = s => [...new Set(String(s ?? '').split(/[\n,，、;；]+/).map(t => t.trim()).filter(Boolean))];

export function parseTranscription(json) {
  return {
    language: json.language ?? null,
    audioSeconds: json.usage?.seconds ?? json.duration ?? null, costUsd: json.usage?.cost ?? null,
    segments: (json.segments ?? []).map(s => ({ start: s.start, end: s.end, speaker: s.speaker ?? 0, text: String(s.text).trim() })),
  };
}

// Model reply is "[n] text" per line; lines that are missing or out of range keep the input text.
export function applyNumbered(segments, reply) {
  const fixed = new Map();
  for (const line of reply.split('\n')) {
    const r = /^\[(\d+)\]\s?(.*)$/.exec(line.trim());
    if (r && r[2] && +r[1] >= 1 && +r[1] <= segments.length) fixed.set(+r[1], r[2]);
  }
  return segments.map((s, i) => ({ ...s, text: fixed.get(i + 1) ?? s.text }));
}

// Action items are the summary's "- [ ] task — owner [n]" lines; done state survives regeneration by matching task text.
export function parseActions(md, prev = []) {
  const done = new Set((prev ?? []).filter(a => a.done).map(a => a.text));
  return [...String(md ?? '').matchAll(/^\s*[-*]\s*\[([ xX])\]\s*(.+)$/gm)].map(([, x, body]) => {
    const cite = /\[(\d+)/.exec(body)?.[1];
    const [, text, owner] = /^(.*?)(?:\s*[—–]+\s+(.*))?$/.exec(body.replace(/\s*\[\d+(?:\s*[,，、-]\s*\d+)*\]/g, '').replace(/\*\*(.+?)\*\*/g, '$1').trim());
    return { text, owner: owner?.trim() || '未指定', done: x !== ' ' || done.has(text), cite: cite ? +cite : null };
  });
}
const cleanActions = a => Array.isArray(a) ? a.slice(0, 500).map(x => ({
  text: String(x?.text ?? ''), owner: String(x?.owner ?? ''), done: x?.done === true, cite: Number.isInteger(x?.cite) ? x.cite : null,
})) : undefined;
// Older meetings lack later fields: fill defaults and derive action items on read.
const withDefaults = m => ({ scheduledAt: '', location: '', brief: '', tags: [], participants: [], ...m, actions: m.actions ?? parseActions(m.summary) });

// User-editable meeting properties; invalid values become empty instead of being stored.
export function cleanMeta({ scheduledAt, location, brief, tags, participants } = {}) {
  return Object.fromEntries(Object.entries({
    scheduledAt: scheduledAt === undefined ? undefined : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(scheduledAt) ? scheduledAt : '',
    location: location === undefined ? undefined : String(location).trim().slice(0, 200),
    brief: brief === undefined ? undefined : String(brief).trim().slice(0, 500),
    tags: tags === undefined ? undefined : parseTerms(Array.isArray(tags) ? tags.join(',') : tags).map(t => t.slice(0, 40)).slice(0, 20),
    participants: participants === undefined ? undefined : parseTerms(Array.isArray(participants) ? participants.join(',') : participants).map(t => t.slice(0, 60)).slice(0, 100),
  }).filter(([, v]) => v !== undefined));
}

// Speaker names keyed by speaker number; blank names fall back to "Speaker A".
const cleanSpeakers = sp => sp && typeof sp === 'object' ? Object.fromEntries(Object.entries(sp)
  .filter(([k, v]) => /^\d{1,2}$/.test(k) && String(v ?? '').trim()).map(([k, v]) => [k, String(v).trim().slice(0, 60)])) : undefined;
// Move transcript segments to another speaker: { segmentIndex: speakerNumber }. Bad entries are ignored.
export function reassignSpeakers(segments, moves) {
  if (!moves || typeof moves !== 'object') return undefined;
  return segments.map((s, i) => { const to = moves[i]; return Number.isInteger(to) && to >= 0 && to < 100 ? { ...s, speaker: to } : s; });
}

export const speakerName = (m, s) => m.speakers?.[s] || `Speaker ${s < 26 ? String.fromCharCode(65 + s) : s + 1}`;
export const fmtTime = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
export const transcriptText = m => m.segments.map((s, i) => `[${i + 1}] ${fmtTime(s.start)} ${speakerName(m, s.speaker)}: ${s.text}`).join('\n');
export function extOf(name) {
  const e = path.extname(name ?? '').toLowerCase();
  return /^\.[a-z0-9]{1,5}$/.test(e) ? e : '.bin';
}

// Meetings live in DATA/<local upload day>/<id>/; lookups go by id, the day folder is only for browsing the disk.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// All dates are Taiwan time (GMT+8, no DST), regardless of the server's own time zone.
export const TZ = 'Asia/Taipei';
export const localDay = (d = new Date()) => d.toLocaleDateString('sv', { timeZone: TZ });
export const nowIso = (d = new Date()) => new Date(d.getTime() + 8 * 3600e3).toISOString().replace('Z', '+08:00');
const dirs = new Map();
function dir(id) {
  if (dirs.has(id)) return dirs.get(id);
  let found = path.join(DATA, id); // flat layout from before date folders, until migrateLayout() moves it
  try {
    const day = fs.readdirSync(DATA).find(d => DAY.test(d) && fs.existsSync(path.join(DATA, d, id)));
    if (day) found = path.join(DATA, day, id);
  } catch {}
  if (fs.existsSync(found)) dirs.set(id, found);
  return found;
}
async function meetingIds() {
  await fsp.mkdir(DATA, { recursive: true });
  const ids = [];
  for (const e of await fsp.readdir(DATA)) {
    if (ID.test(e)) ids.push(e);
    if (!DAY.test(e)) continue;
    for (const id of (await fsp.readdir(path.join(DATA, e))).filter(x => ID.test(x))) { dirs.set(id, path.join(DATA, e, id)); ids.push(id); }
  }
  return ids;
}
// Moves flat DATA/<id>/ folders into DATA/<day of createdAt>/<id>/. Runs at startup.
export async function migrateLayout() {
  await fsp.mkdir(DATA, { recursive: true });
  let moved = 0;
  for (const id of (await fsp.readdir(DATA)).filter(x => ID.test(x))) {
    const from = path.join(DATA, id);
    const created = await fsp.readFile(path.join(from, 'meeting.json'), 'utf8').then(t => new Date(JSON.parse(t).createdAt), async () => (await fsp.stat(from)).mtime);
    const to = path.join(DATA, localDay(created), id);
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.rename(from, to);
    dirs.set(id, to);
    moved++;
  }
  return moved;
}
const load = async id => JSON.parse(await fsp.readFile(path.join(dir(id), 'meeting.json'), 'utf8'));
async function save(m) {
  const f = path.join(dir(m.id), 'meeting.json');
  const tmp = `${f}.${randomUUID()}.tmp`; // unique, so two writers never share a temp file
  await fsp.writeFile(tmp, JSON.stringify(m, null, 2));
  await fsp.rename(tmp, f);
}
// Writes to one meeting run one at a time: each reloads, merges and saves before the next starts, so background
// processing and user edits never drop each other. A function patch computes its changes from the current meeting.
const writeQueues = new Map();
function update(id, patch) {
  const run = (writeQueues.get(id) ?? Promise.resolve()).then(async () => {
    const cur = await load(id);
    const m = { ...cur, ...(typeof patch === 'function' ? await patch(cur) : patch) };
    await save(m);
    return m;
  });
  const tail = run.catch(() => {});
  writeQueues.set(id, tail);
  tail.then(() => { if (writeQueues.get(id) === tail) writeQueues.delete(id); });
  return run;
}

function openrouterKey() {
  if (process.env.OPENROUTER_API_KEY !== undefined) return process.env.OPENROUTER_API_KEY;
  try { return fs.readFileSync(path.join(os.homedir(), '.config/openrouter/key'), 'utf8').trim(); } catch { return ''; }
}

async function transcribe(m, log = []) {
  const key = openrouterKey();
  if (!key) throw new Error('OPENROUTER_API_KEY 未設定（也找不到 ~/.config/openrouter/key）');
  const mp3 = path.join(dir(m.id), 'transcode.mp3');
  // Normalize webm/mp4/mov uploads to small mono mp3; the original file stays as the attachment.
  await promisify(execFile)('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(dir(m.id), m.file), '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', mp3]);
  const terms = await termsFor(m);
  // shortcut: whole meeting in one base64 request; split into chunks if OpenRouter starts rejecting long meetings (413).
  const started = Date.now();
  const res = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'microsoft/mai-transcribe-2',
      input_audio: { data: (await fsp.readFile(mp3)).toString('base64'), format: 'mp3' },
      ...(m.lang !== 'auto' && { language: m.lang.split('-')[0] }),
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
      provider: { zdr: true, options: { azure: { diarization: { enabled: true }, ...(terms.length && { phraseList: { phrases: terms } }) } } },
    }),
  }).finally(() => fsp.rm(mp3, { force: true }));
  const entry = { kind: 'transcribe', provider: 'openrouter', model: 'microsoft/mai-transcribe-2', at: nowIso() };
  if (!res.ok) {
    log.push({ ...entry, ms: Date.now() - started, error: `HTTP ${res.status}` });
    throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  }
  const t = parseTranscription(await res.json());
  log.push({ ...entry, ms: Date.now() - started, audioSeconds: t.audioSeconds, costUsd: t.costUsd });
  return t;
}

// One usage record per Claude call; thinking tokens are part of output_tokens.
export const usageOf = (msg, model, effort, kind, ms) => ({
  kind, provider: 'anthropic', model: msg?.model ?? model.model, label: model.label, effort, ms, at: nowIso(),
  inputTokens: msg?.usage?.input_tokens ?? 0, outputTokens: msg?.usage?.output_tokens ?? 0,
  cacheReadTokens: msg?.usage?.cache_read_input_tokens ?? 0, cacheWriteTokens: msg?.usage?.cache_creation_input_tokens ?? 0,
});

export function aggregateUsage(entries, keyOf) {
  const rows = new Map();
  for (const e of entries) {
    const k = keyOf(e), r = rows.get(k) ?? { key: k, calls: 0, errors: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, ms: 0, audioSeconds: 0, costUsd: 0 };
    r.calls++; if (e.error) r.errors++;
    for (const f of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'ms', 'audioSeconds', 'costUsd']) r[f] += e[f] ?? 0;
    rows.set(k, r);
  }
  return [...rows.values()];
}

const aiStore = auth.jsonStore(path.join(DATA, 'ai.json'), () => ({ models: [], agents: [] }));
const FALLBACK_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1']; // models that accept fallbacks: "default"

// Calls the given model profile (default: the admin's default model) and refuses input that cannot fit its context window.
// One usage record per OpenAI-compatible call; cached prompt tokens count as cache reads (same shape as Anthropic records).
export const openaiUsage = (body, model, effort, kind, ms) => {
  const prompt = body?.usage?.prompt_tokens ?? 0, cached = body?.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  return { kind, provider: 'openai', model: body?.model ?? model.model, label: model.label, effort, ms, at: nowIso(),
    inputTokens: Math.max(0, prompt - cached), outputTokens: body?.usage?.completion_tokens ?? 0,
    cacheReadTokens: cached, cacheWriteTokens: body?.usage?.prompt_tokens_details?.cache_write_tokens ?? 0 };
};

// API keys entered in the admin UI: DATA_DIR/secrets.json (mode 600), keyed by endpoint so models on one LiteLLM share a key.
// They are never sent back to the browser; only "set, ends with 1234" is.
const secrets = auth.jsonStore(path.join(DATA, 'secrets.json'), () => ({ keys: {} }));
export const keyScope = m => m.baseURL || (m.provider === 'openai' ? 'env:OPENAI_BASE_URL' : 'env:ANTHROPIC_BASE_URL');
async function apiKeyFor(model) {
  if (model.apiKeyEnv) {
    if (!process.env[model.apiKeyEnv]) throw fail(400, `環境變數 ${model.apiKeyEnv} 未設定`);
    return process.env[model.apiKeyEnv];
  }
  // Without a stored key: OPENAI_API_KEY for OpenAI-compatible models; the Anthropic SDK reads ANTHROPIC_API_KEY itself.
  return (await secrets.read()).keys[keyScope(model)]?.key || (model.provider === 'openai' ? process.env.OPENAI_API_KEY : undefined);
}

const OPENAI_EFFORT = { low: 'low', medium: 'medium', high: 'high', xhigh: 'high', max: 'high' }; // xhigh/max: not confirmed to be forwarded
const openaiBase = m => (m.baseURL || process.env.OPENAI_BASE_URL || '').replace(/\/+$/, '');

async function openaiChat(model, effort, system, content, apiKey) {
  const base = openaiBase(model);
  if (!base) throw fail(400, `${model.label} 沒有設定 Endpoint（或環境變數 OPENAI_BASE_URL）`);
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST', signal: AbortSignal.timeout(600_000),
    headers: { 'Content-Type': 'application/json', ...(apiKey && { Authorization: `Bearer ${apiKey}` }) },
    body: JSON.stringify({ model: model.model, ...(model.maxOutput && { max_completion_tokens: model.maxOutput }), reasoning_effort: OPENAI_EFFORT[effort] ?? 'medium',
      messages: [{ role: 'system', content: system }, { role: 'user', content }] }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`${model.label} ${res.status}：${String(body.error?.message ?? res.statusText).slice(0, 200)}`), { upstream: res.status });
  const choice = body.choices?.[0];
  if (choice?.message?.refusal || choice?.finish_reason === 'content_filter') throw new Error(`${model.label} 拒絕處理這段內容`);
  if (choice?.finish_reason === 'length') throw new Error(`${model.label} 的輸出超過上限，請在管理後台提高輸出上限`);
  // LiteLLM reports the real cost of the call in a header.
  return { text: choice?.message?.content ?? '', body, costUsd: Number(res.headers.get('x-litellm-response-cost')) || 0 };
}

// Upstream hiccups (rate limits, 5xx, a stream cut short) are retried; bad requests and refusals are not.
export const isTransient = e => [408, 409, 429, 500, 502, 503, 504, 529].includes(e?.upstream ?? e?.status)
  || /cut short|overloaded|ECONNRESET|socket hang up|fetch failed|terminated/i.test(String(e?.message));
const RETRY_DELAYS = [2000, 8000];

// Call the model's provider; every attempt, failed or not, is recorded in `log`.
// LLM_PROVIDER=openai (npm run start:litellm) sends every model without its own endpoint through the OpenAI-compatible
// OPENAI_BASE_URL, so one LiteLLM serves Claude and GPT alike. Built-in IDs are magpie's; LiteLLM names drop the
// magpie account prefix (codex/gpt-6.1-sol -> gpt-6.1-sol).
export const viaEnv = m => (process.env.LLM_PROVIDER === 'openai' && CALLABLE_VIA_ENV.includes(m.provider) && !m.baseURL
  ? { ...m, provider: 'openai', model: m.model.replace(/^(codex|copilot|devin)\//, '') } : m);
const CALLABLE_VIA_ENV = ['anthropic', 'openai'];

async function llm(system, content, opts = {}) {
  const picked = opts.model ? opts : ai.pickAI(await aiStore.read());
  const { effort } = picked, model = viaEnv(picked.model);
  const { log = [], kind = 'llm' } = opts;
  if (!ai.CALLABLE.includes(model.provider)) throw fail(400, `${model.provider} 尚未支援（規劃中）`);
  ai.checkContext(model, system + content);
  const apiKey = await apiKeyFor(model);
  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    let logged = false; // a refusal arrives after its usage was recorded
    try {
      if (model.provider === 'openai') {
        const { text, body, costUsd } = await openaiChat(model, effort, system, content, apiKey);
        log.push({ ...openaiUsage(body, model, effort, kind, Date.now() - started), ...(costUsd && { costUsd }) }); logged = true;
        return text;
      }
      // Without a per-model endpoint/key, the SDK uses ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY (magpie via npm run start:magpie).
      const msg = await new Anthropic({ ...(model.baseURL && { baseURL: model.baseURL }), ...(apiKey && { apiKey }) }).beta.messages.stream({
        model: model.model,
        max_tokens: model.maxOutput || 64000,
        ...(FALLBACK_MODELS.includes(model.model) && { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }),
        output_config: { effort },
        system,
        messages: [{ role: 'user', content }],
      }).finalMessage();
      log.push(usageOf(msg, model, effort, kind, Date.now() - started)); logged = true;
      if (msg.stop_reason === 'refusal') throw Object.assign(new Error('Claude 拒絕處理這段內容'), { final: true });
      return msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
    } catch (e) {
      if (!logged) log.push({ kind, provider: model.provider, model: model.model, label: model.label, effort, ms: Date.now() - started, at: nowIso(), error: String(e.message).slice(0, 200) });
      if (e.final || attempt >= RETRY_DELAYS.length || !isTransient(e)) throw e;
      await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
    }
  }
}

const CORRECT_SYSTEM = [
  '你是逐字稿校對員。輸入是已轉成台灣繁體的會議逐字稿，每行以 [n] 開頭，可能把專有名詞聽錯。規則：',
  '1. 只有當某段明顯是「術語表」中詞彙的誤聽時，才改成術語表的寫法。',
  '2. 不要增加、刪除或改寫任何其他內容；不要潤飾、不要改語氣、不要補數字或推測；英文保持原樣。',
  '3. 疑似聽錯但無法確定的地方保留原文，並在後面加【?】。',
  '4. 每一行都要輸出，保持 [n] 編號與行數不變；只輸出逐字稿行。',
].join('\n');

// shortcut: one request for the whole transcript; batch by segments if meetings exceed the 64k output budget.
const correctTerms = async (segments, terms, log) => applyNumbered(segments, await llm(CORRECT_SYSTEM,
  `術語表：${terms.join('、')}\n\n<transcript>\n${segments.map((s, i) => `[${i + 1}] ${s.text}`).join('\n')}\n</transcript>`,
  { ...ai.pickFor(await aiStore.read(), 'correct'), log, kind: 'correct' }));

const SUMMARY_SYSTEM = '你是會議記錄助理。根據逐字稿產生 Markdown 會議筆記。只寫逐字稿實際出現的內容，不要推測；沒有明確負責人的待辦寫「未指定」。每個重點、決策與待辦後面用 [n] 標註依據的逐字稿行號。寫中文時一律使用台灣繁體中文與台灣慣用詞。逐字稿中標【?】的地方是辨識不確定的內容，不要當成確定事實；若內容重要，請標註「待確認」。';

async function summarize(m, log) {
  if (!m.segments.length) return { summary: '（逐字稿是空的，沒有可摘要的內容）', summaryBy: null };
  const resolve = resolver(await loadPeople());
  const { model, agent, effort } = ai.pickAI(await aiStore.read(), m.agentId);
  const skills = await Promise.all((agent?.skills ?? []).map(async src => `<skill source="${src}">\n${await ai.loadSkill(src)}\n</skill>`));
  const system = [SUMMARY_SYSTEM, model.systemAddition, agent?.systemPrompt && `這場會議使用「${agent.name}」agent：\n${agent.systemPrompt}`,
    skills.length && `以下 skill 是這類會議的參考做法，整理時遵循其中的檢查項目與用語：\n${skills.join('\n')}`].filter(Boolean).join('\n\n');
  const summary = await llm(system,
    [
        `結構：${TEMPLATES[m.template] ?? TEMPLATES.auto}`,
        m.instructions && `額外指示：${m.instructions}`,
        `輸出語言：${m.outputLang || '與逐字稿主要語言相同'}`,
        '必須包含這些段落：## 摘要、## 重點、## 決策、## 待辦事項（格式：- [ ] 事項 — 負責人 [n]）。',
        m.notes && `<user_notes>\n${m.notes}\n</user_notes>`,
        `參與者（指派待辦負責人時只用這些名字；逐字稿的講者標籤已由使用者校正）：\n${attendees(m).map(n => { const r = resolve(n);
          return `- ${n}${r?.team ? `：${r.team}${r.leader ? `，Y leader ${r.leader}` : ''}` : ''}`; }).join('\n')}`,
        `<transcript>\n${transcriptText(m)}\n</transcript>`,
      ].filter(Boolean).join('\n\n'), { model, effort, log, kind: 'summary' });
  return { summary, summaryBy: { agent: agent?.name ?? '一般會議', model: model.label, effort, at: nowIso() } };
}

// ---- Learning loop (docs/plans/2026-10-21-learning-loop.md): team terms, script check, speaker hints, benchmark ----
const learned = auth.jsonStore(path.join(DATA, 'learned.json'), () => ({ terms: [], rules: [], voices: [], bench: { cases: [], runs: [] } }));
// shortcut: Azure's phrase-list limit is not documented on OpenRouter; cap here until a larger list is measured.
const MAX_PHRASES = 500;

// The meeting's own terms first, then team terms; case-insensitive dedupe.
export function mergeTerms(meetingTerms, teamTerms, max = MAX_PHRASES) {
  const seen = new Set();
  return [...meetingTerms, ...teamTerms].filter(t => { const k = t.toLowerCase(); return !seen.has(k) && seen.add(k); }).slice(0, max);
}
const teamTerms = async () => (await learned.read()).terms.filter(t => t.enabled !== false).map(t => t.term);
const termsFor = async m => mergeTerms(parseTerms(m.glossary), await teamTerms());

// Every term a meeting uses becomes a team term (new ones only), so later meetings get it without retyping.
async function learnTerms(terms, source, userId) {
  if (!terms.length) return;
  await learned.mutate(d => {
    const have = new Set(d.terms.map(t => t.term.toLowerCase()));
    for (const term of terms.map(t => t.slice(0, 60))) {
      if (have.has(term.toLowerCase())) continue;
      have.add(term.toLowerCase());
      d.terms.push({ term, source, addedBy: userId, addedAt: nowIso(), enabled: true });
    }
  });
}

// A Chinese meeting should not contain Hangul or kana; MAI sometimes switches script (플랫폼 for "platform").
const FOREIGN = /[ᄀ-ᇿ぀-ヺー-ヿ㄰-㆏가-힯]+/g; // kana minus the middle dot ・, which Chinese names sometimes use
export const flagForeignScript = text => text.replace(FOREIGN, (run, at, all) => all.startsWith('【?】', at + run.length) ? run : `${run}【?】`);

// Transcribe, then for Taiwan Chinese convert, correct terms and flag foreign script. Shared by processing and the benchmark.
async function transcribeClean(m, log, onCorrecting = () => {}) {
  const { language, segments } = await transcribe(m, log);
  let segs = segments.map(s => ({ ...s, raw: s.text }));
  // Convert only for Taiwan users: zh-TW picked, or Chinese auto-detected (zh-CN keeps Simplified).
  if (m.lang === 'zh-TW' || (m.lang === 'auto' && /^zh/.test(language ?? ''))) {
    segs = segs.map(s => ({ ...s, text: toTaiwan(s.text) }));
    const terms = await termsFor(m);
    if (terms.length && segs.length) {
      await onCorrecting();
      segs = await correctTerms(segs, terms, log);
    }
    segs = segs.map(s => ({ ...s, text: flagForeignScript(s.text) }));
  }
  return { language, segments: segs };
}

const HINT_SYSTEM = [
  '你協助判斷會議逐字稿裡每位匿名講者是誰。只根據逐字稿中的點名線索（例如「謝謝 X」「還給 X」「X 這張」「X 你說」、自我介紹）與發言內容判斷。',
  '只能使用「候選名字」裡的名字；線索不足就不要列出那位講者，寧可不猜。被點名的名字和候選名字不完全相同時（例如 Ken 與 Kenny），視為不同人，不要對應；英文名字的拼法可能因為語音辨識略有不同，但字首與長度要一致。',
  '只輸出 JSON：{"hints":[{"speaker":講者編號,"name":"名字","evidence":[逐字稿行號],"reason":"一句話理由"}]}',
].join('\n');

// Suggest names for unnamed speakers from name cues; the user applies them (nothing is renamed here).
async function suggestSpeakers(m, log) {
  const unnamed = [...new Set(m.segments.map(s => s.speaker))].filter(s => !m.speakers?.[s]);
  const people = await loadPeople(); // Y leaders are people too, and are often the ones being thanked
  const names = [...new Set([...(m.participants ?? []), ...people.map(p => p.name), ...people.map(p => p.leader)].filter(Boolean))].slice(0, 300);
  if (!unnamed.length || !names.length) return [];
  const { model } = ai.pickFor(await aiStore.read(), 'speakers');
  const reply = await llm(HINT_SYSTEM, `候選名字：${names.join('、')}\n\n需要判斷的講者：${unnamed.map(s => `${s}（${speakerName(m, s)}）`).join('、')}\n\n<transcript>\n${transcriptText(m)}\n</transcript>`,
    { model, effort: 'low', log, kind: 'speakers' });
  return cleanHints(reply, unnamed, names, m.segments.length);
}

// Keep only hints for unnamed speakers, with a name from the candidates (matched case-insensitively) and valid line numbers.
export function cleanHints(reply, speakerIds, names, nSegs) {
  let hints;
  try { hints = JSON.parse(String(reply).match(/\{[\s\S]*\}/)?.[0] ?? '').hints; } catch { return []; }
  const byKey = new Map(names.map(n => [n.toLowerCase(), n])), seen = new Set();
  return (Array.isArray(hints) ? hints : []).flatMap(h => {
    const name = byKey.get(String(h?.name ?? '').trim().toLowerCase());
    if (!name || !speakerIds.includes(h?.speaker) || seen.has(h.speaker)) return [];
    seen.add(h.speaker);
    const evidence = (Array.isArray(h.evidence) ? h.evidence : []).filter(n => Number.isInteger(n) && n >= 1 && n <= nSegs).slice(0, 5);
    return [{ speaker: h.speaker, name, evidence, reason: String(h.reason ?? '').slice(0, 200) }];
  });
}

// ---- Benchmark metrics: the user-corrected reference against a fresh run ----
const benchNorm = t => toTaiwan(String(t).replaceAll('【?】', '')).normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

// Character error rate: edit distance between normalized texts divided by the reference length.
export function cer(ref, hyp) {
  const a = [...benchNorm(ref)], b = [...benchNorm(hyp)];
  if (!a.length) return b.length ? 1 : 0;
  let prev = Int32Array.from({ length: b.length + 1 }, (_, j) => j), cur = new Int32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    [prev, cur] = [cur, prev];
  }
  return prev[b.length] / a.length;
}

// Best one-to-one assignment maximizing total weight (Hungarian method); w[i][j] >= 0, returns column per row or -1.
export function bestAssignment(w) {
  const n = Math.max(w.length, w[0]?.length ?? 0), big = Math.max(0, ...w.flat());
  const cost = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => big - (w[i]?.[j] ?? 0)));
  const u = new Array(n + 1).fill(0), v = new Array(n + 1).fill(0), p = new Array(n + 1).fill(0), way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(Infinity), used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const col = new Array(w.length).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j] && p[j] <= w.length && j <= (w[0]?.length ?? 0) && w[p[j] - 1][j - 1] > 0) col[p[j] - 1] = j - 1;
  return col;
}

// Speaker accuracy over time. Output labels and reference names are paired one-to-one to maximize shared time;
// only time where an output segment actually overlaps a reference segment with the paired name counts as correct.
// Reference time no output covers is reported as missed. Overlaps are split at window boundaries (default 15 minutes).
export function speakerAccuracy(ref, hyp, windowSec = 900) {
  const labels = [...new Set(hyp.map(h => String(h.speaker)))], names = [...new Set(ref.map(r => r.speaker))];
  const pieces = []; // [start, end, label, name] for every output/reference overlap
  for (const r of ref) for (const h of hyp) {
    const a = Math.max(r.start, h.start), b = Math.min(r.end, h.end);
    if (b > a) pieces.push([a, b, String(h.speaker), r.speaker]);
  }
  const shared = labels.map(l => names.map(n => pieces.filter(x => x[2] === l && x[3] === n).reduce((t, x) => t + x[1] - x[0], 0)));
  const pair = new Map(bestAssignment(shared).map((j, i) => [labels[i], j >= 0 ? names[j] : null]));
  // Add [a, b) to per-window totals, splitting at window boundaries.
  const win = [], add = (a, b, key) => {
    for (let s = a; s < b;) {
      const w = Math.floor(s / windowSec), e = Math.min(b, (w + 1) * windowSec);
      win[w] ??= { ok: 0, all: 0, covered: 0 };
      win[w][key] += e - s;
      s = e;
    }
  };
  for (const r of ref) add(r.start, r.end, 'all');
  for (const [a, b, label, name] of pieces) { add(a, b, 'covered'); if (pair.get(label) === name) add(a, b, 'ok'); }
  const sum = k => win.reduce((t, x) => t + (x?.[k] ?? 0), 0), pct = (x, y) => (y ? Math.round((x / y) * 1000) / 10 : null);
  const all = sum('all');
  return { accuracy: pct(sum('ok'), all), windows: [...win].map(x => pct(x?.ok ?? 0, x?.all ?? 0)),
    missed: pct(Math.max(0, all - Math.min(all, sum('covered'))), all), labels: labels.length, refSpeakers: names.length };
}

// Reference terms found in the output, counted per occurrence (case-insensitive).
export function termHits(refText, hypText, terms) {
  const count = (t, w) => t.toLowerCase().split(w.toLowerCase()).length - 1;
  let hit = 0, all = 0;
  for (const t of terms) { const n = count(refText, t); all += n; hit += Math.min(n, count(hypText, t)); }
  return { hit, all };
}

export function benchMetrics(refSegs, hypSegs, terms) {
  const refText = refSegs.map(s => s.text).join('\n'), hypText = hypSegs.map(s => s.text).join('\n');
  return { ...speakerAccuracy(refSegs, hypSegs.map(s => ({ ...s, speaker: String(s.speaker) }))), cer: Math.round(cer(refText, hypText) * 1000) / 10,
    terms: termHits(refText, hypText, terms), unsure: (hypText.match(/【\?】/g) ?? []).length };
}

// Re-run the current pipeline on every frozen case; meetings themselves are not modified.
async function runBench(userId) {
  const startedAt = nowIso(), log = [], cases = [];
  const { bench } = await learned.read();
  for (const c of bench.cases) {
    try {
      const m = await load(c.meetingId), ref = JSON.parse(await fsp.readFile(path.join(dir(c.meetingId), 'reference.json'), 'utf8'));
      const { segments } = await transcribeClean({ ...m, glossary: ref.glossary }, log);
      cases.push({ meetingId: c.meetingId, title: m.title, ...benchMetrics(ref.segments, segments, await termsFor({ glossary: ref.glossary })) });
    } catch (e) { cases.push({ meetingId: c.meetingId, error: String(e.message ?? e).slice(0, 200) }); }
  }
  const ok = cases.filter(c => !c.error), avg = f => (ok.length ? Math.round((ok.reduce((a, c) => a + (c[f] ?? 0), 0) / ok.length) * 10) / 10 : null);
  const terms = await teamTerms(), corr = viaEnv(ai.pickFor(await aiStore.read(), 'correct').model);
  // What produced these numbers, so a change in score can be traced to a change in setup.
  const fingerprint = { transcribe: 'microsoft/mai-transcribe-2', correct: `${corr.provider}:${corr.model}`, llmRoute: process.env.LLM_PROVIDER === 'openai' ? 'openai-env' : 'per-model',
    terms: createHash('sha256').update([...terms].sort().join('\n')).digest('hex').slice(0, 8) };
  const run = { startedAt, finishedAt: nowIso(), by: userId, version: pkg.version, teamTerms: terms.length, fingerprint, cases,
    speakerAccuracy: avg('accuracy'), cer: avg('cer'), costUsd: log.reduce((a, e) => a + (e.costUsd ?? 0), 0), ms: log.reduce((a, e) => a + (e.ms ?? 0), 0) };
  await learned.mutate(d => { d.bench.runs = [...d.bench.runs, run].slice(-50); delete d.bench.running; });
  return run;
}

async function processMeeting(id) {
  const log = []; // AI usage of this run, saved even when a later step fails
  try {
    let m = await load(id);
    if (!m.segments.length) {
      await update(id, { status: 'transcribing', error: null });
      const { language, segments } = await transcribeClean(m, log, () => update(id, { status: 'correcting' }));
      m = await update(id, { language, segments, status: 'summarizing' });
    } else {
      m = await update(id, { status: 'summarizing', error: null });
    }
    // Speaker hints are optional: a failure there must not fail the meeting.
    const [{ summary, summaryBy }, speakerHints] = await Promise.all([summarize(m, log), suggestSpeakers(m, log).catch(() => [])]);
    await update(id, cur => ({ summary, summaryBy, speakerHints, actions: parseActions(summary, cur.actions), status: 'done', summaryStale: false }));
  } catch (e) {
    await update(id, { status: 'error', error: String(e.message ?? e) }).catch(() => {});
  } finally {
    if (log.length) await update(id, cur => ({ usage: [...(cur.usage ?? []), ...log] })).catch(() => {});
  }
}

// Meeting time is the user-set scheduledAt (local, no zone) when present, else the upload time.
// scheduledAt is a GMT+8 wall-clock time; normalize to UTC so old "Z" and new "+08:00" stamps sort together.
const when = m => new Date(m.scheduledAt ? `${m.scheduledAt}:00+08:00` : m.createdAt).toISOString();
const meetingDay = m => m.scheduledAt ? m.scheduledAt.slice(0, 10) : localDay(new Date(m.createdAt));
// Speakers in the transcript plus people added by hand who may not have spoken.
const attendees = m => [...new Set([...[...new Set(m.segments.map(s => s.speaker))].sort((a, b) => a - b).map(s => speakerName(m, s)), ...(m.participants ?? [])])];

// ---- People directory: data/directory.json (data/ is gitignored, so real names stay on this machine) ----
const dirFile = () => path.join(DATA, 'directory.json');
const loadDirectory = () => fsp.readFile(dirFile(), 'utf8').then(JSON.parse, e => e.code === 'ENOENT' ? { people: [] } : Promise.reject(e));

// One person per line: 姓名, 團隊, Y leader, 別名1/別名2. Blank lines, # comments and a 姓名/name header are skipped.
export function parseDirectory(csv) {
  const people = [];
  for (const line of String(csv ?? '').split(/\r?\n/).slice(0, 2000)) {
    const [name, team = '', leader = '', aliases = ''] = line.split(/[,，\t]/).map(c => c.trim());
    if (!name || name.startsWith('#') || /^(姓名|name)$/i.test(name)) continue;
    people.push({ name: name.slice(0, 60), team: team.slice(0, 60), leader: leader.slice(0, 60),
      aliases: aliases.split(/[/、;；]/).map(a => a.trim()).filter(Boolean).slice(0, 10) });
  }
  return people;
}
const directoryCsv = people => people.map(p => [p.name, p.team, p.leader, p.aliases.join('/')].join(', ').replace(/(, )+$/, '')).join('\n');

// Name or alias → person; a team name (e.g. owner "SRE") → that team and its most common Y leader.
export function resolver(people) {
  const byName = new Map(), teams = new Map();
  for (const p of people) {
    for (const n of [p.name, ...p.aliases]) byName.set(normQ(n), { person: p.name, team: p.team, leader: p.leader, groups: p.groups ?? [] });
    if (!p.team) continue;
    const t = teams.get(normQ(p.team)) ?? { team: p.team, votes: {} };
    if (p.leader) t.votes[p.leader] = (t.votes[p.leader] ?? 0) + 1;
    teams.set(normQ(p.team), t);
  }
  const teamOf = t => t && { team: t.team, leader: Object.entries(t.votes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '' };
  // Owners are free text ("Platform team（Ken 說明）", "Speaker B（Rex）"): fall back to the longest contained team, then person.
  const longest = keys => [...keys].filter(k => k.length >= 2).sort((a, b) => b.length - a.length);
  const teamKeys = longest(teams.keys()), nameKeys = longest(byName.keys());
  return name => {
    const n = normQ(name);
    return byName.get(n) ?? teamOf(teams.get(n)) ?? teamOf(teams.get(teamKeys.find(k => n.includes(k))))
      ?? byName.get(nameKeys.find(k => n.includes(k))) ?? null;
  };
}

// Directory lookups happen on read, so editing the directory updates every past meeting.
const enrich = (m, resolve) => {
  const people = attendees(m).map(name => ({ name, ...resolve(name) }));
  return {
    ...m, people, teams: [...new Set(people.map(p => p.team).filter(Boolean))], groups: [...new Set(people.flatMap(p => p.groups ?? []))],
    actions: m.actions.map(a => { const r = resolve(a.owner); return { ...a, team: r?.team ?? '', leader: r?.leader ?? '', groups: r?.groups ?? [] }; }),
  };
};
const db = auth.authStore(DATA);
// The CSV directory merged with every user's self-maintained profile (D-013).
const loadPeople = async () => auth.mergePeople((await loadDirectory()).people, (await db.read()).users);
const view = async (m, user) => {
  const v = enrich(withDefaults(m), resolver(await loadPeople()));
  return { ...v, perm: auth.permOf(user, v), access: v.access ?? 'view' };
};

async function loadAll() {
  await fsp.mkdir(DATA, { recursive: true });
  const resolve = resolver(await loadPeople());
  const all = await Promise.all((await meetingIds()).map(d => load(d).catch(() => null)));
  return all.filter(Boolean).map(m => enrich(withDefaults(m), resolve)).sort((a, b) => when(b).localeCompare(when(a)));
}

const visible = async user => (await loadAll()).filter(m => auth.rank(auth.permOf(user, m)) >= auth.rank('view'));
const list = async user => (await visible(user)).map(m => ({
  id: m.id, title: m.title, createdAt: m.createdAt, status: m.status, template: m.template, actions: m.actions,
  scheduledAt: m.scheduledAt, location: m.location, brief: m.brief, tags: m.tags, attendees: attendees(m), people: m.people,
  teams: m.teams, groups: m.groups, perm: auth.permOf(user, m), access: m.access ?? 'view',
}));

// ---- Search ----
const TYPE_NAMES = { auto: '自動', team: '團隊會議', standup: '站立會議', sales: '業務會議' };
// Normalize so Simplified/Traditional and upper/lower case match each other.
const normQ = s => toTaiwan(String(s ?? '').normalize('NFKC').toLowerCase());

export function parseQuery(query) {
  const q = { terms: [], tag: [], who: [], type: [], team: [], leader: [], group: [], after: '', before: '' };
  for (const [, key, val, phrase, word] of String(query ?? '').matchAll(/(tag|who|type|team|leader|group|after|before):("[^"]*"|\S+)|"([^"]*)"|(\S+)/gi)) {
    if (!key) { const t = normQ(phrase ?? word).trim(); if (t) q.terms.push(t); continue; }
    const k = key.toLowerCase(), v = normQ(val.replace(/^"|"$/g, '')).trim();
    if (k === 'after' || k === 'before') q[k] = v;
    else if (v) q[k].push(v);
  }
  return q;
}

const FIELDS = [['title', '標題', 10], ['tags', '標籤', 8], ['brief', '摘要', 6], ['actions', '待辦', 5], ['summary', 'AI 摘要', 4],
  ['notes', '筆記', 3], ['location', '地點', 3], ['attendees', '參與者', 3], ['org', '團隊', 3]];
const orgOf = m => [...(m.people ?? []), ...m.actions].flatMap(x => [x.team, x.leader, ...(x.groups ?? [])]).filter(Boolean);
const fieldText = (m, f) => f === 'tags' ? m.tags.join('、') : f === 'attendees' ? attendees(m).join('、')
  : f === 'org' ? [...new Set(orgOf(m))].join('、')
  : f === 'actions' ? m.actions.map(a => `${a.text}（${a.owner}）`).join('\n')
  : f === 'summary' ? m.summary.replace(/^\s*[-*] \[[ xX]\] |[#*]/gm, '') : String(m[f] ?? '');
// shortcut: index found in normalized text is reused on the original; OpenCC phrase conversions that change length can shift the snippet a little.
function snippet(text, norm, term) {
  const i = Math.max(0, norm.indexOf(term)), s = Math.max(0, i - 30), e = i + term.length + 50;
  return (s ? '…' : '') + text.slice(s, e).replace(/\s+/g, ' ').trim() + (e < text.length ? '…' : '');
}

// shortcut: linear scan over every meeting per query; build an inverted index once there are thousands of meetings.
export function searchMeetings(meetings, query) {
  const q = parseQuery(query);
  const results = [];
  for (const m of meetings) {
    const people = [...attendees(m), ...m.actions.map(a => a.owner)].map(normQ);
    if (!q.tag.every(t => m.tags.some(x => normQ(x) === t))) continue;
    if (!q.who.every(w => people.some(p => p.includes(w)))) continue;
    if (q.type.length && !q.type.some(t => m.template === t || normQ(TYPE_NAMES[m.template]).includes(t))) continue;
    const teams = [...(m.people ?? []), ...m.actions].map(x => normQ(x.team)).filter(Boolean);
    const leaders = [...(m.people ?? []), ...m.actions].map(x => normQ(x.leader)).filter(Boolean);
    if (!q.team.every(t => teams.some(x => x.includes(t)))) continue;
    if (!q.leader.every(l => leaders.some(x => x.includes(l)))) continue;
    const groups = [...(m.people ?? []), ...m.actions].flatMap(x => x.groups ?? []).map(normQ);
    if (!q.group.every(g => groups.some(x => x.includes(g)))) continue;
    const day = meetingDay(m);
    if ((q.after && day < q.after) || (q.before && day > q.before)) continue;
    const found = new Set(), hits = [];
    let score = 0;
    for (const [field, label, weight] of FIELDS) {
      const text = fieldText(m, field), norm = normQ(text), ts = q.terms.filter(t => norm.includes(t));
      if (!ts.length) continue;
      ts.forEach(t => found.add(t));
      score += weight * ts.length;
      hits.push({ field, label, snippet: snippet(text, norm, ts[0]) });
    }
    const segHits = [];
    m.segments.forEach((s, i) => {
      const norm = normQ(s.text), ts = q.terms.filter(t => norm.includes(t));
      if (!ts.length) return;
      ts.forEach(t => found.add(t));
      segHits.push({ field: 'transcript', label: '逐字稿', seg: i + 1, at: s.start, speaker: speakerName(m, s.speaker), snippet: snippet(s.text, norm, ts[0]) });
    });
    if (found.size < q.terms.length) continue; // every term must appear somewhere in the meeting
    results.push({ id: m.id, title: m.title, day, scheduledAt: m.scheduledAt, createdAt: m.createdAt, tags: m.tags, template: m.template, teams: m.teams ?? [],
      score: score + Math.min(segHits.length, 5), transcriptHits: segHits.length, hits: [...hits, ...segHits.slice(0, 5)] });
  }
  return { terms: q.terms, results: results.sort((a, b) => b.score - a.score) }; // stable sort keeps newest first on ties
}

async function create(req, url, user) {
  const name = path.basename(url.searchParams.get('filename') || 'recording.webm');
  const lang = url.searchParams.get('lang') || 'zh-TW';
  if (!LANG.test(lang)) throw Object.assign(new Error('lang 格式錯誤'), { status: 400 });
  const id = randomUUID();
  const file = `recording${extOf(name)}`;
  dirs.set(id, path.join(DATA, localDay(), id));
  await fsp.mkdir(dir(id), { recursive: true });
  await pipeline(req, fs.createWriteStream(path.join(dir(id), file)));
  const m = {
    id, title: url.searchParams.get('title') || name, createdAt: nowIso(),
    originalName: name, file, mime: req.headers['content-type'] || 'application/octet-stream', lang,
    glossary: url.searchParams.get('glossary') ?? '',
    status: 'transcribing', error: null, language: null, segments: [], speakers: {},
    notes: '', summary: '', template: 'auto', instructions: '', outputLang: '',
    scheduledAt: '', location: '', brief: '', tags: [], ...cleanMeta(Object.fromEntries(url.searchParams)),
    ownerId: user.id, access: auth.ACCESS.includes(url.searchParams.get('access')) ? url.searchParams.get('access') : 'view',
    agentId: cleanAgentId(url.searchParams.get('agentId')),
    grants: [], comments: [],
  };
  await save(m);
  await learnTerms(parseTerms(m.glossary), `meeting:${id}`, user.id);
  processMeeting(id);
  return m;
}

async function readJson(req) {
  let body = '';
  for await (const c of req) {
    body += c;
    if (body.length > 1e6) throw Object.assign(new Error('body too large'), { status: 413 });
  }
  return JSON.parse(body || '{}');
}

async function sendAudio(req, res, m, download) {
  const file = path.join(dir(m.id), m.file);
  const { size } = await fsp.stat(file);
  const headers = { 'Content-Type': m.mime, 'Accept-Ranges': 'bytes' };
  if (download) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(m.originalName)}`;
  const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (r && !download) {
    const start = r[1] ? +r[1] : Math.max(0, size - +r[2]);
    const end = r[1] && r[2] ? Math.min(+r[2], size - 1) : size - 1;
    if (start >= size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    return pipeline(fs.createReadStream(file, { start, end }), res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  return pipeline(fs.createReadStream(file), res);
}

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
};
const fail = (status, message) => Object.assign(new Error(message), { status });
const need = (ok, status = 403, message = '沒有權限') => { if (!ok) throw fail(status, message); };
const USERNAME = /^[a-zA-Z0-9._-]{3,32}$/;
const cleanAgentId = v => String(v ?? '').replace(/[^\w-]/g, '').slice(0, 40);

// Admin view of the AI settings: each model says whether a key is stored for its endpoint, never the key itself.
async function withKeyStatus(cfg) {
  const { keys } = await secrets.read();
  return { ...cfg, viaOpenAI: process.env.LLM_PROVIDER === 'openai' ? openaiBase({}) : '', models: cfg.models.map(m => {
    const k = keys[keyScope(m)];
    return { ...m, keyStatus: k ? { set: true, last4: k.key.slice(-4), setAt: k.setAt } : { set: false } };
  }) };
}

async function testModel(id) {
  const model = ai.withBuiltins(await aiStore.read()).models.find(m => m.id === id);
  need(model, 404, '模型不存在');
  const started = Date.now(), log = [];
  let test;
  try {
    const reply = await llm('你是連線測試。', '請只回答 OK。', { model: { ...model, maxOutput: 2048 }, effort: 'low', log, kind: 'test' });
    test = { ok: true, reply: reply.slice(0, 40) };
  } catch (e) { test = { ok: false, error: String(e.message).slice(0, 300) }; }
  test.usage = log.at(-1) ?? null; // the last attempt; earlier ones may be retried failures
  Object.assign(test, { at: nowIso(), latencyMs: Date.now() - started });
  await aiStore.mutate(d => { Object.assign(d, ai.withBuiltins(d)); d.models.find(m => m.id === id).test = test; });
  return test;
}

// /api/auth, /api/me, /api/admin, /api/shares. Sends nothing when the path is not an account route.
async function accountRoute(req, res, url, user) {
  const [, , coll, a, b, c, d] = url.pathname.split('/');
  const userCookie = u => ({ 'Set-Cookie': auth.sessionCookie(auth.createSession(u.id)) });
  if (coll === 'auth') {
    if (a === 'me' && req.method === 'GET') {
      const { settings, users } = await db.read();
      return send(res, 200, { user: auth.publicUser(user), registration: settings.registration || !users.length, needsSetup: !users.length,
        app: { version: pkg.version, repo: pkg.repository } });
    }
    if (a === 'register' && req.method === 'POST') {
      const { username, password, displayName } = await readJson(req);
      need(USERNAME.test(username ?? ''), 400, '帳號需為 3–32 個英數字或 . _ -');
      need(String(password ?? '').length >= 8 && String(password).length <= 200, 400, '密碼至少 8 個字');
      const u = await db.mutate(d => {
        need(d.settings.registration || !d.users.length, 403, '目前不開放註冊');
        need(!d.users.some(x => x.username.toLowerCase() === username.toLowerCase()), 409, '帳號已存在');
        const nu = { id: randomUUID(), username, displayName: String(displayName || username).trim().slice(0, 60), role: d.users.length ? 'member' : 'admin',
          createdAt: nowIso(), profile: auth.cleanProfile(), ...auth.hashPassword(password) };
        d.users.push(nu);
        return nu;
      });
      if (u.role === 'admin') await adoptOrphanMeetings(u.id);
      return send(res, 201, { user: auth.publicUser(u) }, userCookie(u));
    }
    if (a === 'login' && req.method === 'POST') {
      const { username, password } = await readJson(req);
      const key = String(username ?? '').toLowerCase();
      need(!auth.loginLocked(key), 429, '登入失敗太多次，請一分鐘後再試');
      const u = (await db.read()).users.find(x => x.username.toLowerCase() === key);
      if (!u || !auth.verifyPassword(password ?? '', u)) { auth.loginFailed(key); throw fail(401, '帳號或密碼錯誤'); }
      auth.loginOk(key);
      return send(res, 200, { user: auth.publicUser(u) }, userCookie(u));
    }
    if (a === 'logout' && req.method === 'POST') {
      auth.endSession(req.headers.cookie);
      return send(res, 200, { ok: true }, { 'Set-Cookie': auth.sessionCookie('') });
    }
  }
  need(user, 401, '請先登入');
  if (coll === 'me' && req.method === 'PUT' && a === 'profile') {
    const body = await readJson(req);
    const u = await db.mutate(d => {
      const x = d.users.find(v => v.id === user.id);
      if (body.displayName !== undefined) x.displayName = String(body.displayName).trim().slice(0, 60) || x.username;
      x.profile = auth.cleanProfile({ ...x.profile, ...body });
      return x;
    });
    return send(res, 200, { user: auth.publicUser(u) });
  }
  if (coll === 'me' && req.method === 'PUT' && a === 'password') {
    const { current, next } = await readJson(req);
    need(String(next ?? '').length >= 8 && String(next).length <= 200, 400, '新密碼至少 8 個字');
    await db.mutate(d => {
      const x = d.users.find(v => v.id === user.id);
      need(auth.verifyPassword(current ?? '', x), 401, '目前密碼錯誤');
      Object.assign(x, auth.hashPassword(next), { mustChangePassword: false });
    });
    return send(res, 200, { ok: true });
  }
  if (coll === 'shares' && a) {
    const share = (await db.read()).shares.find(s => s.token === a);
    need(share && !share.revokedAt, 404, '分享連結不存在或已撤銷');
    if (req.method === 'POST') { // open a link: grant its permission to the signed-in user
      await db.mutate(d => { const s = d.shares.find(x => x.token === a); s.uses = (s.uses ?? 0) + 1; s.lastUsedAt = nowIso(); });
      const m = await load(share.meetingId);
      if (auth.rank(auth.permOf(user, m)) < auth.rank(share.perm)) {
        await update(m.id, cur => ({ grants: [...(cur.grants ?? []).filter(g => !(g.userId === user.id && g.token === a)), { userId: user.id, perm: share.perm, token: a }] }));
      }
      return send(res, 200, { id: share.meetingId });
    }
    if (req.method === 'DELETE') {
      need(user.role === 'admin' || share.createdBy === user.id || (await load(share.meetingId)).ownerId === user.id);
      return send(res, 200, await revokeShare(a));
    }
  }
  if (coll === 'admin') {
    need(user.role === 'admin');
    if (!a && req.method === 'GET') {
      const d = await db.read(), titles = Object.fromEntries((await loadAll()).map(m => [m.id, m.title])), nameOf = id => d.users.find(u => u.id === id)?.displayName ?? '（已刪除）';
      const all = await loadAll(), cfg = ai.withBuiltins(await aiStore.read());
      const entries = [...all.flatMap(m => m.usage ?? []), ...cfg.models.map(m => m.test?.usage).filter(Boolean)];
      const usage = { total: aggregateUsage(entries, () => 'all')[0] ?? null,
        byModel: aggregateUsage(entries, e => e.label ? `${e.label}（${e.model}）` : e.model).sort((x, y) => y.calls - x.calls),
        byDay: aggregateUsage(entries, e => localDay(new Date(e.at))).sort((x, y) => y.key.localeCompare(x.key)).slice(0, 30),
        byKind: aggregateUsage(entries, e => e.kind) };
      return send(res, 200, { usage, settings: d.settings, users: d.users.map(auth.publicUser),
        shares: d.shares.map(s => ({ ...s, meetingTitle: titles[s.meetingId] ?? '（會議已刪除）', createdByName: nameOf(s.createdBy) })) });
    }
    if (a === 'settings' && req.method === 'PUT') {
      const { registration } = await readJson(req);
      return send(res, 200, await db.mutate(d => { d.settings.registration = registration === true; return d.settings; }));
    }
    if (a === 'users' && b && !c && req.method === 'PUT') {
      const { role } = await readJson(req);
      need(auth.ROLES.includes(role), 400, '角色不存在');
      const u = await db.mutate(d => {
        need(!(b === user.id && role !== 'admin'), 400, '不能移除自己的管理員權限');
        const x = d.users.find(v => v.id === b); need(x, 404, '使用者不存在');
        x.role = role;
        return x;
      });
      return send(res, 200, { user: auth.publicUser(u) });
    }
    if (a === 'ai' && !b && req.method === 'PUT') {
      const body = await readJson(req);
      const models = (Array.isArray(body.models) ? body.models : []).slice(0, 50).map(ai.cleanModel);
      const agents = (Array.isArray(body.agents) ? body.agents : []).slice(0, 200).map(ai.cleanAgent);
      const def = models.find(m => m.default && m.enabled) ?? models.find(m => m.enabled && ai.CALLABLE.includes(m.provider));
      models.forEach(m => { m.default = m === def; });
      const saved = await aiStore.mutate(store => { Object.assign(store, { models, agents, uses: ai.cleanUses(body.uses) }); return ai.withBuiltins(store); });
      return send(res, 200, await withKeyStatus(saved));
    }
    // Write-only API key for a model's endpoint; an empty key removes it.
    if (a === 'ai' && b === 'keys' && req.method === 'PUT') {
      const { modelId, key } = await readJson(req);
      const model = ai.withBuiltins(await aiStore.read()).models.find(m => m.id === modelId);
      need(model, 404, '模型不存在');
      const value = String(key ?? '').trim();
      need(value.length <= 500 && !/\s/.test(value), 400, 'API key 格式不正確');
      await secrets.mutate(d => {
        if (value) d.keys[keyScope(model)] = { key: value, setAt: nowIso(), setBy: user.id };
        else delete d.keys[keyScope(model)];
      });
      return send(res, 200, await withKeyStatus(ai.withBuiltins(await aiStore.read())));
    }
    // Model IDs the endpoint offers (OpenAI-compatible GET /models), so admins pick instead of typing.
    if (a === 'ai' && b === 'models' && c && d === 'list' && req.method === 'POST') {
      const found = ai.withBuiltins(await aiStore.read()).models.find(m => m.id === c);
      need(found, 404, '模型不存在');
      const model = viaEnv(found);
      need(model.provider === 'openai', 400, '只有 OpenAI 相容端點能讀取模型清單');
      const base = openaiBase(model), apiKey = await apiKeyFor(model);
      need(base, 400, '沒有設定 Endpoint（或環境變數 OPENAI_BASE_URL）');
      const r = await fetch(`${base}/models`, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, signal: AbortSignal.timeout(15_000) });
      need(r.ok, 502, `讀取模型清單失敗（HTTP ${r.status}）`);
      return send(res, 200, { models: ((await r.json()).data ?? []).map(x => String(x.id)).filter(Boolean).sort().slice(0, 2000) });
    }
    if (a === 'ai' && b === 'models' && c && d === 'test' && req.method === 'POST') return send(res, 200, await testModel(c));
    if (a === 'users' && b && c === 'reset-password' && req.method === 'POST') {
      const temp = randomBytes(9).toString('base64url'); // shown once to the admin, who passes it on
      await db.mutate(d => { const x = d.users.find(v => v.id === b); need(x, 404, '使用者不存在'); Object.assign(x, auth.hashPassword(temp), { mustChangePassword: true }); });
      auth.endUserSessions(b);
      return send(res, 200, { password: temp });
    }
  }
  return undefined;
}

async function revokeShare(token) {
  const share = await db.mutate(d => { const s = d.shares.find(x => x.token === token); s.revokedAt ??= nowIso(); return s; });
  const m = await load(share.meetingId).catch(() => null);
  if (m) await update(m.id, cur => ({ grants: (cur.grants ?? []).filter(g => g.token !== token) }));
  return share;
}

// The first admin takes over meetings created before accounts existed.
async function adoptOrphanMeetings(userId) {
  await fsp.mkdir(DATA, { recursive: true });
  for (const d of await meetingIds()) {
    const m = await load(d).catch(() => null);
    if (m && !m.ownerId) await update(d, { ownerId: userId });
  }
}

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (EMBEDDED_UI) return res.end(EMBEDDED_UI);
    return pipeline(fs.createReadStream(path.join(ROOT, 'public', 'index.html')), res);
  }
  // Cookies are SameSite=Lax; also refuse cross-origin writes outright.
  if (req.method !== 'GET' && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(res, 403, { error: 'cross-origin request' });
  const uid = auth.sessionUserId(req.headers.cookie);
  const user = uid && (await db.read()).users.find(u => u.id === uid);
  const [, api, coll, id, action] = url.pathname.split('/');
  if (api !== 'api') return send(res, 404, { error: 'not found' });
  if (['auth', 'me', 'admin', 'shares'].includes(coll)) {
    await accountRoute(req, res, url, user);
    if (res.headersSent) return;
  }
  need(user, 401, '請先登入');
  if (coll === 'ai' && !id && req.method === 'GET') {
    const cfg = ai.withBuiltins(await aiStore.read());
    if (user.role === 'admin') return send(res, 200, await withKeyStatus(cfg));
    return send(res, 200, { models: cfg.models.filter(m => m.enabled).map(({ id: mid, label, provider, model, default: def }) => ({ id: mid, label, provider, model, default: def })),
      agents: cfg.agents.filter(x => x.enabled).map(({ id: aid, name, description }) => ({ id: aid, name, description })) });
  }
  if (coll === 'search' && !id && req.method === 'GET') return send(res, 200, searchMeetings(await visible(user), url.searchParams.get('q')));
  if (coll === 'directory' && !id) {
    if (req.method === 'PUT') {
      need(user.role === 'admin', 403, '只有管理員能修改名錄');
      const people = parseDirectory((await readJson(req)).csv);
      await fsp.mkdir(DATA, { recursive: true });
      await fsp.writeFile(`${dirFile()}.tmp`, JSON.stringify({ people }, null, 2));
      await fsp.rename(`${dirFile()}.tmp`, dirFile());
    }
    if (req.method === 'PUT' || req.method === 'GET') {
      const { people } = await loadDirectory();
      return send(res, 200, { people: await loadPeople(), csv: directoryCsv(people) });
    }
  }
  if (coll === 'learned') {
    const isAdmin = user.role === 'admin';
    if (!id && req.method === 'GET') {
      const d = await learned.read();
      return send(res, 200, isAdmin ? d : { terms: d.terms.filter(t => t.enabled !== false).map(t => ({ term: t.term })) });
    }
    if (id === 'terms' && req.method === 'POST') {
      need(user.role !== 'readonly', 403, '唯讀帳號不能新增術語');
      const terms = parseTerms((await readJson(req)).term);
      need(terms.length, 400, '術語不能是空的');
      await learnTerms(terms, 'manual', user.id);
      return send(res, 201, { terms });
    }
    if (id === 'terms' && ['PATCH', 'DELETE'].includes(req.method)) {
      need(isAdmin, 403, '只有管理員能停用或刪除團隊術語');
      const body = req.method === 'PATCH' ? await readJson(req) : { term: url.searchParams.get('term') };
      const key = String(body.term ?? '').toLowerCase();
      await learned.mutate(d => {
        d.terms = req.method === 'DELETE' ? d.terms.filter(t => t.term.toLowerCase() !== key)
          : d.terms.map(t => (t.term.toLowerCase() === key ? { ...t, enabled: body.enabled === true } : t));
      });
      return send(res, 200, await learned.read());
    }
    if (id === 'bench' && req.method === 'POST') {
      need(isAdmin, 403, '只有管理員能執行 benchmark');
      const state = await learned.mutate(d => {
        if (!d.bench.cases.length) return 'empty';
        if (d.bench.running) return 'busy';
        d.bench.running = { startedAt: nowIso(), by: user.id };
        return 'ok';
      });
      need(state !== 'empty', 400, '還沒有凍結的 benchmark 會議');
      need(state !== 'busy', 409, 'benchmark 正在執行');
      runBench(user.id).catch(e => learned.mutate(d => { delete d.bench.running; d.bench.lastError = String(e.message ?? e); }));
      return send(res, 202, { started: true });
    }
  }
  if (coll !== 'meetings') return send(res, 404, { error: 'not found' });
  if (!id && req.method === 'GET') return send(res, 200, await list(user));
  if (!id && req.method === 'POST') {
    need(user.role !== 'readonly', 403, '唯讀帳號不能建立會議');
    return send(res, 201, await create(req, url, user));
  }
  if (!ID.test(id ?? '')) return send(res, 404, { error: 'not found' });

  const m = await load(id);
  const perm = auth.permOf(user, m), can = level => auth.rank(perm) >= auth.rank(level);
  need(can('view'), 404, 'not found'); // don't reveal meetings the user cannot see
  if (!action && req.method === 'GET') return send(res, 200, await view(m, user));
  if (!action && req.method === 'PATCH') {
    const body = await readJson(req);
    const { title, notes, glossary, actions, access, agentId } = body;
    const speakers = cleanSpeakers(body.speakers);
    if (access !== undefined) need(can('owner') && auth.ACCESS.includes(access), 403, '只有擁有者能變更權限');
    const patch = Object.fromEntries(Object.entries({ title, speakers, notes, glossary, actions: cleanActions(actions), agentId: agentId === undefined ? undefined : cleanAgentId(agentId), ...cleanMeta(body) })
      .filter(([, v]) => v !== undefined));
    if (Object.keys(patch).length || body.segSpeakers !== undefined) need(can('edit'), 403, '你只有檢視或留言權限');
    if (glossary !== undefined) await learnTerms(parseTerms(glossary), `meeting:${id}`, user.id);
    return send(res, 200, await view(await update(id, cur => {
      const segments = reassignSpeakers(cur.segments, body.segSpeakers); // against the current transcript, inside the write queue
      // Who said what changed after the summary was written: flag it so the UI offers a regenerate.
      const stale = cur.summary && (speakers || segments || patch.participants);
      return { ...patch, ...(segments && { segments }), ...(stale && { summaryStale: true }), ...(access !== undefined && { access }) };
    }), user));
  }
  if (action === 'audio' && req.method === 'GET') return sendAudio(req, res, m, url.searchParams.has('download'));
  if (action === 'comments' && req.method === 'POST') {
    need(can('comment'), 403, '你沒有留言權限');
    const { text, seg } = await readJson(req);
    need(String(text ?? '').trim(), 400, '留言不能是空的');
    const comment = { id: randomUUID(), userId: user.id, name: user.displayName, text: String(text).trim().slice(0, 2000),
      seg: Number.isInteger(seg) ? seg : null, createdAt: nowIso() };
    return send(res, 201, await view(await update(id, cur => ({ comments: [...(cur.comments ?? []), comment] })), user));
  }
  if (action === 'comments' && req.method === 'DELETE') {
    const cid = url.searchParams.get('id'), target = (m.comments ?? []).find(c => c.id === cid);
    need(target, 404, '留言不存在');
    need(target.userId === user.id || can('owner'));
    return send(res, 200, await view(await update(id, cur => ({ comments: (cur.comments ?? []).filter(c => c.id !== cid) })), user));
  }
  if (action === 'shares') {
    need(can('owner'), 403, '只有擁有者能管理分享');
    if (req.method === 'POST') {
      const { perm: p = 'view' } = await readJson(req);
      need(['view', 'comment', 'edit'].includes(p), 400, '權限不存在');
      const share = { token: randomBytes(24).toString('base64url'), meetingId: id, perm: p, createdBy: user.id, createdAt: nowIso(), uses: 0 };
      await db.mutate(d => { d.shares.push(share); });
      return send(res, 201, share);
    }
    if (req.method === 'GET') return send(res, 200, (await db.read()).shares.filter(s => s.meetingId === id));
  }
  if (action === 'benchmark') {
    need(can('owner'), 403, '只有擁有者能設定 benchmark');
    const ref = path.join(dir(id), 'reference.json');
    if (req.method === 'POST') {
      need(m.status === 'done' && m.segments.length, 409, '會議處理完成後才能凍結');
      // Freeze what the user corrected: speaker names and text, without uncertainty marks.
      await fsp.writeFile(ref, JSON.stringify({ frozenAt: nowIso(), frozenBy: user.id, lang: m.lang, glossary: m.glossary,
        segments: m.segments.map(s => ({ start: s.start, end: s.end, speaker: speakerName(m, s.speaker), text: s.text.replaceAll('【?】', '') })) }, null, 2));
      await learned.mutate(d => { d.bench.cases = [...d.bench.cases.filter(c => c.meetingId !== id), { meetingId: id, frozenAt: nowIso(), frozenBy: user.id }]; });
      return send(res, 200, await view(await update(id, { benchmarkAt: nowIso() }), user));
    }
    if (req.method === 'DELETE') {
      await fsp.rm(ref, { force: true });
      await learned.mutate(d => { d.bench.cases = d.bench.cases.filter(c => c.meetingId !== id); });
      return send(res, 200, await view(await update(id, { benchmarkAt: null }), user));
    }
  }
  need(can('edit'), 403, '你只有檢視或留言權限');
  if (action === 'summarize' && req.method === 'POST') {
    if (['transcribing', 'correcting', 'summarizing'].includes(m.status)) return send(res, 409, { error: '處理中，請稍候' });
    const { template = 'auto', instructions = '', outputLang = '', retranscribe = false, agentId } = await readJson(req);
    if (!TEMPLATES[template]) return send(res, 400, { error: 'template 不存在' });
    const updated = await update(id, {
      template, instructions: String(instructions), outputLang: String(outputLang), ...(agentId !== undefined && { agentId: cleanAgentId(agentId) }),
      ...(retranscribe && { segments: [] }),
    });
    processMeeting(id);
    return send(res, 202, updated);
  }
  send(res, 405, { error: 'method not allowed' });
}

export const server = http.createServer((req, res) =>
  route(req, res).catch(e => {
    if (res.headersSent) return res.destroy();
    send(res, e.code === 'ENOENT' ? 404 : e.status ?? (e instanceof SyntaxError ? 400 : 500), { error: e.message });
  }));

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3000);
  const moved = await migrateLayout();
  if (moved) console.log(`moved ${moved} meeting folder(s) into data/<YYYY-MM-DD>/`);
  // Bind to localhost only (D-008, D-013): accounts exist, but there is no TLS or hardening for network exposure.
  server.listen(port, '127.0.0.1', () => console.log(`notion-meetings v${pkg.version}  http://localhost:${port}  (data: ${DATA})`));
}
