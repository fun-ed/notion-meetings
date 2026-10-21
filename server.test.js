import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'meetings-'));
process.env.OPENROUTER_API_KEY = ''; // never call the real API from tests
const ai = await import('./ai.js');
const { parseTranscription, transcriptText, extOf, toTaiwan, parseTerms, applyNumbered, parseActions, cleanMeta, parseQuery, searchMeetings, parseDirectory, resolver, usageOf, aggregateUsage, migrateLayout, reassignSpeakers, openaiUsage, isTransient, keyScope, mergeTerms, flagForeignScript, cleanHints, cer, speakerAccuracy, termHits, localDay, nowIso, searchMeetings: search2, server } = await import('./server.js');

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
  assert.deepEqual(speakerAccuracy(ref, hyp), { accuracy: 66.7, windows: [100, 0], labels: 2, refSpeakers: 2 }, 'a drifted label counts as wrong in its window');
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
});

test('OpenAI-compatible endpoint: write-only key, model list, retry on 503', async () => {
  let calls = 0;
  const auths = [];
  const fake = http.createServer((req, res) => {
    auths.push(req.headers.authorization);
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'gpt-6-luna' }, { id: 'gpt-6.1-sol' }] }));
    calls++;
    if (calls === 1) { res.statusCode = 503; return res.end(JSON.stringify({ error: { message: 'busy' } })); }
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
    assert.deepEqual([t.ok, t.reply, calls], [true, 'OK', 2], 'a 503 is retried once and then succeeds');
    assert.ok(auths.every(a => a === 'Bearer sk-test-12345678'), 'the stored key is sent to the endpoint');
  } finally { fake.close(); }
});

