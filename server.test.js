import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { loadMarkdownRuntime } from './ui-assets.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'meetings-'));
process.env.OPENROUTER_API_KEY = ''; // never call the real API from tests
const ai = await import('./ai.js');
const { parseTranscription, transcriptText, extOf, toTaiwan, parseTerms, applyNumbered, keepTermEdits, aliasLines, parseActions, cleanMeta, parseQuery, searchMeetings, parseDirectory, resolver, usageOf, aggregateUsage, migrateLayout, reassignSpeakers, openaiUsage, isTransient, keyScope, viaEnv, apiKeyFor, llmKeyMissing, knowledgeText, RETRY, mergeTerms, flagForeignScript, cleanHints, cer, speakerAccuracy, bestAssignment, termHits, localDay, nowIso, searchMeetings: search2, server } = await import('./server.js');

test('parseTranscription maps verbose_json segments to speaker segments', () => {
  const r = parseTranscription({ language: 'zh', segments: [
    { start: 1.2, end: 3, speaker: 1, text: ' 大家好 ' }, { start: 65, end: 70, text: 'Hi' }] });
  assert.equal(r.language, 'zh');
  assert.equal(transcriptText({ segments: r.segments, speakers: { 0: 'Amy' } }), '[1] 00:01 Speaker B: 大家好\n[2] 01:05 Amy: Hi');
  assert.deepEqual(parseTranscription({}).segments, []);
  const u = parseTranscription({ duration: 70, usage: { seconds: 70, cost: 0.0019 } });
  assert.deepEqual([u.audioSeconds, u.costUsd], [70, 0.0019]);
});

test('reassignSpeakers moves only valid segment indexes to valid speakers', () => {
  const segs = [{ speaker: 0, text: 'a' }, { speaker: 1, text: 'b' }, { speaker: 0, text: 'c' }];
  assert.deepEqual(reassignSpeakers(segs, { 0: 2, 1: -1, 2: '1', 9: 1 }).map(s => s.speaker), [2, 1, 0]);
  assert.equal(reassignSpeakers(segs, undefined), undefined);
  assert.deepEqual(cleanMeta({ participants: 'Amy、Bob, Amy' }), { participants: ['Amy', 'Bob'] });
});

test('learning loop: term merge, foreign-script flag, speaker hints, benchmark metrics', () => {
  assert.deepEqual(mergeTerms(['EKS', 'IRSA'], ['eks', 'Bastion', 'IRSA'], 3), ['EKS', 'IRSA', 'Bastion'], 'meeting spelling wins, case-insensitive dedupe, capped');
  assert.equal(flagForeignScript('這個플랫폼 team 跟 カード'), '這個플랫폼【?】 team 跟 カード【?】');
  assert.equal(flagForeignScript('플랫폼【?】 與 王・小明'), '플랫폼【?】 與 王・小明', 'no double mark; the middle dot is not foreign');

  const reply = 'ok {"hints":[{"speaker":1,"name":"amy chen","evidence":[2,99],"reason":"謝謝 Amy"},{"speaker":1,"name":"Bob"},{"speaker":2,"name":"Nobody"},{"speaker":0,"name":"Bob"}]}';
  assert.deepEqual(cleanHints(reply, [1, 2], ['Amy Chen', 'Bob'], 10), [{ speaker: 1, name: 'Amy Chen', evidence: [2], reason: '謝謝 Amy' }],
    'only unnamed speakers, candidate names, one hint per speaker, valid lines');
  assert.deepEqual(cleanHints('not json', [1], ['Amy'], 3), []);

  assert.equal(cer('今天 EKS 升級。', '今天eks升級'), 0, 'case, spaces and punctuation are ignored');
  assert.equal(Math.round(cer('abcd', 'abxd') * 100), 25);
  const ref = [{ start: 0, end: 10, speaker: 'Amy' }, { start: 10, end: 20, speaker: 'Bob' }, { start: 900, end: 910, speaker: 'Amy' }];
  const hyp = [{ start: 0, end: 10, speaker: '0' }, { start: 10, end: 20, speaker: '1' }, { start: 900, end: 910, speaker: '1' }];
  assert.deepEqual(speakerAccuracy(ref, hyp), { accuracy: 66.7, windows: [100, 0], missed: 0, labels: 2, refSpeakers: 2, refSeconds: 30 }, 'a drifted label counts as wrong in its window');
  assert.deepEqual(speakerAccuracy([{ start: 0, end: 10, speaker: 'Amy' }], [{ start: 0, end: 1, speaker: '0' }]),
    { accuracy: 10, windows: [10], missed: 90, labels: 1, refSpeakers: 1, refSeconds: 10 }, 'only the covered second counts; the rest is missed');
  assert.deepEqual(speakerAccuracy([{ start: 890, end: 910, speaker: 'Amy' }], [{ start: 890, end: 910, speaker: '0' }]).windows.slice(-2), [100, 100],
    'speech across a window boundary is split between the windows');
  // Greedy pairing would give label 0 to Bob (its largest share) and leave Amy unmatched; the best assignment pairs 0→Amy, 1→Bob.
  const g = speakerAccuracy([{ start: 0, end: 6, speaker: 'Amy' }, { start: 6, end: 13, speaker: 'Bob' }, { start: 13, end: 18, speaker: 'Bob' }],
    [{ start: 0, end: 13, speaker: '0' }, { start: 13, end: 18, speaker: '1' }]);
  assert.equal(g.accuracy, 61.1, 'one-to-one pairing that maximizes total shared time');
  // Overlapping or duplicated output segments count once (0.6.1).
  const amy = [{ start: 0, end: 10, speaker: 'Amy' }];
  assert.deepEqual([speakerAccuracy(amy, [{ start: 0, end: 5, speaker: '0' }, { start: 0, end: 5, speaker: '1' }])].map(x => [x.accuracy, x.missed]), [[50, 50]],
    'two labels on the same 5 seconds: half the speech is missed');
  assert.equal(speakerAccuracy(amy, [{ start: 0, end: 10, speaker: '0' }, { start: 0, end: 10, speaker: '0' }]).accuracy, 100, 'a duplicated segment never exceeds 100%');
  assert.deepEqual(bestAssignment([[6, 7], [0, 5]]), [0, 1]);
  assert.deepEqual(bestAssignment([[0, 0], [3, 0]]), [-1, 0], 'labels with no shared time stay unpaired');
  assert.deepEqual(termHits('EKS 和 eks 與 IRSA', 'EKS 與 irsa', ['EKS', 'IRSA']), { hit: 2, all: 3 });
});

test('toTaiwan converts script and Taiwan wording, leaves English alone', () => {
  assert.equal(toTaiwan('这个软件的默认设置在数据库里，PgBouncer 要调整'), '這個軟體的預設設定在資料庫裡，PgBouncer 要調整');
});

test('parseTerms splits on commas, Chinese punctuation and newlines', () => {
  assert.deepEqual(parseTerms('Karpenter, IRSA、二代健保\n\nIRSA；PgBouncer'), ['Karpenter', 'IRSA', '二代健保', 'PgBouncer']);
});

test('applyNumbered only replaces lines the model returned, in range', () => {
  const segs = [{ text: 'a', speaker: 0 }, { text: 'b', speaker: 1 }];
  const out = applyNumbered(segs, 'Sure:\n[2] B fixed【?】\n[3] extra\n[1] ');
  assert.deepEqual(out.map(s => s.text), ['a', 'B fixed【?】']);
  assert.equal(out[1].speaker, 1);
});

test('keepTermEdits keeps only edits into a glossary term or added 【?】, edit by edit', () => {
  const terms = ['Bastion', 'cron job', 'EKS'];
  const ok = (a, b) => assert.equal(keepTermEdits(a, b, terms), b, `${a} → ${b}`);
  const no = (a, b) => assert.equal(keepTermEdits(a, b, terms), a, `${a} ↛ ${b}`);
  ok('先連 Bation 再看', '先連 Bastion 再看');
  ok('那個 clone job 掛了', '那個 cron job 掛了');
  ok('升級 E case 叢集', '升級 EKS 叢集');
  ok('Ba stion 上面', 'Bastion 上面');
  ok('好像是 Postres', '好像是 Postres【?】');
  no('好像是 OAuth', '好像是 Postgres'); // Postgres is not in the list: a guess, not a correction
  no('先連 Bation 再看', '先連 Bastion 主機再看'); // extra word
  no('我們明天看', '我們明天看 EKS'); // a term added out of nothing
  no('EKS cluster 升級', 'EKS 升級'); // dropping a correct alias word
  no('這個先不要動', '這個先暫緩【?】'); // rewording
  no('連到 主機', '連到Bastion主機'); // a term added where only a space was
  assert.equal(keepTermEdits('以前 Up- UpGenie 混在一起', '以前 Ops- OpsGenie 混在一起', ['OpsGenie']), '以前 Up- OpsGenie 混在一起', 'the stutter edit is reverted, the term fix kept');
});

test('aliasLines lists team-knowledge mishearings for the corrector', () => {
  assert.equal(aliasLines({ glossary: [{ term: 'Bastion', aliases: ['Bation', 'bastian'] }, { term: 'EKS' }, { term: 'X', aliases: 'bad' }] }), 'Bation、bastian → Bastion');
  assert.equal(aliasLines(null), '');
});

test('parseActions reads summary to-dos, owners, citations, and keeps done state', () => {
  const md = '## 待辦事項\n- [ ] 完成後端 API — 阿凱 [2]\n- [ ] 調整 HPA（**目標值待確認**）— 未指定 [2]\n- [x] 前端串接 — 小美 [3、4]\n- [ ] 確認 PR-12 的 CI [6]\n- 一般重點 [1]';
  const a = parseActions(md, [{ text: '確認 PR-12 的 CI', done: true }]);
  assert.deepEqual(a, [
    { text: '完成後端 API', owner: '阿凱', done: false, cite: 2 },
    { text: '調整 HPA（目標值待確認）', owner: '未指定', done: false, cite: 2 },
    { text: '前端串接', owner: '小美', done: true, cite: 3 },
    { text: '確認 PR-12 的 CI', owner: '未指定', done: true, cite: 6 },
  ]);
  assert.deepEqual(parseActions(''), []);
});

test('cleanMeta validates time, trims text, dedups and caps tags', () => {
  assert.deepEqual(cleanMeta({ scheduledAt: '2026-10-21T14:30', location: ' 3F ', brief: 'x', tags: '平台, 週會、平台' }),
    { scheduledAt: '2026-10-21T14:30', location: '3F', brief: 'x', tags: ['平台', '週會'] });
  assert.equal(cleanMeta({ scheduledAt: 'tomorrow' }).scheduledAt, '');
  assert.equal(cleanMeta({ tags: Array.from({ length: 30 }, (_, i) => `t${i}`) }).tags.length, 20);
  assert.deepEqual(cleanMeta({ title: 'ignored' }), {});
});

test('parseQuery splits operators, phrases and terms, normalized to Taiwan lowercase', () => {
  assert.deepEqual(parseQuery('tag:平台 who:小美 "Consumer Lag" 软件 type:站立 after:2026-10-01 foo:bar'), {
    // s2twp maps 台→臺 on both query and data, so tag:平台 still matches a 平台 tag.
    terms: ['consumer lag', '軟體', 'foo:bar'], tag: ['平臺'], who: ['小美'], type: ['站立'], team: [], leader: [], group: [], after: '2026-10-01', before: '',
  });
});

test('searchMeetings ANDs terms, applies filters, ranks by field weight, and deep-links transcript hits', () => {
  const base = { createdAt: '2026-10-01T02:00:00.000Z', scheduledAt: '', location: '', brief: '', tags: [], notes: '', summary: '', actions: [], speakers: {}, template: 'auto' };
  const a = { ...base, id: 'a', title: 'Kafka 週會', tags: ['平台'], scheduledAt: '2026-10-20T10:00',
    segments: [{ start: 3, speaker: 0, text: '暖場' }, { start: 9, speaker: 1, text: 'Kafka 的 consumer lag 太高' }] };
  const b = { ...base, id: 'b', title: '業務會議', template: 'sales', notes: '客戶問到 kafka 授權',
    segments: [{ start: 1, speaker: 0, text: '軟體報價' }] };
  const r = searchMeetings([a, b], 'KAFKA');
  assert.deepEqual(r.results.map(x => x.id), ['a', 'b'], 'title hit outranks notes hit');
  assert.deepEqual(r.results[0].hits.find(h => h.seg), { field: 'transcript', label: '逐字稿', seg: 2, at: 9, speaker: 'Speaker B', snippet: 'Kafka 的 consumer lag 太高' });
  assert.deepEqual(searchMeetings([a, b], 'kafka 软件').results.map(x => x.id), ['b'], 'all terms must match; Simplified query matches Traditional text');
  assert.deepEqual(searchMeetings([a, b], 'tag:平台').results.map(x => x.id), ['a']);
  assert.deepEqual(searchMeetings([a, b], 'type:業務').results.map(x => x.id), ['b']);
  assert.deepEqual(searchMeetings([a, b], 'after:2026-10-15').results.map(x => x.id), ['a'], 'scheduledAt wins over createdAt');
  assert.deepEqual(searchMeetings([a, b], 'who:"speaker b"').results.map(x => x.id), ['a']);
  assert.deepEqual(searchMeetings([a, b], 'nothing-here').results, []);
});

test('parseDirectory reads CSV/TSV lines, skips header and comments, splits aliases', () => {
  const people = parseDirectory('姓名, 團隊, Y leader, 別名\n# comment\n\n小美, Platform team, Ken, Mei/May\n阿凱\tSPC\tAmy\nRex，Data team');
  assert.deepEqual(people, [
    { name: '小美', team: 'Platform team', leader: 'Ken', aliases: ['Mei', 'May'] },
    { name: '阿凱', team: 'SPC', leader: 'Amy', aliases: [] },
    { name: 'Rex', team: 'Data team', leader: '', aliases: [] },
  ]);
});

test('resolver maps names, aliases and team names to team and Y leader', () => {
  const r = resolver(parseDirectory('小美, Platform team, Ken, Mei\n阿凱, Platform team, Ken\nBen, Platform team, Ann\nSam, SPC, Amy'));
  assert.deepEqual(r('mei'), { person: '小美', team: 'Platform team', leader: 'Ken', groups: [] });
  assert.deepEqual(r('PLATFORM TEAM'), { team: 'Platform team', leader: 'Ken' }, 'team owner gets the most common leader');
  assert.equal(r('Speaker A'), null);
  assert.deepEqual(r('Platform team（Speaker A / Sam 說明）'), { team: 'Platform team', leader: 'Ken' }, 'contained team wins over contained person');
  assert.deepEqual(r('Speaker B（Sam）'), { person: 'Sam', team: 'SPC', leader: 'Amy', groups: [] });
});

test('ai: model/agent cleaning, agent → model selection, context guard, skills', async () => {
  assert.deepEqual(ai.cleanModel({ id: 'x y', provider: 'evil', baseURL: 'javascript:alert(1)', apiKeyEnv: 'lower', maxOutput: 1e9, effort: 'ultra', enabled: 'yes' }),
    { id: 'xy', label: '', provider: 'anthropic', model: '', baseURL: '', apiKeyEnv: '', contextWindow: 0, maxOutput: 128000, effort: 'medium', enabled: false, default: false, systemAddition: '', test: null });
  assert.deepEqual(ai.cleanAgent({ name: 'X', skills: 'a.md\n\nb.md', effort: 'max', enabled: true }).skills, ['a.md', 'b.md']);
  const cfg = { models: [], agents: [{ ...ai.BUILTIN_AGENTS.find(a => a.id === 'eks-upgrade'), model: 'sonnet', effort: 'xhigh' }, { ...ai.BUILTIN_AGENTS.find(a => a.id === 'cicd'), enabled: false }] };
  const eks = ai.pickAI(cfg, 'eks-upgrade');
  assert.deepEqual([eks.model.model, eks.agent.name, eks.effort], ['claude-sonnet-5-5', 'AWS EKS 升級', 'xhigh']);
  const off = ai.pickAI(cfg, 'cicd');
  assert.deepEqual([off.model.model, off.agent, off.effort], ['claude-opus-5-5', null, 'medium'], 'disabled agent falls back to the default model, no agent');
  assert.equal(ai.pickAI({ models: [{ ...ai.BUILTIN_MODELS.find(m => m.provider === 'gemini'), enabled: true, default: true }], agents: [] }).model.provider, 'anthropic', 'placeholder providers are skipped');
  assert.throws(() => ai.checkContext({ label: 'tiny', contextWindow: 1000, maxOutput: 900 }, '字'.repeat(200)), /context window/);
  ai.checkContext({ label: 'big', contextWindow: 1_000_000, maxOutput: 64000 }, '字'.repeat(200));
  const md = path.join(process.env.DATA_DIR, 'SKILL.md');
  fs.writeFileSync(md, '# EKS checklist');
  assert.equal(await ai.loadSkill(md), '# EKS checklist');
  await assert.rejects(ai.loadSkill('/etc/passwd'), /\.md/);
});

test('usage: one record per Claude call, aggregated by any key', () => {
  const model = { model: 'claude-opus-5-5', label: 'Claude Opus 5.5' };
  const e = usageOf({ model: 'claude-opus-5-5', usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 } }, model, 'medium', 'summary', 4200);
  assert.deepEqual({ ...e, at: 'x' }, { kind: 'summary', provider: 'anthropic', model: 'claude-opus-5-5', label: 'Claude Opus 5.5', effort: 'medium', ms: 4200, at: 'x',
    inputTokens: 1200, outputTokens: 300, cacheReadTokens: 50, cacheWriteTokens: 10 });
  assert.equal(usageOf(null, model, 'low', 'test', 5).inputTokens, 0, 'failed calls still record time');
  const rows = aggregateUsage([e, { ...e, error: 'boom', inputTokens: 0, outputTokens: 0 }, { kind: 'transcribe', model: 'mai', audioSeconds: 70, costUsd: 0.002, ms: 2500 }], x => x.kind);
  assert.deepEqual(rows.map(r => [r.key, r.calls, r.errors, r.inputTokens, r.ms, r.audioSeconds, r.costUsd]),
    [['summary', 2, 1, 1200, 8400, 0, 0], ['transcribe', 1, 0, 0, 2500, 70, 0.002]]);
});

test('times are Taiwan time (GMT+8) regardless of the server time zone', () => {
  const d = new Date('2026-10-20T17:44:00.000Z');
  assert.equal(localDay(d), '2026-10-21', 'UTC evening is the next day in Taipei');
  assert.equal(nowIso(d), '2026-10-21T01:44:00.000+08:00');
  assert.equal(new Date(nowIso(d)).getTime(), d.getTime(), 'same instant');
  const base = { scheduledAt: '', location: '', brief: '', tags: [], notes: '', summary: '', actions: [], speakers: {}, segments: [], template: 'auto' };
  const old = { ...base, id: 'old', title: 'a', createdAt: '2026-10-20T17:00:00.000Z' };          // 01:00 GMT+8 on 10-21
  const fresh = { ...base, id: 'new', title: 'b', createdAt: '2026-10-21T00:30:00.000+08:00' };   // 00:30 GMT+8 on 10-21
  assert.deepEqual(search2([fresh, old], 'after:2026-10-21').results.map(r => r.id), ['new', 'old'], 'both fall on 10-21 in GMT+8');
});

test('extOf only keeps safe extensions', () => {
  assert.equal(extOf('a.MP4'), '.mp4');
  assert.equal(extOf('../../x'), '.bin');
  assert.equal(extOf('a.<script>'), '.bin');
});

// A fetch with its own cookie jar, i.e. one signed-in browser.
const client = () => {
  let cookie = '';
  return async (url, opts = {}) => {
    const r = await fetch(url, { ...opts, headers: { ...opts.headers, ...(cookie && { cookie }) } });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return r;
  };
};
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
let base, api, created;
const admin = client();
before(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  api = `http://127.0.0.1:${server.address().port}/api`;
  base = `${api}/meetings`;
});
after(() => server.close());

test('browser Markdown runtime is served locally before login', async () => {
  const runtime = await fetch(`${api.replace(/\/api$/, '')}/markdown-runtime.js`);
  assert.equal(runtime.status, 200);
  assert.match(runtime.headers.get('content-type'), /application\/javascript/);
  assert.equal(await runtime.text(), loadMarkdownRuntime());
});

test('upload stores the file, serves ranges and downloads, and records a missing-key error', async () => {
  const fetch = admin;
  assert.equal((await fetch(base)).status, 401, 'meetings need a login');
  const reg = await fetch(`${api}/auth/register`, json('POST', { username: 'boss', password: 'password1', displayName: 'Boss' }));
  assert.equal((await reg.json()).user.role, 'admin', 'first account becomes admin');
  {
    const bytes = Buffer.from('fake-audio-bytes');
    created = await (await fetch(`${base}?filename=${encodeURIComponent('週會.mp4')}&lang=zh-TW&scheduledAt=2026-10-21T09:30&tags=${encodeURIComponent('平台,週會')}&location=bad&scheduledAt2=x`, { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: bytes })).json();
    assert.equal(created.file, 'recording.mp4');
    assert.ok(fs.existsSync(path.join(process.env.DATA_DIR, localDay(), created.id, 'recording.mp4')), 'stored under data/<upload day>/<id>/');
    assert.deepEqual([created.scheduledAt, created.tags, created.location], ['2026-10-21T09:30', ['平台', '週會'], 'bad']);

    const dl = await fetch(`${base}/${created.id}/audio?download`);
    assert.match(dl.headers.get('content-disposition'), /%E9%80%B1%E6%9C%83\.mp4/);
    assert.deepEqual(Buffer.from(await dl.arrayBuffer()), bytes);

    const part = await fetch(`${base}/${created.id}/audio`, { headers: { Range: 'bytes=5-9' } });
    assert.equal(part.status, 206);
    assert.equal(await part.text(), 'audio');

    let m;
    for (let i = 0; i < 50 && m?.status !== 'error'; i++) {
      await new Promise(r => setTimeout(r, 20));
      m = await (await fetch(`${base}/${created.id}`)).json();
    }
    assert.equal(m.status, 'error');
    assert.match(m.error, /OPENROUTER_API_KEY/);

    const patched = await (await fetch(`${base}/${created.id}`, { method: 'PATCH', body: JSON.stringify({ speakers: { 0: 'Amy' }, status: 'done' }) })).json();
    assert.equal(patched.speakers[0], 'Amy');
    assert.equal(patched.status, 'error', 'PATCH must not overwrite non-editable fields');
    assert.deepEqual(patched.actions, [], 'meetings without a summary have no actions');

    const joined = await (await fetch(`${base}/${created.id}`, { method: 'PATCH', body: JSON.stringify({ participants: ['Carol'], speakers: { 0: 'Amy', 1: ' ' } }) })).json();
    assert.deepEqual([joined.participants, joined.people.map(p => p.name), joined.speakers], [['Carol'], ['Carol'], { 0: 'Amy' }], 'hand-added participants count as attendees');
    assert.equal(joined.summaryStale, undefined, 'no summary yet, nothing to flag');
    const file = fs.globSync(`${process.env.DATA_DIR}/*/${created.id}/meeting.json`)[0];
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), summary: '## 摘要\n- x', segments: [{ start: 0, end: 1, speaker: 0, text: 'hi' }] }));
    const moved = await (await fetch(`${base}/${created.id}`, { method: 'PATCH', body: JSON.stringify({ segSpeakers: { 0: 1 }, speakers: { 0: 'Amy', 1: 'Bob' } }) })).json();
    assert.deepEqual([moved.segments[0].speaker, moved.summaryStale, moved.people.map(p => p.name)], [1, true, ['Bob', 'Carol']]);
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), summary: '', segments: [], summaryStale: false, participants: [] }));

    const acted = await (await fetch(`${base}/${created.id}`, { method: 'PATCH', body: JSON.stringify({ actions: [{ text: 'x', done: 'yes', cite: '2', evil: 1 }] }) })).json();
    assert.deepEqual(acted.actions, [{ text: 'x', owner: '', done: false, cite: null, team: '', leader: '', groups: [] }], 'actions are sanitized');
    assert.deepEqual((await (await fetch(base)).json())[0].actions, acted.actions);

    // Concurrent writes to one meeting must not drop each other (per-meeting write queue).
    await Promise.all([
      ...Array.from({ length: 20 }, (_, i) => fetch(`${base}/${created.id}/comments`, json('POST', { text: `c${i}` }))),
      fetch(`${base}/${created.id}`, json('PATCH', { location: '3F' })), fetch(`${base}/${created.id}`, json('PATCH', { notes: 'n' })),
    ]);
    const raced = await (await fetch(`${base}/${created.id}`)).json();
    assert.deepEqual([raced.comments.length, raced.location, raced.notes], [20, '3F', 'n'], 'no write is lost');
    assert.deepEqual(fs.readdirSync(path.dirname(fs.globSync(`${process.env.DATA_DIR}/*/${created.id}/meeting.json`)[0])).filter(f => f.endsWith('.tmp')), [], 'no temp files left');
    const mfile = fs.globSync(`${process.env.DATA_DIR}/*/${created.id}/meeting.json`)[0];
    fs.writeFileSync(mfile, JSON.stringify({ ...JSON.parse(fs.readFileSync(mfile, 'utf8')), comments: [], location: 'bad', notes: '' }));

    const tagged = await (await fetch(`${base}/${created.id}`, { method: 'PATCH', body: JSON.stringify({ tags: '客戶、平台', scheduledAt: 'nope', brief: '季度規劃' }) })).json();
    assert.deepEqual([tagged.tags, tagged.scheduledAt, tagged.brief], [['客戶', '平台'], '', '季度規劃']);
    const found = await (await fetch(`${base.replace('/meetings', '/search')}?q=${encodeURIComponent('季度 tag:客戶')}`)).json();
    assert.deepEqual(found.results.map(r => r.id), [created.id]);
    assert.equal(found.results[0].hits[0].label, '摘要');

    const dir = await (await fetch(`${api}/directory`, { method: 'PUT', body: JSON.stringify({ csv: 'Amy Chen, SPC, Ken, Amy\nBob, Platform team, Ann' }) })).json();
    assert.equal(dir.csv, 'Amy Chen, SPC, Ken, Amy\nBob, Platform team, Ann');
    await fetch(`${base}/${created.id}`, { method: 'PATCH', body: JSON.stringify({ actions: [{ text: '補清單', owner: 'platform team' }] }) });
    const enriched = await (await fetch(`${base}/${created.id}`)).json();
    assert.deepEqual(enriched.actions[0], { text: '補清單', owner: 'platform team', done: false, cite: null, team: 'Platform team', leader: 'Ann', groups: [] });
    assert.deepEqual((await (await fetch(`${api}/search?q=${encodeURIComponent('leader:ann')}`)).json()).results.map(r => r.id), [created.id]);
    assert.deepEqual((await (await fetch(`${api}/search?q=${encodeURIComponent('team:spc')}`)).json()).results, []);

    assert.equal((await fetch(`${base}?lang=${encodeURIComponent('x&y')}`, { method: 'POST', body: 'a' })).status, 400);
    assert.equal((await fetch(`${base}/../../etc`)).status, 404);
    assert.equal((await (await fetch(base)).json()).length, 1);
  }
});

test('accounts, roles, meeting access, comments, share links, password reset, profiles', async () => {
  const id = created.id, mtg = `${base}/${id}`;
  const member = client(), ro = client();
  const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url)));
  assert.deepEqual((await (await client()(`${api}/auth/me`)).json()).app, { version: pkg.version, repo: pkg.repository }, 'the UI shows version and repo');
  assert.equal((await (await member(`${api}/auth/register`, json('POST', { username: 'mei', password: 'password1', displayName: '小美' }))).json()).user.role, 'member');
  const roUser = (await (await ro(`${api}/auth/register`, json('POST', { username: 'viewer', password: 'password1' }))).json()).user;
  await admin(`${api}/admin/users/${roUser.id}`, json('PUT', { role: 'readonly' }));
  assert.equal((await ro(`${api}/admin/transcription-test`, json('POST', {}))).status, 403, 'readonly cannot spend API credit on diagnostics');
  await admin(`${api}/admin/settings`, json('PUT', { registration: false }));
  assert.equal((await client()(`${api}/auth/register`, json('POST', { username: 'eve', password: 'password1' }))).status, 403, 'registration closed');

  // default access is view: members see it but cannot edit or comment
  assert.equal((await member(mtg)).status, 200);
  assert.equal((await (await member(mtg)).json()).perm, 'view');
  assert.equal((await member(mtg, json('PATCH', { title: 'x' }))).status, 403);
  assert.equal((await member(`${mtg}/comments`, json('POST', { text: 'hi' }))).status, 403);
  assert.equal((await member(mtg, json('PATCH', { access: 'edit' }))).status, 403, 'only the owner changes access');
  await admin(mtg, json('PATCH', { access: 'comment' }));
  const commented = await (await member(`${mtg}/comments`, json('POST', { text: '請補 IRSA 細節', seg: 2 }))).json();
  assert.deepEqual(commented.comments.map(c => [c.name, c.text, c.seg]), [['小美', '請補 IRSA 細節', 2]]);
  assert.equal((await ro(`${mtg}/comments`, json('POST', { text: 'no' }))).status, 403, 'readonly never writes');
  assert.equal((await ro(mtg, json('PATCH', { notes: '# blocked' }))).status, 403);
  assert.equal((await ro(`${mtg}/sections?filename=blocked.wav`, { method: 'POST', body: 'blocked' })).status, 403);
  assert.equal((await ro(mtg, json('PATCH', { sections: [] }))).status, 403);
  await admin(mtg, json('PATCH', { access: 'private' }));
  assert.equal((await member(mtg)).status, 404, 'private meetings are invisible');
  assert.deepEqual(await (await member(base)).json(), []);

  // share link grants edit until revoked
  const share = await (await admin(`${mtg}/shares`, json('POST', { perm: 'edit' }))).json();
  assert.equal((await member(`${api}/shares/${share.token}`, json('POST', {}))).status, 200);
  assert.equal((await member(mtg, json('PATCH', { brief: 'shared edit' }))).status, 200);
  await ro(`${api}/shares/${share.token}`, json('POST', {}));
  assert.equal((await ro(mtg, json('PATCH', { brief: 'nope' }))).status, 403, 'readonly stays read-only via shares');
  const listed = await (await admin(`${api}/admin`)).json();
  assert.deepEqual(listed.shares.map(s => [s.perm, s.uses, s.meetingTitle, !!s.revokedAt]), [['edit', 2, created.title, false]]);
  assert.equal((await member(`${api}/shares/${share.token}`, { method: 'DELETE' })).status, 403);
  await admin(`${api}/shares/${share.token}`, { method: 'DELETE' });
  assert.equal((await member(mtg)).status, 404, 'revoking removes the grant');
  assert.equal((await member(`${api}/shares/${share.token}`, json('POST', {}))).status, 404);

  // readonly cannot create meetings
  assert.equal((await ro(`${base}?filename=a.mp3`, { method: 'POST', body: 'x' })).status, 403);

  // profiles merge into the directory: groups become searchable
  await admin(mtg, json('PATCH', { access: 'view', actions: [{ text: '補 IRSA 文件', owner: '小美' }] }));
  await member(`${api}/me/profile`, json('PUT', { team: 'Platform team', leader: 'Ken', members: 'Kai, Ben', groups: 'ZTSA 專案: 小美, Sam' }));
  const people = (await (await member(`${api}/directory`)).json()).people;
  assert.deepEqual(people.find(p => p.name === '小美'), { name: '小美', team: 'Platform team', leader: 'Ken', aliases: ['mei'], groups: ['ZTSA 專案'] });
  assert.deepEqual(people.find(p => p.name === 'Kai'), { name: 'Kai', team: 'Platform team', leader: 'Ken', aliases: [], groups: [] });
  assert.deepEqual((await (await member(`${api}/search?q=${encodeURIComponent('group:ztsa')}`)).json()).results.map(r => r.id), [id]);
  assert.equal((await member(`${api}/directory`, json('PUT', { csv: 'x' }))).status, 403, 'only admins edit the CSV directory');

  // password reset signs the user out and the temporary password works once given
  const { password } = await (await admin(`${api}/admin/users/${(await (await member(`${api}/auth/me`)).json()).user.id}/reset-password`, json('POST', {}))).json();
  assert.equal((await member(base)).status, 401);
  assert.equal((await member(`${api}/auth/login`, json('POST', { username: 'mei', password: 'password1' }))).status, 401);
  assert.equal((await member(`${api}/auth/login`, json('POST', { username: 'MEI', password }))).status, 200);
  assert.equal((await member(`${api}/me/password`, json('PUT', { current: password, next: 'password2' }))).status, 200);

  // models and agents: members see only enabled agents; admins edit and test
  const memberAI = await (await member(`${api}/ai`)).json();
  assert.ok(memberAI.agents.some(a => a.id === 'dri-handover') && !('systemPrompt' in memberAI.agents[0]) && !('apiKeyEnv' in memberAI.models[0]));
  assert.equal((await member(`${api}/admin/ai`, json('PUT', { models: [], agents: [] }))).status, 403);
  const cfg = await (await admin(`${api}/ai`)).json();
  cfg.agents.find(a => a.id === 'standup').enabled = false;
  cfg.agents.push({ id: 'mine', name: '我的 Agent', systemPrompt: '只列決策', enabled: true });
  const saved = await (await admin(`${api}/admin/ai`, json('PUT', cfg))).json();
  assert.deepEqual([saved.agents.find(a => a.id === 'standup').enabled, saved.agents.find(a => a.id === 'mine').name, saved.models.filter(m => m.default).map(m => m.id)], [false, '我的 Agent', ['opus']]);
  assert.ok(!(await (await member(`${api}/ai`)).json()).agents.some(a => a.id === 'standup'));
  const t = await (await admin(`${api}/admin/ai/models/gemini/test`, json('POST', {}))).json();
  assert.deepEqual([t.ok, t.error], [false, 'gemini 尚未支援（規劃中）']);
  assert.equal((await (await admin(mtg, json('PATCH', { agentId: 'eks-upgrade' }))).json()).agentId, 'eks-upgrade');

  // flat legacy folders move into day folders and stay reachable by id
  const legacy = '00000000-0000-4000-8000-000000000001', flat = path.join(process.env.DATA_DIR, legacy);
  fs.mkdirSync(flat);
  fs.writeFileSync(path.join(flat, 'meeting.json'), JSON.stringify({ id: legacy, title: '舊會議', createdAt: '2026-01-02T03:00:00.000Z', segments: [], speakers: {}, summary: '', template: 'auto', status: 'done' }));
  assert.equal(await migrateLayout(), 1);
  assert.ok(fs.existsSync(path.join(process.env.DATA_DIR, localDay(new Date('2026-01-02T03:00:00.000Z')), legacy, 'meeting.json')) && !fs.existsSync(flat));
  assert.equal((await (await admin(`${base}/${legacy}`)).json()).title, '舊會議');

  // admin usage aggregates exist even before any AI call succeeded
  const adminView = await (await admin(`${api}/admin`)).json();
  assert.ok(Array.isArray(adminView.usage.byModel) && Array.isArray(adminView.usage.byDay));

  // learning loop: meeting terms become team terms; only admins disable or delete; benchmark needs a finished meeting
  await admin(mtg, json('PATCH', { glossary: 'Karpenter, IRSA' }));
  assert.deepEqual((await (await member(`${api}/learned`)).json()).terms.map(t => t.term), ['Karpenter', 'IRSA']);
  assert.equal((await member(`${api}/learned/terms`, json('POST', { term: 'Bastion、irsa' }))).status, 201);
  assert.equal((await ro(`${api}/learned/terms`, json('POST', { term: 'x' }))).status, 403, 'readonly cannot add terms');
  assert.equal((await member(`${api}/learned/terms`, json('PATCH', { term: 'Bastion', enabled: false }))).status, 403);
  const off = await (await admin(`${api}/learned/terms`, json('PATCH', { term: 'bastion', enabled: false }))).json();
  assert.deepEqual(off.terms.map(t => [t.term, t.enabled, t.source]), [['Karpenter', true, `meeting:${id}`], ['IRSA', true, `meeting:${id}`], ['Bastion', false, 'manual']]);
  assert.deepEqual((await (await member(`${api}/learned`)).json()).terms.map(t => t.term), ['Karpenter', 'IRSA'], 'disabled terms are not applied or shown');
  assert.equal((await member(`${mtg}/benchmark`, json('POST', {}))).status, 403, 'only the owner freezes a benchmark');
  assert.equal((await admin(`${mtg}/benchmark`, json('POST', {}))).status, 409, 'an unfinished meeting cannot be frozen');
  assert.equal((await admin(`${api}/learned/bench`, json('POST', {}))).status, 400, 'nothing to run yet');
  assert.equal((await (await admin(`${api}/learned`)).json()).bench.running, undefined, 'a refused run leaves no running flag');

  // brute-force brake, cross-origin writes, logout
  for (let i = 0; i < 5; i++) await client()(`${api}/auth/login`, json('POST', { username: 'viewer', password: 'wrong' }));
  assert.equal((await client()(`${api}/auth/login`, json('POST', { username: 'viewer', password: 'password1' }))).status, 429);
  assert.equal((await member(mtg, { ...json('PATCH', { brief: 'x' }), headers: { 'Content-Type': 'application/json', origin: 'http://evil.example' } })).status, 403);
  await member(`${api}/auth/logout`, json('POST', {}));
  assert.equal((await member(base)).status, 401);
});

test('OpenAI-compatible models: usage mapping, transient errors, per-use model, model selection', () => {
  const m = { label: 'Sol', model: 'codex/gpt-6.1-sol' };
  assert.deepEqual(openaiUsage({ model: 'gpt-6.1-sol', usage: { prompt_tokens: 4253, completion_tokens: 23, prompt_tokens_details: { cached_tokens: 4096 } } }, m, 'low', 'test', 5),
    { ...openaiUsage(null, m, 'low', 'test', 5), model: 'gpt-6.1-sol', inputTokens: 157, outputTokens: 23, cacheReadTokens: 4096, at: openaiUsage(null, m, 'low', 'test', 5).at });
  assert.ok(isTransient({ upstream: 503 }) && isTransient(new Error("stream from Anthropic was cut short")) && !isTransient({ upstream: 400 }) && !isTransient(new Error('拒絕')));
  assert.deepEqual([keyScope({ provider: 'openai', baseURL: 'https://llm.corp/v1' }), keyScope({ provider: 'openai', baseURL: '' }), keyScope({ provider: 'anthropic' })],
    ['https://llm.corp/v1', 'env:OPENAI_BASE_URL', 'env:ANTHROPIC_BASE_URL']);
  const cfg = { models: [{ ...ai.BUILTIN_MODELS[0] }, { ...ai.BUILTIN_MODELS[3], enabled: true }], uses: { correct: 'gpt-luna', speakers: 'nope' } };
  assert.equal(ai.pickFor(cfg, 'correct').model.id, 'gpt-luna', 'an enabled OpenAI model can be picked for a use');
  assert.equal(ai.pickFor(cfg, 'speakers').model.id, 'opus', 'unknown or disabled falls back to the default model');
  assert.equal(ai.pickAI({ models: [{ ...ai.BUILTIN_MODELS[0], enabled: false, default: false }, { ...ai.BUILTIN_MODELS[2], enabled: true }] }).model.id, 'gpt', 'OpenAI models are usable as default');
  // npm run start:litellm: Anthropic profiles without their own endpoint go through the OpenAI-compatible endpoint.
  const opus = ai.BUILTIN_MODELS[0];
  assert.equal(viaEnv(opus).provider, 'anthropic', 'off unless LLM_PROVIDER=openai');
  process.env.LLM_PROVIDER = 'openai';
  try {
    assert.deepEqual([viaEnv(opus).provider, viaEnv(opus).model], ['openai', 'claude-opus-5-5']);
    assert.equal(viaEnv({ ...opus, baseURL: 'https://api.anthropic.com' }).provider, 'anthropic', 'a model with its own endpoint keeps it');
    assert.equal(viaEnv(ai.BUILTIN_MODELS.find(m => m.id === 'gpt')).model, 'gpt-6.1-sol', 'magpie prefix dropped for LiteLLM');
    assert.equal(ai.BUILTIN_MODELS.find(m => m.id === 'gpt').model, 'codex/gpt-6.1-sol', 'built-in IDs default to magpie');
  } finally { delete process.env.LLM_PROVIDER; }
});

test('start:litellm uses the key it was launched with', async () => {
  process.env.OTHER_KEY = 'per-model';
  const model = { provider: 'openai', baseURL: '', apiKeyEnv: 'OTHER_KEY' };
  try {
    assert.equal(await apiKeyFor(model), 'per-model', 'normally the per-model variable wins');
    Object.assign(process.env, { LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'launch-key' });
    assert.equal(await apiKeyFor(model), 'launch-key', 'under start:litellm the launch key wins over per-model and stored keys');
    assert.equal(await apiKeyFor({ ...model, baseURL: 'https://own.example/v1' }), 'per-model', 'a model with its own endpoint keeps its key');
  } finally { for (const k of ['OTHER_KEY', 'LLM_PROVIDER', 'OPENAI_API_KEY']) delete process.env[k]; }
});

test('startup warns when the default model has no LLM key', async () => {
  const saved = { ...process.env };
  try {
    for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'LLM_PROVIDER', 'OPENAI_API_KEY']) delete process.env[k];
    assert.equal(await llmKeyMissing(), true, 'plain npm run start');
    process.env.ANTHROPIC_API_KEY = 'magpie';
    assert.equal(await llmKeyMissing(), false, 'start:magpie');
    delete process.env.ANTHROPIC_API_KEY;
    Object.assign(process.env, { LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'launch-key' });
    assert.equal(await llmKeyMissing(), false, 'start:litellm');
  } finally { process.env = saved; }
});

test('OpenAI-compatible endpoint: write-only key, model list, retry on 503 and empty replies', async () => {
  RETRY.delays = [10, 10];
  let calls = 0;
  const auths = [];
  const fake = http.createServer((req, res) => {
    auths.push(req.headers.authorization);
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'gpt-6-luna' }, { id: 'gpt-6.1-sol' }] }));
    calls++;
    if (calls === 1) { res.statusCode = 503; return res.end(JSON.stringify({ error: { message: 'busy' } })); }
    if (calls === 2) return res.end(JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] })); // empty reply
    res.setHeader('x-litellm-response-cost', '0.000308');
    res.end(JSON.stringify({ model: 'gpt-6-luna', choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } }));
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  try {
    const cfg = await (await admin(`${api}/ai`)).json();
    cfg.models.find(m => m.id === 'gpt-luna').enabled = true;
    cfg.models.find(m => m.id === 'gpt-luna').baseURL = `http://127.0.0.1:${fake.address().port}/v1`;
    cfg.uses = { correct: 'gpt-luna', speakers: '' };
    const saved = await (await admin(`${api}/admin/ai`, json('PUT', cfg))).json();
    assert.equal(saved.uses.correct, 'gpt-luna');
    const keyed = await (await admin(`${api}/admin/ai/keys`, json('PUT', { modelId: 'gpt-luna', key: 'sk-test-12345678' }))).json();
    assert.deepEqual(keyed.models.find(m => m.id === 'gpt-luna').keyStatus.last4, '5678');
    assert.ok(!JSON.stringify(keyed).includes('sk-test') && !JSON.stringify(await (await admin(`${api}/ai`)).json()).includes('sk-test'), 'the key never leaves the server');
    assert.equal(fs.statSync(path.join(process.env.DATA_DIR, 'secrets.json')).mode & 0o777, 0o600);
    assert.deepEqual((await (await admin(`${api}/admin/ai/models/gpt-luna/list`, json('POST', {}))).json()).models, ['gpt-6-luna', 'gpt-6.1-sol']);
    const t = await (await admin(`${api}/admin/ai/models/gpt-luna/test`, json('POST', {}))).json();
    assert.deepEqual([t.ok, t.reply, calls], [true, 'OK', 3], 'a 503 and an empty reply are retried, then it succeeds');
    assert.equal(t.usage.costUsd, 0.000308, 'the LiteLLM cost header is recorded');
    assert.ok(auths.every(a => a === 'Bearer sk-test-12345678'), 'the stored key is sent to the endpoint');
  } finally { fake.close(); }
});

test('Anthropic SDK streams through custom endpoints with the existing API version and usage shape', async () => {
  let seen;
  const fake = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    seen = { url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString()) };
    const events = [
      ['message_start', { type: 'message_start', message: { id: 'msg_local_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 0 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } }],
      ['message_stop', { type: 'message_stop' }],
    ];
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(''));
  });
  await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve));
  const original = await (await admin(`${api}/ai`)).json();
  const savedEnv = { ...process.env };
  try {
    const cfg = structuredClone(original), model = cfg.models.find(m => m.id === ai.BUILTIN_MODELS[0].id);
    model.baseURL = `http://127.0.0.1:${fake.address().port}`;
    model.enabled = true;
    await admin(`${api}/admin/ai`, json('PUT', cfg));
    await admin(`${api}/admin/ai/keys`, json('PUT', { modelId: model.id, key: 'synthetic-sdk-key' }));
    const result = await (await admin(`${api}/admin/ai/models/${model.id}/test`, json('POST', {}))).json();
    assert.equal(result.ok, true, result.error);
    assert.equal(result.reply, 'OK');
    assert.deepEqual([result.usage.inputTokens, result.usage.outputTokens], [12, 2]);
    assert.equal(new URL(seen.url, model.baseURL).pathname, '/v1/messages');
    assert.equal(seen.headers['anthropic-version'], '2023-06-01');
    assert.equal(seen.headers['x-api-key'], 'synthetic-sdk-key');
    assert.equal(seen.headers.authorization, undefined);
    assert.match(seen.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
    assert.equal(seen.headers.traceparent, undefined);
    assert.equal(seen.body.stream, true);
    assert.equal(seen.body.fallbacks, 'default');
    assert.equal(typeof seen.body.output_config.effort, 'string');
    await admin(`${api}/admin/ai/keys`, json('PUT', { modelId: model.id, key: '' }));
    for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_AUTH_TOKEN;
      process.env[name] = 'synthetic-env-key';
      const envResult = await (await admin(`${api}/admin/ai/models/${model.id}/test`, json('POST', {}))).json();
      assert.equal(envResult.ok, true, envResult.error);
      assert.deepEqual([seen.headers['x-api-key'], seen.headers.authorization], name === 'ANTHROPIC_API_KEY'
        ? ['synthetic-env-key', undefined] : [undefined, 'Bearer synthetic-env-key']);
    }
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    seen = undefined;
    const missing = await (await admin(`${api}/admin/ai/models/${model.id}/test`, json('POST', {}))).json();
    assert.equal(missing.ok, false);
    assert.match(missing.error, /沒有設定 API key/);
    assert.equal(seen, undefined, 'missing keys do not send a request');
  } finally {
    process.env = savedEnv;
    await admin(`${api}/admin/ai`, json('PUT', original));
    fake.close();
  }
});


test('team knowledge renders glossary and notes, ignores malformed entries (D-024)', () => {
  assert.equal(knowledgeText({}), '');
  assert.equal(knowledgeText({ glossary: 'oops', notes: [1, ' '] }), '');
  assert.equal(knowledgeText({ glossary: [{ term: 'X', aliases: 'not-a-list' }] }), '<team_knowledge>\n- X\n</team_knowledge>');
  assert.equal(knowledgeText({ glossary: [{ term: 'EKS', meaning: 'AWS 的 Kubernetes', aliases: ['EKS cluster'] }, { meaning: 'no term' }], notes: [' On-call 先看 runbook '] }),
    '<team_knowledge>\n- EKS（別名或常見誤聽：EKS cluster）：AWS 的 Kubernetes\n- On-call 先看 runbook\n</team_knowledge>');
});

test('tidy view drops filler sounds but keeps sentence-final particles (D-023)', () => {
  // tidy lives in the single-file UI; evaluate its one-line definition.
  const tidy = eval(fs.readFileSync(new URL('./public/index.html', import.meta.url), 'utf8').match(/^const tidy = (.*);$/m)[1]);
  for (const [input, want] of [['嗯。', ''], ['嗯嗯。', ''], ['哦， OK。', 'OK。'], ['從呃7月', '從7月'], ['啊，還是，嗯。', '還是。'],
    ['有，有。欸，聽得到嗎？', '有，有。聽得到嗎？'], ['team 啊，所以', 'team 啊，所以'], ['對啊，好啊。', '對啊，好啊。'], ['等一下哦。', '等一下哦。']]) {
    assert.equal(tidy(input), want, input);
  }
});

test('transcription diagnostics: actionable errors, safe logs, real request options and network failures', async () => {
  const { requestTranscription, transcriptionFailure } = await import('./server.js');
  const originalFetch = globalThis.fetch, originalKey = process.env.OPENROUTER_API_KEY;
  const info = console.info, error = console.error, output = [];
  console.info = console.error = (...args) => output.push(args.join(' '));
  process.env.OPENROUTER_API_KEY = 'sk-private-test-key';
  try {
    let status = 400;
    globalThis.fetch = async (url, opts) => {
      assert.equal(url, 'https://openrouter.ai/api/v1/audio/transcriptions');
      assert.equal(opts.headers.Authorization, 'Bearer sk-private-test-key');
      const body = JSON.parse(opts.body);
      assert.equal(body.provider.zdr, true);
      assert.equal(body.provider.options.azure.diarization.enabled, true);
      assert.deepEqual(body.provider.options.azure.phraseList.phrases, ['private-term']);
      assert.equal(body.language, 'zh');
      return new Response(JSON.stringify(status === 200 ? { segments: [], usage: { seconds: 1, cost: 0.001 } }
        : { error: { message: 'sk-private-test-key private-term PRIVATE_AUDIO', metadata: { raw: 'private content' } } }),
      { status, headers: { 'x-request-id': 'req-123' } });
    };
    const log = [];
    await assert.rejects(requestTranscription(Buffer.from('PRIVATE_AUDIO'), 'zh-TW', ['private-term'], log), /OpenRouter 400:.*不是餘額不足.*術語 1 個.*request ID req-123/);
    assert.equal(log[0].httpStatus, 400);
    assert.match(log[0].error, /供應商拒絕/);
    status = 200;
    assert.equal((await requestTranscription(Buffer.from('PRIVATE_AUDIO'), 'zh-TW', ['private-term'], log)).audioSeconds, 1);
    assert.equal(log[1].costUsd, 0.001);
    globalThis.fetch = async () => { throw new Error('sk-private-test-key PRIVATE_AUDIO'); };
    await assert.rejects(requestTranscription(Buffer.from('PRIVATE_AUDIO'), 'auto', [], log), /連線中斷、逾時或回應格式錯誤/);
    assert.equal(log.length, 3, 'failed network requests also record usage');
    assert.doesNotMatch(output.join('\n') + JSON.stringify(log), /sk-private-test-key|private-term|PRIVATE_AUDIO|private content/);
    for (const [status, text] of [[401, '金鑰無效'], [402, '額度不足'], [413, '太大'], [429, '限流'], [503, '暫時異常']]) {
      assert.ok(transcriptionFailure(status).includes(text));
    }
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENROUTER_API_KEY = originalKey;
    console.info = info; console.error = error;
  }
});

test('admin transcription test returns checks for key, ffmpeg and upstream; never sends a meeting recording', async () => {
  const originalFetch = globalThis.fetch, originalKey = process.env.OPENROUTER_API_KEY;
  const member = client(), anonymous = client();
  assert.equal((await member(`${api}/auth/login`, json('POST', { username: 'mei', password: 'password2' }))).status, 200);
  const route = `${api}/admin/transcription-test`;
  assert.equal((await anonymous(route, json('POST', {}))).status, 401);
  assert.equal((await member(route, json('POST', {}))).status, 403);
  let calls = 0, status = 200, sample;
  globalThis.fetch = async (url, opts) => {
    if (!String(url).startsWith('https://openrouter.ai/')) return originalFetch(url, opts);
    calls++;
    if (String(url).endsWith('/key')) return new Response(JSON.stringify({ data: { limit_remaining: 3.7, key: 'MUST_NOT_RETURN' } }));
    const body = JSON.parse(opts.body);
    assert.equal(body.provider.zdr, true);
    assert.equal(body.input_audio.format, 'mp3');
    assert.ok(Buffer.from(body.input_audio.data, 'base64').length < 10000, 'only one second of synthetic audio');
    sample = Buffer.from(body.input_audio.data, 'base64');
    return new Response(JSON.stringify(status === 200 ? { segments: [], duration: 1 } : { error: { message: 'private provider body' } }), { status });
  };
  try {
    process.env.OPENROUTER_API_KEY = '';
    const missing = await (await admin(route, json('POST', {}))).json();
    assert.equal(missing.ok, false);
    assert.equal(calls, 0);
    process.env.OPENROUTER_API_KEY = 'fake-diagnostic-key';
    const success = await (await admin(route, json('POST', {}))).json();
    assert.equal(success.ok, true);
    assert.deepEqual(success.checks.map(c => c.name), ['API key', 'ffmpeg', '轉錄 API']);
    assert.match(success.checks[0].message, /3\.7000/);
    status = 400;
    const failed = await (await admin(route, json('POST', {}))).json();
    assert.equal(failed.ok, false);
    assert.match(failed.checks.at(-1).message, /OpenRouter 400/);
    assert.doesNotMatch(JSON.stringify([success, failed]), /fake-diagnostic-key|MUST_NOT_RETURN|private provider body/);
    const uploaded = await (await admin(`${base}?filename=diagnostic.mp3&lang=zh-TW`, { method: 'POST', body: sample })).json();
    let meeting;
    for (let i = 0; i < 100; i++) {
      meeting = await (await admin(`${base}/${uploaded.id}`)).json();
      if (meeting.status === 'error' && meeting.usage.length) break;
      await new Promise(r => setTimeout(r, 20));
    }
    assert.equal(meeting.status, 'error');
    assert.match(meeting.error, /OpenRouter 400:.*術語/);
    assert.equal(meeting.usage.at(-1).httpStatus, 400);
    assert.doesNotMatch(JSON.stringify(meeting), /fake-diagnostic-key|private provider body/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENROUTER_API_KEY = originalKey;
  }
});

test('transcription phrase limit: send at most 200, preserve correction terms and expose omissions', async () => {
  const { requestTranscription } = await import('./server.js');
  const originalFetch = globalThis.fetch, originalKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'fake-phrase-limit-key';
  let sent;
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    assert.equal(body.provider.zdr, true);
    sent = body.provider.options.azure.phraseList?.phrases ?? [];
    return new Response(JSON.stringify(sent.length > 200 ? { error: { message: 'Provider returned 400' } } : { segments: [], duration: 1 }),
      { status: sent.length > 200 ? 400 : 200 });
  };
  try {
    for (const count of [0, 199, 200, 201, 220, 500]) {
      const terms = Array.from({ length: count }, (_, i) => `term-${i}`), log = [];
      await requestTranscription(Buffer.from('synthetic-audio'), 'zh-TW', terms, log);
      assert.deepEqual(sent, terms.slice(0, 200), 'the existing meeting-first order is retained');
      assert.equal(terms.length, count, 'the full correction glossary is not mutated');
      assert.equal(log[0].phraseCount, Math.min(count, 200));
      assert.equal(log[0].omittedPhraseCount ?? 0, Math.max(0, count - 200));
      if (count > 200) assert.match(log[0].warning, /轉錄術語上限 200/);
      else assert.equal(log[0].warning, undefined);
    }
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENROUTER_API_KEY = originalKey;
  }
});
const localMeetingFile = id => fs.globSync(path.join(process.env.DATA_DIR, '*', id, 'meeting.json'))[0];
const localMeeting = id => JSON.parse(fs.readFileSync(localMeetingFile(id), 'utf8'));
const saveLocalMeeting = (id, meeting) => fs.writeFileSync(localMeetingFile(id), JSON.stringify(meeting, null, 2));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const appendMedia = (id, filename, title, bytes) => admin(`${base}/${id}/sections?${new URLSearchParams({ filename, title })}`, {
  method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: bytes,
});
async function waitMeeting(id, done) {
  for (let i = 0; i < 150; i++) {
    const meeting = await (await admin(`${base}/${id}`)).json();
    if (done(meeting)) return meeting;
    await pause(20);
  }
  throw new Error(`meeting ${id} did not reach the expected state: ${JSON.stringify(await localMeeting(id))}`);
}
function silentWav() {
  const pcm = Buffer.alloc(16000 * 2), header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

test('notes-first JSON creates a validated draft with no media or automatic processing', async () => {
  const malformed = await admin(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400, 'malformed JSON is a client error');
  assert.equal((await admin(base, json('POST', { title: 'bad language', lang: 'zh&x' }))).status, 400);
  const createdResponse = await admin(base, json('POST', { title: 'Planning', notes: 'Notes first', lang: 'en', scheduledAt: '2026-11-10T09:30', tags: ['planning'] }));
  assert.equal(createdResponse.status, 201);
  const draft = await createdResponse.json();
  assert.deepEqual([draft.status, draft.notes, draft.lang, draft.sections, draft.participants], ['draft', 'Notes first', 'en', [], []]);
  assert.equal((await admin(`${base}/${draft.id}/audio`)).status, 404, 'drafts have no audio');
  assert.equal((await admin(`${base}/${draft.id}/summarize`, json('POST', {}))).status, 400, 'summarize requires media');
  const changed = await (await admin(`${base}/${draft.id}`, json('PATCH', { lang: 'zh-TW' }))).json();
  assert.equal(changed.lang, 'zh-TW', 'draft language can be changed');
  assert.equal((await admin(`${base}/${draft.id}`, json('PATCH', { lang: 'x&y' }))).status, 400);
  assert.equal((await admin(`${base}/${draft.id}`)).status, 200, 'draft remains readable without running AI');
});

test('sections append safely under concurrency, enforce permissions and exact permutations, and remap citations', async () => {
  const draft = await (await admin(base, json('POST', { title: 'Sections', lang: 'en' }))).json();
  const media = [Buffer.from('first bytes'), Buffer.from('second bytes')];
  const [left, right] = await Promise.all([
    appendMedia(draft.id, '../unsafe.mp3', 'Unsafe file name', media[0]),
    appendMedia(draft.id, 'C:\\private\\also.wav', 'Windows path', media[1]),
  ]);
  assert.deepEqual([left.status, right.status], [200, 200]);
  const snapshots = await Promise.all([left.json(), right.json()]);
  const [one, two] = [snapshots.find(m => m.sections.length === 1), snapshots.find(m => m.sections.length === 2)];
  assert.ok(one && two, 'per-meeting queue returns serial append snapshots');
  assert.equal(two.sections[0].id, one.sections[0].id);
  assert.notEqual(two.sections[1].id, one.sections[0].id);
  assert.deepEqual(two.sections.map(s => s.originalName).sort(), ['also.wav', 'unsafe.mp3']);
  for (const section of two.sections) {
    assert.match(section.file, /^recording-[0-9a-f-]{36}\.(mp3|wav)$/);
    assert.equal(path.basename(section.file), section.file);
    const expected = section.originalName === 'unsafe.mp3' ? media[0] : media[1];
    assert.deepEqual(fs.readFileSync(path.join(path.dirname(localMeetingFile(draft.id)), section.file)), expected);
  }
  assert.equal(fs.existsSync(path.join(process.env.DATA_DIR, 'unsafe.mp3')), false, 'filename traversal cannot write outside the meeting folder');
  assert.deepEqual(Buffer.from(await (await admin(`${base}/${draft.id}/audio`)).arrayBuffer()), media[two.sections[0].originalName === 'unsafe.mp3' ? 0 : 1]);
  assert.equal((await admin(`${base}/${draft.id}/audio?section=unknown`)).status, 404);

  const member = client();
  assert.equal((await member(`${api}/auth/login`, json('POST', { username: 'mei', password: 'password2' }))).status, 200);
  assert.equal((await member(`${base}/${draft.id}/sections?filename=blocked.wav`, { method: 'POST', body: 'blocked' })).status, 403);
  assert.equal((await member(`${base}/${draft.id}`, json('PATCH', { sections: two.sections.map(({ id, title }) => ({ id, title })) }))).status, 403);

  for (const sections of [
    [{ id: two.sections[0].id, title: 'Only one' }],
    [{ id: two.sections[0].id, title: 'Duplicate' }, { id: two.sections[0].id, title: 'Duplicate again' }],
    [{ id: two.sections[0].id, title: '' }, { id: two.sections[1].id, title: 'Good' }],
    [{ id: two.sections[0].id, title: 'x'.repeat(201) }, { id: two.sections[1].id, title: 'Good' }],
    [{ id: two.sections[0].id, title: 'Good', file: '../../outside' }, { id: two.sections[1].id, title: 'Good' }],
  ]) assert.equal((await admin(`${base}/${draft.id}`, json('PATCH', { sections }))).status, 400);

  const file = localMeetingFile(draft.id), fixture = localMeeting(draft.id);
  fixture.status = 'done';
  fixture.sections = fixture.sections.map(s => ({ ...s, transcribed: true }));
  fixture.segments = fixture.sections.map((s, i) => ({ sectionId: s.id, start: 0, end: 1, speaker: i, text: `section ${i + 1}`, raw: `section ${i + 1}` }));
  fixture.speakers = { 0: 'A', 1: 'B' };
  fixture.summary = 'See [1,2] and [1-2]';
  fixture.actions = [{ text: 'Follow up', owner: 'Boss', done: false, cite: 1 }];
  fixture.comments = [{ id: 'comment-1', userId: 'user-1', name: 'Boss', text: 'comment', seg: 2, createdAt: nowIso() }];
  fixture.speakerHints = [{ speaker: 0, name: 'Candidate', evidence: [1, 2], reason: 'cue' }];
  fixture.summaryStale = false;
  saveLocalMeeting(draft.id, fixture);

  const reordered = await (await admin(`${base}/${draft.id}`, json('PATCH', { sections: [
    { id: two.sections[1].id, title: 'Second renamed' }, { id: two.sections[0].id, title: 'First renamed' },
  ] }))).json();
  assert.deepEqual(reordered.sections.map(s => s.id), [two.sections[1].id, two.sections[0].id]);
  assert.deepEqual(reordered.segments.map(s => s.sectionId), [two.sections[1].id, two.sections[0].id]);
  assert.match(reordered.summary, /\[2、1\].*\[2、1\]/);
  assert.deepEqual([reordered.actions[0].cite, reordered.comments[0].seg, reordered.speakerHints[0].evidence], [2, 1, [2, 1]]);
  assert.equal(reordered.summaryStale, true);

  // A staged upload can finish after processing has been reserved; the queued publish check must reject and clean it up.
  const folder = path.dirname(file);
  let controller, closed = false;
  const body = new ReadableStream({ start(c) { controller = c; c.enqueue(Buffer.from('initial bytes')); } });
  const upload = admin(`${base}/${draft.id}/sections?filename=late.wav&title=Late`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body, duplex: 'half' });
  let staged = false;
  for (let i = 0; i < 100; i++) {
    if (fs.readdirSync(folder).some(name => /^\.upload-[0-9a-f-]+\.tmp$/.test(name))) { staged = true; break; }
    await pause(10);
  }
  try {
    assert.ok(staged, 'upload reached its temporary file before the status changed');
    const busy = localMeeting(draft.id); busy.status = 'summarizing'; saveLocalMeeting(draft.id, busy);
    controller.enqueue(Buffer.from('late bytes')); controller.close(); closed = true;
    const refused = await upload;
    assert.equal(refused.status, 409);
    await refused.text();
    assert.equal(localMeeting(draft.id).sections.length, two.sections.length, 'busy upload was never published');
    assert.equal(fs.readdirSync(folder).some(name => name.startsWith('.upload-')), false, 'staging file was removed');
    const restored = localMeeting(draft.id); restored.status = 'done'; saveLocalMeeting(draft.id, restored);
  } finally {
    if (!closed) { controller.close(); await upload.catch(() => {}); }
  }
});

test('pending sections transcribe through transcribeClean in order, isolate speakers, remap citations, and reuse cached transcripts', async () => {
  const draft = await (await admin(base, json('POST', { title: 'Multi section', lang: 'en', notes: 'Please summarize Existing A before Pending B.' }))).json();
  const cached = await (await appendMedia(draft.id, 'existing.wav', 'Existing A', Buffer.from('cached audio'))).json();
  const existingId = cached.sections[0].id;
  const fixture = localMeeting(draft.id);
  fixture.status = 'done';
  fixture.sections[0].transcribed = true;
  fixture.segments = [{ sectionId: existingId, start: 12, end: 13, speaker: 0, text: 'cached transcript', raw: 'cached transcript' }];
  fixture.speakers = { 0: 'Existing speaker' };
  fixture.summary = 'Cached point [1]';
  fixture.actions = [{ text: 'Keep reference', owner: 'Boss', done: false, cite: 1 }];
  fixture.comments = [{ id: 'comment-pending', userId: 'user-1', name: 'Boss', text: 'on cached line', seg: 1, createdAt: nowIso() }];
  fixture.speakerHints = [{ speaker: 0, name: 'Candidate', evidence: [1], reason: 'cue' }];
  fixture.summaryStale = false;
  saveLocalMeeting(draft.id, fixture);
  const pending = await (await appendMedia(draft.id, 'pending.wav', 'Pending B', silentWav())).json();
  const pendingId = pending.sections.find(s => s.id !== existingId).id;
  assert.equal(pending.sections.find(s => s.id === pendingId).transcribed, false);
  const order = await admin(`${base}/${draft.id}`, json('PATCH', { sections: [
    { id: pendingId, title: 'Pending B' }, { id: existingId, title: 'Existing A' },
  ] }));
  assert.equal(order.status, 200);

  const savedEnv = Object.fromEntries(['LLM_PROVIDER', 'OPENAI_BASE_URL', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY'].map(k => [k, process.env[k]]));
  const originalFetch = globalThis.fetch;
  let transcribeCalls = 0, summaryCalls = 0, holdSummary = true, capturedPrompt = '', releaseSummary;
  let signalSummary;
  const summaryStarted = new Promise(resolve => { signalSummary = resolve; });
  const summaryText = '## 摘要\nPending B [1]，Existing A [2]\n## 重點\n- 兩段分開整理 [1] [2]\n## 決策\n- 無\n## 待辦事項\n- [ ] 後續 — Boss [2]';
  const openaiReply = content => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 8 } }),
    { headers: { 'Content-Type': 'application/json' } });
  process.env.LLM_PROVIDER = 'openai';
  process.env.OPENAI_BASE_URL = 'http://section-test/v1';
  process.env.OPENAI_API_KEY = 'fake-section-key';
  process.env.OPENROUTER_API_KEY = 'fake-transcription-key';
  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (target.startsWith('http://127.0.0.1:')) return originalFetch(url, options);
    if (target === 'https://openrouter.ai/api/v1/audio/transcriptions') {
      transcribeCalls++;
      return new Response(JSON.stringify({ language: 'en', duration: 1, segments: [{ start: 0, end: 1, speaker: 0, text: `pending ${transcribeCalls}` }] }),
        { headers: { 'Content-Type': 'application/json' } });
    }
    if (target === 'http://section-test/v1/chat/completions') {
      const request = JSON.parse(options.body), prompt = request.messages[1].content;
      if (prompt.startsWith('候選名字：')) return openaiReply('{"hints":[]}');
      if (!prompt.startsWith('結構：')) throw new Error(`unexpected local LLM prompt: ${prompt.slice(0, 40)}`);
      summaryCalls++; capturedPrompt = prompt;
      if (holdSummary) {
        holdSummary = false;
        signalSummary();
        await new Promise(resolve => { releaseSummary = resolve; });
      }
      return openaiReply(summaryText);
    }
    throw new Error(`unexpected external request: ${target}`);
  };
  try {
    const start = await admin(`${base}/${draft.id}/summarize`, json('POST', {}));
    assert.equal(start.status, 202, 'summary reserves processing before it starts');
    const started = await Promise.race([summaryStarted.then(() => true), pause(5000).then(() => false)]);
    assert.equal(started, true, `summary model was not reached; meeting=${JSON.stringify(await (await admin(`${base}/${draft.id}`)).json())}`);

    const inFlight = await (await admin(`${base}/${draft.id}`)).json();
    assert.deepEqual(inFlight.segments.map(s => s.sectionId), [pendingId, existingId]);
    assert.deepEqual(inFlight.segments.map(s => s.speaker), [1, 0], 'the pending section receives a distinct speaker number');
    assert.deepEqual(inFlight.segments.map(s => s.start), [0, 12], 'timestamps remain local to each section');
    assert.match(inFlight.summary, /\[2\]/);
    assert.deepEqual([inFlight.actions[0].cite, inFlight.comments[0].seg, inFlight.speakerHints[0].evidence], [2, 2, [2]]);
    const directive = capturedPrompt.slice(capturedPrompt.indexOf('錄音段落順序'));
    assert.ok(directive.indexOf('1. Pending B') < directive.indexOf('2. Existing A'), 'summary prompt explicitly preserves current section order');
    assert.ok(capturedPrompt.indexOf('## Pending B') < capturedPrompt.indexOf('## Existing A'), 'transcript headings follow the same order');
    assert.match(capturedPrompt, /必須包含這些段落：## 摘要、## 重點、## 決策、## 待辦事項/);

    assert.equal((await admin(`${base}/${draft.id}/summarize`, json('POST', {}))).status, 409, 'a second summary cannot reserve an already busy meeting');
    assert.equal((await admin(`${base}/${draft.id}`, json('PATCH', { lang: 'zh-TW' }))).status, 409);
    assert.equal((await admin(`${base}/${draft.id}`, json('PATCH', { sections: [{ id: pendingId, title: 'Pending B' }, { id: existingId, title: 'Existing A' }] }))).status, 409);
    assert.equal((await appendMedia(draft.id, 'busy.wav', 'Busy', Buffer.from('busy'))).status, 409);
    const noteEdit = await admin(`${base}/${draft.id}`, json('PATCH', { notes: 'Edited while summary was waiting.' }));
    assert.equal(noteEdit.status, 200);
    releaseSummary();

    const done = await waitMeeting(draft.id, m => m.status === 'done');
    assert.equal(done.summaryStale, true, 'notes changed after the model input was captured');
    assert.equal(done.notes, 'Edited while summary was waiting.');
    assert.equal(transcribeCalls, 1, 'the already transcribed section was reused');
    assert.equal(summaryCalls, 1);

    const again = await admin(`${base}/${draft.id}/summarize`, json('POST', {}));
    assert.equal(again.status, 202);
    const cachedDone = await waitMeeting(draft.id, m => m.status === 'done');
    assert.equal(transcribeCalls, 1, 'a second summary does not retranscribe cached sections');
    assert.deepEqual(cachedDone.segments.map(s => s.speaker), [1, 0]);
    assert.equal(cachedDone.summaryStale, false);
  } finally {
    releaseSummary?.();
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(savedEnv)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});
test('private review prompts and per-user meeting threads stay isolated and grounded', async () => {
  const member = client(), readonly = client(), anonymous = client();
  await admin(`${api}/admin/settings`, json('PUT', { registration: true }));
  const memberSignup = await member(`${api}/auth/register`, json('POST', { username: 'reviewer', password: 'password1', displayName: 'Questioner' }));
  assert.equal(memberSignup.status, 201);
  const viewerSignup = await readonly(`${api}/auth/register`, json('POST', { username: 'review-viewer', password: 'password1' }));
  const viewer = (await viewerSignup.json()).user;
  await admin(`${api}/admin/users/${viewer.id}`, json('PUT', { role: 'readonly' }));
  await admin(`${api}/admin/settings`, json('PUT', { registration: false }));
  const memberProfileResponse = await member(`${api}/me/profile`, json('PUT', { displayName: 'Synthetic Questioner', team: 'Synthetic Team' }));
  assert.equal(memberProfileResponse.status, 200);
  const memberProfile = await memberProfileResponse.json();

  const meeting = await (await admin(base, json('POST', { title: 'Synthetic Review Context', notes: 'Synthetic meeting notes.' }))).json();
  const route = `${base}/${meeting.id}/review`;
  await admin(`${base}/${meeting.id}`, json('PATCH', { access: 'edit', agentId: 'general' }));
  const fixture = localMeeting(meeting.id);
  fixture.agentId = 'general';
  fixture.status = 'done';
  fixture.notes = 'Synthetic meeting notes.';
  fixture.summary = 'Synthetic prior summary [1].';
  fixture.actions = [{ text: 'Deliver synthetic plan', owner: 'Synthetic Owner', done: false, cite: 2 }];
  fixture.tags = ['synthetic-tag'];
  fixture.glossary = 'SyntheticTerm';
  fixture.sections = [
    { id: 'section-a', title: 'Alpha Section', originalName: 'alpha.wav', file: '', mime: 'audio/wav', transcribed: true },
    { id: 'section-b', title: 'Beta Section', originalName: 'beta.wav', file: '', mime: 'audio/wav', transcribed: true },
  ];
  fixture.segments = [
    { sectionId: 'section-a', start: 0, end: 1, speaker: 0, text: 'Synthetic alpha transcript.', raw: 'Synthetic alpha transcript.' },
    { sectionId: 'section-b', start: 2, end: 3, speaker: 0, text: 'Synthetic beta transcript.', raw: 'Synthetic beta transcript.' },
  ];
  fixture.speakers = { 0: 'Speaker A' };
  saveLocalMeeting(meeting.id, fixture);
  fs.writeFileSync(path.join(process.env.DATA_DIR, 'knowledge.json'), JSON.stringify({
    glossary: [{ term: 'SyntheticBackground', meaning: 'Synthetic meaning' }], notes: ['Synthetic background only.'],
  }));

  const savedEnv = Object.fromEntries(['LLM_PROVIDER', 'OPENAI_BASE_URL', 'OPENAI_API_KEY'].map(k => [k, process.env[k]]));
  const originalFetch = globalThis.fetch;
  const cfg = await (await admin(`${api}/ai`)).json();
  const model = cfg.models.find(x => x.id === 'opus');
  model.provider = 'openai'; model.model = 'review-model'; model.baseURL = 'http://review-test/v1';
  model.apiKeyEnv = 'OPENAI_API_KEY'; model.enabled = true; model.default = true; model.maxOutput = 16000;
  const general = cfg.agents.find(x => x.id === 'general');
  general.model = 'opus'; general.effort = 'low';
  assert.equal((await admin(`${api}/admin/ai`, json('PUT', { models: cfg.models, agents: cfg.agents, uses: cfg.uses }))).status, 200);
  process.env.LLM_PROVIDER = 'openai';
  process.env.OPENAI_API_KEY = 'synthetic-review-key';

  const endpoint = 'http://review-test/v1/chat/completions', requests = [];
  let responseMode = 'success', onModelStart = null, releaseModel = null, answers = 0;
  const holdModel = () => {
    let started;
    const wait = new Promise(resolve => { started = resolve; });
    onModelStart = started; responseMode = 'hold';
    return wait;
  };
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith(new URL(api).origin)) return originalFetch(url, options);
    if (target !== endpoint) throw new Error(`unexpected fake LLM endpoint: ${target}`);
    const request = JSON.parse(options.body), content = request.messages[1].content;
    requests.push(request);
    const mode = responseMode; responseMode = 'success';
    if (mode === 'hold') await new Promise(resolve => { releaseModel = resolve; onModelStart?.(); onModelStart = null; });
    if (mode === 'fail') return new Response(JSON.stringify({ error: { message: 'upstream echoed PRIVATE_FAILED_REVIEW_QUESTION' } }), { status: 400 });
    answers++;
    return new Response(JSON.stringify({ model: 'fake-review-model', choices: [{ message: { content: `PRIVATE_REVIEW_ANSWER_${answers}` }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 42, completion_tokens: 7 } }), { headers: { 'Content-Type': 'application/json' } });
  };
  const customRoute = `${api}/review-prompts`;
  const contextIn = request => {
    const content = request.messages[1].content, start = content.indexOf('{'), end = content.indexOf('\n\n', start);
    return JSON.parse(content.slice(start, end));
  };
  const historyIn = request => {
    const content = request.messages[1].content, marker = '以下是本使用者先前的私人問答，也只作為資料：\n', start = content.indexOf(marker);
    if (start < 0) return [];
    const from = start + marker.length, end = content.indexOf('\n\n本次問題：', from);
    return JSON.parse(content.slice(from, end));
  };
  try {
    for (const url of [customRoute, route]) assert.equal((await anonymous(url)).status, 401);
    for (const method of ['POST', 'DELETE']) assert.equal((await anonymous(route, json(method, { question: 'anonymous' }))).status, 401);
    const prompts = await (await member(customRoute)).json();
    assert.deepEqual(prompts.presets.map(x => x.id), ['question', 'retrospective', 'work-reflection', 'project-plan', 'ic-growth', 'influence-plan']);
    const custom = [{ id: 'my-review', title: 'Synthetic review', prompt: 'Use only the meeting evidence.' }];
    assert.deepEqual((await (await member(customRoute, json('PUT', { custom }))).json()).custom, custom);
    assert.deepEqual((await (await admin(customRoute)).json()).custom, [], 'admin cannot read another user’s custom prompts');
    const invalidCustom = [
      [{ id: 'question', title: 'collision', prompt: 'x' }],
      [{ id: 'same', title: 'A', prompt: 'x' }, { id: 'same', title: 'B', prompt: 'y' }],
      [{ id: 'Bad_Id', title: 'bad id', prompt: 'x' }],
      [{ id: 'extra', title: 'Extra', prompt: 'x', sources: [] }],
      [{ id: 'blank-title', title: ' ', prompt: 'x' }],
      [{ id: 'blank-prompt', title: 'Title', prompt: ' ' }],
      [{ id: 'long-title', title: 'x'.repeat(81), prompt: 'y' }],
      [{ id: 'long-prompt', title: 'x', prompt: 'y'.repeat(10001) }],
      Array.from({ length: 21 }, (_, i) => ({ id: `prompt-${i}`, title: 'Title', prompt: 'Prompt' })),
    ];
    for (const bad of invalidCustom) assert.equal((await member(customRoute, json('PUT', { custom: bad }))).status, 400);
    assert.equal((await member(customRoute, json('PUT', { custom, userId: 'someone-else' }))).status, 400);
    assert.deepEqual((await (await member(customRoute)).json()).custom, custom, 'invalid writes leave the saved custom list intact');

    assert.equal((await member(customRoute, { method: 'PATCH' })).status, 405);
    const emptyThread = await (await member(route)).json();
    assert.deepEqual(emptyThread.messages, []);
    assert.match(emptyThread.contextHash, /^[0-9a-f]{64}$/);
    assert.deepEqual((await (await readonly(route)).json()).messages, [], 'readonly can see only its own empty thread');
    assert.equal((await readonly(route, { method: 'DELETE' })).status, 200);
    const empty = await (await admin(base, json('POST', { title: 'Empty review draft' }))).json();
    await admin(`${base}/${empty.id}`, json('PATCH', { access: 'edit' }));
    const requestCount = requests.length;
    assert.equal((await member(`${base}/${empty.id}/review`, json('POST', { question: 'no context' }))).status, 400);
    assert.equal(requests.length, requestCount, 'empty meetings never call an LLM');
    assert.equal((await member(route, json('POST', { question: 'ok', meetingId: empty.id }))).status, 400, 'body fields cannot change scope');
    assert.equal((await member(route, json('POST', { question: 'x'.repeat(10001) }))).status, 400);
    const savedWindow = model.contextWindow;
    model.contextWindow = 100;
    assert.equal((await admin(`${api}/admin/ai`, json('PUT', { models: cfg.models, agents: cfg.agents, uses: cfg.uses }))).status, 200);
    const beforePreflight = requests.length;
    const preflight = await member(route, json('POST', { question: 'Should fail before spending tokens' }));
    assert.equal(preflight.status, 400, 'context-window preflight errors remain deterministic client errors');
    assert.equal(requests.length, beforePreflight, 'context-window rejection occurs before the model endpoint');
    assert.equal((localMeeting(meeting.id).usage ?? []).filter(x => x.kind === 'review').length, 0);
    model.contextWindow = savedWindow;
    assert.equal((await admin(`${api}/admin/ai`, json('PUT', { models: cfg.models, agents: cfg.agents, uses: cfg.uses }))).status, 200);

    const firstQuestion = 'PRIVATE_REVIEW_QUESTION';
    const first = await member(route, json('POST', { question: firstQuestion }));
    assert.equal(first.status, 200);
    const firstBody = await first.json(), firstTurn = firstBody.messages[0];
    assert.deepEqual(Object.keys(firstTurn).sort(), ['answer', 'contextHash', 'createdAt', 'effort', 'id', 'model', 'question']);
    assert.deepEqual([firstTurn.question, firstTurn.answer, firstTurn.model, firstTurn.effort], [firstQuestion, 'PRIVATE_REVIEW_ANSWER_1', 'review-model', 'low']);
    assert.match(firstBody.contextHash, /^[0-9a-f]{64}$/);
    assert.equal(firstTurn.contextHash, firstBody.contextHash);
    const firstRequest = requests.find(r => r.messages[1].content.includes(JSON.stringify(firstQuestion)));
    const context = contextIn(firstRequest);
    assert.deepEqual(context.questioner, { displayName: 'Synthetic Questioner' }, 'only the authenticated display name is supplied as identity metadata');
    assert.equal(context.title, 'Synthetic Review Context');
    assert.equal(context.notes, 'Synthetic meeting notes.');
    assert.equal(context.summary, 'Synthetic prior summary [1].');
    assert.deepEqual(context.actions[0], { text: 'Deliver synthetic plan', owner: 'Synthetic Owner', cite: 2, done: false });
    assert.deepEqual(context.tags, ['synthetic-tag']);
    assert.deepEqual(context.glossary, ['SyntheticTerm']);
    assert.deepEqual(context.sections.map(s => s.title), ['Alpha Section', 'Beta Section']);
    assert.match(context.transcript, /\[1\].*Synthetic alpha transcript/);
    assert.ok(firstRequest.messages[0].content.includes('SyntheticBackground') && firstRequest.messages[0].content.includes('不是本次會議事實'));
    assert.ok(firstRequest.messages[0].content.includes('Speaker 標籤') && firstRequest.messages[0].content.includes('不要強制使用摘要或待辦事項格式'));
    assert.deepEqual([firstRequest.model, firstRequest.reasoning_effort, firstRequest.max_completion_tokens], ['review-model', 'low', 8192]);

    const privateProfile = await (await member(`${api}/auth/me`)).json();
    const privateMeeting = await (await member(`${base}/${meeting.id}`)).json();
    const privateSearch = await (await member(`${api}/search?q=${encodeURIComponent(firstQuestion)}`)).json();
    assert.doesNotMatch(JSON.stringify(privateProfile) + JSON.stringify(memberProfile), /PRIVATE_REVIEW_QUESTION|PRIVATE_REVIEW_ANSWER/);
    assert.doesNotMatch(JSON.stringify(privateMeeting), /PRIVATE_REVIEW_QUESTION|PRIVATE_REVIEW_ANSWER/);
    assert.deepEqual(privateSearch.results, [], 'search never indexes private review content');
    assert.equal(localMeeting(meeting.id).review, undefined, 'turns are not written to meeting.json');
    assert.equal((await (await admin(route)).json()).messages.length, 0, 'owner/admin reads only its own thread');

    model.maxOutput = 2048;
    assert.equal((await admin(`${api}/admin/ai`, json('PUT', { models: cfg.models, agents: cfg.agents, uses: cfg.uses }))).status, 200);
    const adminQuestion = 'PRIVATE_ADMIN_QUESTION';
    assert.equal((await admin(route, json('POST', { question: adminQuestion }))).status, 200);
    assert.deepEqual((await (await member(route)).json()).messages.map(x => x.question), [firstQuestion]);
    assert.deepEqual((await (await admin(route)).json()).messages.map(x => x.question), [adminQuestion], 'each user has a separate thread');
    const secondQuestion = 'Follow up on the previous turn';
    assert.equal((await member(route, json('POST', { question: secondQuestion }))).status, 200);
    const secondRequest = requests.find(r => r.messages[1].content.includes(JSON.stringify(secondQuestion)));
    assert.deepEqual(historyIn(secondRequest).map(x => [x.question, x.answer, x.potentiallyStale]), [[firstQuestion, 'PRIVATE_REVIEW_ANSWER_1', false]]);
    assert.equal(secondRequest.max_completion_tokens, 2048, 'review cap does not raise a configured lower output limit');

    const startConcurrent = holdModel();
    const concurrentRequest = member(route, json('POST', { question: 'Concurrent request one' }));
    await startConcurrent;
    assert.equal((await member(route, json('POST', { question: 'Concurrent request two' }))).status, 409);
    assert.equal((await member(route, { method: 'DELETE' })).status, 409, 'clearing cannot race a pending answer');
    releaseModel(); releaseModel = null;
    assert.equal((await concurrentRequest).status, 200);

    const startStale = holdModel();
    const staleRequest = member(route, json('POST', { question: 'Question while sections are reordered' }));
    await startStale;
    const currentMeeting = await (await admin(`${base}/${meeting.id}`)).json();
    const reorder = await admin(`${base}/${meeting.id}`, json('PATCH', { sections: currentMeeting.sections.reverse().map(({ id, title }) => ({ id, title })) }));
    assert.equal(reorder.status, 200);
    const changedHash = (await (await member(route)).json()).contextHash;
    assert.notEqual(changedHash, firstBody.contextHash, 'section order contributes to the context hash');
    const reorderedHash = changedHash;
    assert.equal((await admin(`${base}/${meeting.id}`, json('PATCH', { title: 'Synthetic Review Context Renamed' }))).status, 200);
    const titleHash = (await (await member(route)).json()).contextHash;
    assert.notEqual(titleHash, reorderedHash, 'meeting title contributes to the review context hash');
    releaseModel(); releaseModel = null;
    assert.equal((await staleRequest).status, 409, 'changed meeting context rejects the pending answer without saving it');
    assert.equal((await (await member(route)).json()).messages.length, 3);
    const afterReorderQuestion = 'Question after section reorder';
    assert.equal((await member(route, json('POST', { question: afterReorderQuestion }))).status, 200);
    const afterReorderRequest = requests.find(r => r.messages[1].content.includes(JSON.stringify(afterReorderQuestion)));
    assert.ok(historyIn(afterReorderRequest).every(x => x.potentiallyStale), 'prior answers with old hashes are marked potentially stale');
    assert.ok(afterReorderRequest.messages[0].content.includes('目前會議資料具有優先性'));

    responseMode = 'fail';
    const failedQuestion = 'PRIVATE_FAILED_REVIEW_QUESTION';
    const failed = await member(route, json('POST', { question: failedQuestion }));
    assert.equal(failed.status, 502);
    assert.doesNotMatch(await failed.text(), /PRIVATE_FAILED_REVIEW_QUESTION|upstream echoed/);
    const currentMessages = await (await member(route)).json();
    assert.equal(currentMessages.messages.length, 4, 'failed model calls do not save turns');
    const failedUsage = localMeeting(meeting.id).usage.filter(x => x.kind === 'review').at(-1);
    assert.equal(failedUsage.error, 'review request failed');
    assert.doesNotMatch(JSON.stringify(failedUsage), /PRIVATE_FAILED_REVIEW_QUESTION|upstream echoed/);

    for (const access of ['view', 'comment']) {
      await admin(`${base}/${meeting.id}`, json('PATCH', { access }));
      for (const [account, label] of [[member, 'member'], [readonly, 'readonly']]) {
        const question = `Private ${label} question with ${access} access`;
        const answer = await account(route, json('POST', { question }));
        assert.equal(answer.status, 200, `${label} can ask with ${access} access`);
        assert.equal((await answer.json()).messages.at(-1).question, question);
        assert.equal((await account(`${base}/${meeting.id}`, json('PATCH', { notes: 'must not change shared notes' }))).status, 403);
        assert.equal((await account(`${base}/${meeting.id}/summarize`, json('POST', {}))).status, 403);
        assert.equal((await account(route, { method: 'DELETE' })).status, 200);
        assert.deepEqual((await (await account(route)).json()).messages, []);
        assert.deepEqual((await (await admin(route)).json()).messages.map(x => x.question), [adminQuestion]);
      }
    }
    assert.equal(localMeeting(meeting.id).notes, fixture.notes, 'private reviews do not change shared notes');

    await admin(`${base}/${meeting.id}`, json('PATCH', { access: 'private' }));
    assert.equal((await member(route)).status, 404, 'private meetings and threads are invisible');
    assert.equal((await member(`${base}/${meeting.id}`)).status, 404);
    const deniedCount = requests.length;
    for (const account of [member, readonly]) {
      for (const method of ['GET', 'POST', 'DELETE']) {
        assert.equal((await account(route, method === 'GET' ? {} : json(method, { question: 'inaccessible' }))).status, 404);
      }
    }
    assert.equal(requests.length, deniedCount, 'inaccessible meetings never call the model');
    await admin(`${base}/${meeting.id}`, json('PATCH', { access: 'edit' }));
    const startRevoked = holdModel();
    const revokedRequest = member(route, json('POST', { question: 'No result after access is revoked' }));
    await startRevoked;
    await admin(`${base}/${meeting.id}`, json('PATCH', { access: 'private' }));
    releaseModel(); releaseModel = null;
    assert.equal((await revokedRequest).status, 404, 'revocation during an LLM call returns no private result');

    await admin(`${base}/${meeting.id}`, json('PATCH', { access: 'edit' }));
    const reviewFile = path.join(process.env.DATA_DIR, 'reviews.json'), reviewData = JSON.parse(fs.readFileSync(reviewFile, 'utf8'));
    const memberId = (await (await member(`${api}/auth/me`)).json()).user.id;
    reviewData.users[memberId].meetings[meeting.id] = Array.from({ length: 50 }, (_, i) => ({
      id: `turn-${i}`, question: `synthetic-${i}`, answer: 'synthetic', createdAt: nowIso(), model: 'review-model', effort: 'low', contextHash: changedHash,
    }));
    fs.writeFileSync(reviewFile, JSON.stringify(reviewData));
    const full = await member(route, json('POST', { question: 'one too many' }));
    assert.equal(full.status, 409);
    assert.match((await full.json()).error, /清除歷史紀錄/);
    assert.equal((await (await member(route)).json()).messages.length, 50, 'the turn cap never silently drops saved messages');
    assert.equal((await (await member(route, { method: 'DELETE' })).json()).messages.length, 0);
    assert.deepEqual((await (await admin(route)).json()).messages.map(x => x.question), [adminQuestion], 'clearing affects only the caller’s thread');
    assert.deepEqual((await (await member(customRoute)).json()).custom, custom, 'clearing a thread retains the caller’s custom prompts');
    assert.equal(fs.statSync(reviewFile).mode & 0o777, 0o600, 'reviews.json uses the existing private jsonStore mode');
  } finally {
    releaseModel?.();
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(savedEnv)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});
