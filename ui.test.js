import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { loadMarkdownRuntime } from './ui-assets.js';

const html = fs.readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const script = scripts.at(-1);
const esc = html.match(/^const esc = .*;$/m)[0];
const markdownSource = script.slice(script.indexOf('function markdown('), script.indexOf('const pendingNotes'));

function markdownContext() {
  const dom = new JSDOM('', { runScripts: 'outside-only' });
  dom.window.eval(loadMarkdownRuntime());
  const context = dom.getInternalVMContext();
  vm.runInContext(`${esc}\n${markdownSource}\n${script.slice(script.indexOf('const cites ='), script.indexOf('function transcriptCopy('))}`, context);
  return context;
}

function fullUiContext(fetcher = async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => ({}) }), play = () => Promise.resolve(), confirm = () => true) {
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only' });
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {} });
  dom.window.fetch = fetcher;
  dom.window.confirm = confirm;
  Object.defineProperty(dom.window.crypto, 'randomUUID', { configurable: true, value: () => 'new-review-prompt-id' });
  dom.window.Element.prototype.scrollIntoView = () => {};
  const playCalls = [], pauseCalls = [];
  dom.window.HTMLMediaElement.prototype.play = function () { playCalls.push(this); return play(this); };
  dom.window.HTMLMediaElement.prototype.pause = function () { pauseCalls.push(this); };
  dom.window.eval(loadMarkdownRuntime());
  const context = dom.getInternalVMContext();
  const run = source => vm.runInContext(source, context);
  run(script.replace(/boot\(\);\s*$/, ''));
  for (const name of ['me', 'current', 'tab', 'reviewStates', 'reviewPromptsCache']) {
    Object.defineProperty(context, name, { configurable: true, get: () => run(name), set: value => {
      context.__uiValue = value;
      run(`${name} = __uiValue`);
    } });
  }
  const set = values => {
    const entries = Object.entries(values);
    entries.forEach(([, value], index) => { context[`__ui${index}`] = value; });
    run(entries.map(([name], index) => `${name} = __ui${index}`).join('\n'));
  };
  return { dom, context, run, set, playCalls, pauseCalls };
}

const meetingFixture = (overrides = {}) => ({
  id: '11111111-1111-4111-8111-111111111111', title: 'Synthetic meeting', createdAt: '2026-11-10T10:00:00+08:00',
  sections: [], segments: [], summary: '', summaryStale: false, notes: '', status: 'draft', template: 'auto',
  speakers: {}, actions: [], tags: [], location: '', brief: '', scheduledAt: '', agentId: 'general', lang: 'zh-TW',
  language: '', glossary: '', outputLang: '', instructions: '', people: [], participants: [], teams: [], usage: [],
  perm: 'edit', access: 'view', comments: [], speakerHints: [], ...overrides,
});
const apiResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300, status, statusText: status === 409 ? 'Conflict' : 'OK', json: async () => body,
});
const flushUi = () => new Promise(resolve => setImmediate(resolve));

test('UI scripts parse and full Markdown renders with safe links and literal HTML', () => {
  for (const source of scripts) new vm.Script(source);
  const context = markdownContext(), box = context.document.createElement('div');
  box.innerHTML = context.markdown('# 議程\n\n**重點** 和 *說明*\n\n- [x] 完成\n1. 下一步\n\n> 引言\n\n```js\n<script>alert(1)</script>\n```\n[文件](https://example.com)');
  assert.equal(box.querySelector('h1').textContent, '議程');
  assert.equal(box.querySelector('strong').textContent, '重點');
  assert.equal(box.querySelector('em').textContent, '說明');
  assert.equal(box.querySelector('input').disabled, true);
  assert.equal(box.querySelector('input').checked, true);
  assert.ok(box.querySelector('ol'));
  assert.equal(box.querySelector('blockquote').textContent.trim(), '引言');
  assert.equal(box.querySelector('pre code').textContent.trim(), '<script>alert(1)</script>');
  assert.equal(box.querySelector('a').href, 'https://example.com/');
  for (const value of ['[執行](javascript:alert)', '[內容](data:text/html,bad)', '[編碼](javascript&#58;alert)', '<img src=x onerror=alert(1)>', '<svg onload=alert(1)>', '<input id=notes name=current>']) {
    box.innerHTML = context.markdown(value);
    assert.equal(box.querySelector('script, img, svg, input, [onclick], [onerror], [onload], [id], [name], [href]'), null, value);
  }
  assert.equal(context.markdown('`**literal**`').trim(), '<p><code>**literal**</code></p>');
  box.innerHTML = context.markdown('```\n未結束的程式碼');
  assert.equal(box.querySelector('pre code').textContent.trim(), '未結束的程式碼');
  assert.doesNotMatch(context.markdown('[引號](https://example.com/"onclick="x)'), /href="[^"]*"onclick=/);
});

test('shared Markdown supports GFM tables, nested lists, references and images', () => {
  const context = markdownContext(), box = context.document.createElement('div');
  box.innerHTML = context.markdown('標題\n===\n\n| 項目 | 狀態 |\n| :--- | ---: |\n| **API** | ~~舊版~~ |\n\n1. 父項\n   - 子項\n     - 孫項\n\n[文件][doc] 與 https://example.com\n\n[doc]: https://example.com/docs "參考"\n\n![示意圖](https://example.com/image.png)\n\n---');
  assert.equal(box.querySelector('h1').textContent, '標題');
  assert.equal(box.querySelector('thead th').textContent, '項目');
  assert.equal(box.querySelector('tbody td strong').textContent, 'API');
  assert.equal(box.querySelector('tbody td del').textContent, '舊版');
  assert.equal(box.querySelector('ol > li > ul > li > ul > li').textContent.trim(), '孫項');
  assert.equal(box.querySelector('a[title="參考"]').href, 'https://example.com/docs');
  assert.equal(box.querySelectorAll('a').length, 2);
  assert.equal(box.querySelector('img').alt, '示意圖');
  assert.ok(box.querySelector('hr'));
  assert.match(html, /class="summary markdown"/);
  assert.match(html, /class="markdown">\$\{markdown\(c.text\)\}/);
  assert.equal(context.markdown('**API** 與 `code`', true), '<strong>API</strong> 與 <code>code</code>');
  assert.match(html, /markdown\(a.text, true\)/);
});

test('summary Markdown preserves action indexes, saved completion and citation targets', () => {
  const context = markdownContext(), box = context.document.createElement('div');
  const m = { id: 'meeting', summary: '```\n- [ ] 程式碼示例\n```\n\n- [ ] **測試** — _Amy_ [2]\n- [ ] 父項\n  - [x] 子項 — Bob [3]\n\n引用 [2] 與 [2-3]，程式碼 `[3]` 與 [文件](https://example.com/3)。', actions: [
    { text: '程式碼示例', owner: '未指定', done: false }, { text: '測試', owner: '_Amy_', done: true },
    { text: '父項', owner: '未指定', done: false }, { text: '子項', owner: 'Bob', done: false },
  ] };
  const before = JSON.stringify(m);
  box.innerHTML = context.renderSummary(m);
  const inputs = [...box.querySelectorAll('input')];
  assert.deepEqual(inputs.map(input => input.checked), [true, false, false]);
  assert.deepEqual(inputs.map(input => input.disabled), [false, false, false]);
  assert.deepEqual(inputs.map(input => input.getAttribute('onchange')), [1, 2, 3].map(i => `setDone("meeting", ${i}, this.checked)`));
  assert.ok(box.querySelector('label.todo.done'));
  assert.equal(box.querySelector('a.cite').getAttribute('onclick'), 'return seek(2)');
  assert.ok([...box.querySelectorAll('a.cite')].some(a => a.textContent === '[2-3]' && a.getAttribute('onclick') === 'return seek(2)'));
  assert.equal(box.querySelector('code a, pre a, a a'), null);
  assert.equal(box.querySelector('a[href="https://example.com/3"]').textContent, '文件');
  assert.equal(JSON.stringify(m), before, 'rendering must not mutate stored Markdown or actions');
});

test('notes autosave retains edits made while a previous save is in flight', async () => {
  let release;
  const saved = [], status = { dataset: { copyKind: 'notes' } };
  const context = vm.createContext({
    current: { id: 'draft', notes: '' },
    tab: 'notes',
    $: () => status,
    clearTimeout: () => {}, setTimeout: () => 1,
    invalidateReview: () => {},
    api: async (_url, opts) => {
      const { notes } = JSON.parse(opts.body);
      saved.push(notes);
      if (saved.length === 1) await new Promise(resolve => { release = resolve; });
      return { id: 'draft', notes };
    },
    json: (_method, body) => ({ body: JSON.stringify(body) }),
  });
  const source = script.slice(script.indexOf('const pendingNotes'), script.indexOf('function notesEditor'));
  vm.runInContext(source, context);
  context.editNotes('第一版');
  assert.equal(status.disabled, false, 'typing notes immediately enables copying');
  const first = context.saveNotes();
  await new Promise(resolve => setImmediate(resolve));
  context.editNotes('第二版');
  release();
  await first;
  assert.equal(context.current.notes, '第二版');
  await context.saveNotes();
  assert.deepEqual(saved, ['第一版', '第二版']);
  assert.equal(status.textContent, '已儲存');
  context.api = async () => { throw new Error('offline'); };
  context.editNotes('離線內容');
  await assert.rejects(context.saveNotes(), /offline/);
  assert.equal(context.current.notes, '離線內容');
  assert.match(status.textContent, /儲存失敗/);
  context.api = async (_url, opts) => ({ id: 'draft', notes: JSON.parse(opts.body).notes });
  await context.saveNotes();
  assert.equal(context.current.notes, '離線內容');
  assert.equal(status.textContent, '已儲存');
  vm.runInContext("pendingNotes.set('blocked', '# retained')", context);
  context.api = async (url, opts) => {
    if (url.endsWith('/blocked')) throw Error('permission revoked');
    return { id: 'draft', notes: JSON.parse(opts.body).notes };
  };
  context.editNotes('另一場會議仍可儲存');
  await context.saveNotes();
  assert.equal(context.current.notes, '另一場會議仍可儲存');
  assert.equal(vm.runInContext("pendingNotes.get('blocked')", context), '# retained');
  assert.equal(vm.runInContext("pendingNotes.has('draft')", context), false);
});

test('multiple uploads keep selection order, stop on failure and retain saved sections', async () => {
  const calls = [], alerts = [], sections = [];
  const context = vm.createContext({
    current: { id: 'meeting', notes: '# 筆記', sections: [] }, pendingNotes: new Map(), pollTimer: null,
    location: { hash: '#meeting' },
    URLSearchParams, clearTimeout: () => {}, render: () => {}, refreshList: () => {},
    saveNotes: async () => {}, $: () => ({}), alert: message => alerts.push(message),
    api: async (url, opts) => {
      calls.push(new URL(url, 'http://localhost').searchParams.get('filename'));
      if (calls.length === 3) throw new Error('連線中斷');
      sections.push({ id: String(calls.length), title: opts.body.name });
      return { id: 'meeting', notes: '# 筆記', sections: [...sections] };
    },
  });
  vm.runInContext(script.slice(script.indexOf('let uploading ='), script.indexOf('async function upload(blob')), context);
  await context.uploadFiles(['C.mp3', 'A.mp4', 'B.wav', 'D.mp3'].map(name => ({ name })));
  assert.deepEqual(calls, ['C.mp3', 'A.mp4', 'B.wav']);
  assert.deepEqual(context.current.sections.map(s => s.title), ['C.mp3', 'A.mp4']);
  assert.match(alerts[0], /已成功上傳的 section 仍然保留/);
});

test('upload completion does not replace another route or overwrite another meeting', async () => {
  for (const destination of ['#actions', '#search=test', '#other:notes']) {
    const rendered = [];
    let refreshed = 0;
    const context = vm.createContext({
      current: { id: 'meeting', notes: 'original' }, location: { hash: '#meeting' },
      pendingNotes: new Map(), pollTimer: null, URLSearchParams, clearTimeout: () => {},
      render: m => rendered.push(m.id), refreshList: () => refreshed++, saveNotes: async () => {},
      $: () => ({}), alert: () => {},
      api: async () => {
        context.location.hash = destination;
        if (destination.startsWith('#other')) context.current = { id: 'other', notes: 'other notes' };
        return { id: 'meeting', notes: 'server response' };
      },
    });
    vm.runInContext(script.slice(script.indexOf('let uploading ='), script.indexOf('async function upload(blob')), context);
    await context.uploadFiles([{ name: 'clip.wav' }]);
    assert.deepEqual(rendered, destination.startsWith('#other') ? ['meeting', 'other'] : ['meeting']);
    assert.equal(context.current.notes, destination.startsWith('#other') ? 'other notes' : 'original');
    assert.equal(refreshed, 1);
  }
});

test('transcript highlight keeps the latest segment within its section across gaps or missing end times', () => {
  const audio = { paused: false, currentTime: 4 };
  let active;
  const elements = new Map([1, 2, 3].map(n => {
    const el = { scrollIntoView() {}, classList: { add() { active = el; }, remove() { active = null; } } };
    return [`seg-${n}`, el];
  }));
  const context = vm.createContext({
    $: () => audio, selectedSection: 'a', activeSeg: 0,
    current: { segments: [{ sectionId: 'a', start: 0, end: 1 }, { sectionId: 'b', start: 3 }, { sectionId: 'a', start: 6 }] },
    document: { getElementById: id => elements.get(id), querySelector: () => active },
  });
  vm.runInContext(script.slice(script.indexOf('function syncTranscript()'), script.indexOf('async function addComment()')), context);
  context.syncTranscript();
  assert.equal(context.activeSeg, 1);
  audio.currentTime = 7;
  context.syncTranscript();
  assert.equal(context.activeSeg, 3);
});

test('failed note saves retain the pending draft and still allow navigation', async () => {
  let opened = 0;
  const warnings = [], pendingNotes = new Map([['meeting', '# unsaved']]);
  const context = vm.createContext({
    pendingNotes, saveNotes: async () => { throw Error('offline'); }, alert: text => warnings.push(text),
    rec: null, me: {}, location: { hash: '#actions' }, $: () => ({}),
    document: { querySelectorAll: () => [] }, showActions: () => { opened++; },
  });
  vm.runInContext(script.slice(script.indexOf('async function route()'), script.indexOf("window.addEventListener('hashchange'")), context);
  await context.route();
  assert.equal(opened, 1);
  assert.equal(pendingNotes.get('meeting'), '# unsaved');
  assert.match(warnings[0], /內容仍暫存在此分頁/);
});

test('transcript copy follows section order, speaker names and visible text mode', () => {
  const definitions = ['fmt', 'spk', 'tidy'].map(name => html.match(new RegExp(`^const ${name} = .*;$`, 'm'))[0]).join('\n');
  const context = vm.createContext({});
  vm.runInContext(`${definitions}\nlet showRaw = false, tidyView = true;\n${script.slice(script.indexOf('function transcriptCopy('), script.indexOf('function renderedCopyText('))}`, context);
  const m = {
    sections: [{ id: 'b', title: 'B & 確認' }, { id: 'a', title: 'A' }], speakers: { 0: 'Amy', 1: 'Bob' },
    segments: [{ sectionId: 'b', start: 1, speaker: 0, text: '嗯，內容 & <tag>', raw: 'RAW B' },
      { sectionId: 'a', start: 3, speaker: 1, text: '其他', raw: 'RAW A' }, { sectionId: 'b', start: 4, speaker: 0, text: '嗯。', raw: 'RAW filler' }],
  };
  assert.equal(context.transcriptCopy(m, 'b'), 'Section 1：B & 確認\n[1] 00:01 Amy：內容 & <tag>');
  assert.equal(context.transcriptCopy(m, 'a'), 'Section 2：A\n[2] 00:03 Bob：其他');
  const all = context.transcriptCopy(m);
  assert.ok(all.indexOf('B & 確認') < all.indexOf('Section 2：A'));
  assert.equal(context.transcriptCopy(m, 'missing'), '');
  vm.runInContext('showRaw = true', context);
  assert.match(context.transcriptCopy(m, 'b'), /RAW B[\s\S]*RAW filler/);
  assert.doesNotMatch(context.transcriptCopy(m, 'b'), /RAW A/);
  vm.runInContext('showRaw = false; tidyView = false', context);
  assert.match(context.transcriptCopy(m, 'b'), /嗯。/);
  assert.match(context.transcriptCopy({ originalName: 'legacy.wav', segments: [{ start: 0, speaker: 0, text: '舊逐字稿' }] }), /Section 1：legacy.wav\n\[1\] 00:00 Speaker A：舊逐字稿/);
});

test('copy uses rendered plain text, scopes transcript sections and reports clipboard errors', async () => {
  const writes = [], rendered = [], status = {};
  const context = vm.createContext({
    current: { notes: '**重點** & <內容>' }, $: () => status,
    markdown: () => '<strong>重點</strong> &amp; &lt;內容&gt;', renderSummary: () => '<h3>摘要</h3>',
    renderedCopyText: html => { rendered.push(html); return html.startsWith('<h3>') ? '摘要' : '重點 & <內容>'; },
    transcriptCopy: (_m, id) => `Section ${id}`,
    navigator: { clipboard: { writeText: async text => writes.push(text) } },
  });
  vm.runInContext(script.slice(script.indexOf('async function copyContent('), script.indexOf('function seek(')), context);
  await context.copyContent('notes');
  assert.equal(writes[0], '重點 & <內容>');
  assert.match(rendered[0], /<strong>/);
  assert.equal(status.textContent, '已複製到剪貼簿');
  await context.copyContent('summary');
  assert.equal(writes[1], '摘要');
  await context.copyContent('transcript', 'b');
  assert.equal(writes[2], 'Section b');
  context.navigator.clipboard.writeText = async () => { throw Error('denied'); };
  await context.copyContent('summary');
  assert.match(status.textContent, /瀏覽器未允許複製/);
  context.navigator = {};
  await context.copyContent('summary');
  assert.match(status.textContent, /手動選取文字複製/);
  context.renderedCopyText = () => '';
  await context.copyContent('notes');
  assert.equal(status.textContent, '尚無可複製的內容');
  assert.equal(writes.length, 3);
});

test('processing actions distinguish pending audio, fresh summaries and stale summaries', () => {
  const context = vm.createContext({});
  vm.runInContext(script.slice(script.indexOf('function processingAction('), script.indexOf('function render(')), context);
  const action = m => JSON.parse(JSON.stringify(context.processingAction(m)));
  assert.equal(context.processingAction({ sections: [] }), null);
  assert.deepEqual(action({ sections: [{ transcribed: false }], summary: '' }), { label: '轉錄並產生摘要', primary: true, retranscribe: false });
  assert.deepEqual(action({ sections: [{ transcribed: true }], summary: '' }), { label: '產生摘要', primary: true, retranscribe: true });
  assert.deepEqual(action({ sections: [{ transcribed: true }], summary: '摘要', summaryStale: true }), { label: '更新摘要', primary: true, retranscribe: true });
  assert.deepEqual(action({ sections: [{ transcribed: true }], summary: '摘要' }), { label: '重新產生摘要', primary: false, retranscribe: true });
  assert.equal(action({ sections: [{ transcribed: true }, { transcribed: false }], summary: '舊摘要' }).label, '轉錄並產生摘要');
});

test('mobile sidebar starts closed, closes after navigation and preserves desktop preference', () => {
  const classes = new Set(), stored = new Map(), writes = [];
  let changed, navigate, focused;
  const media = { matches: true, addEventListener: (_event, callback) => { changed = callback; } };
  const context = vm.createContext({
    matchMedia: () => media, setSideWidth: () => {},
    document: { body: { classList: { contains: name => classes.has(name), toggle: (name, value) => value ? classes.add(name) : classes.delete(name) } } },
    localStorage: { getItem: name => stored.get(name), setItem: (name, value) => { writes.push([name, value]); stored.set(name, value); } },
    $: selector => selector === 'aside' ? { addEventListener: (_event, callback) => { navigate = callback; } } : { focus: () => { focused = selector; } },
  });
  vm.runInContext(script.slice(script.indexOf('const narrowScreen ='), script.indexOf("$('#resizer').addEventListener")), context);
  assert.equal(classes.has('side-collapsed'), true);
  assert.equal(writes.length, 0);
  context.toggleSide(false);
  assert.equal(focused, 'aside a:not([hidden])');
  navigate({ target: { closest: () => ({}) } });
  assert.equal(classes.has('side-collapsed'), true);
  assert.equal(focused, '#side-open');
  media.matches = false; changed();
  assert.equal(classes.has('side-collapsed'), false);
  context.toggleSide(true);
  assert.equal(stored.get('sideCollapsed'), '1');
  media.matches = true; changed(); context.toggleSide(false);
  assert.equal(stored.get('sideCollapsed'), '1', 'opening the mobile overlay must not change desktop preference');
  media.matches = false; changed();
  assert.equal(classes.has('side-collapsed'), true);
});

test('section play buttons autoplay, seek stays paused, and the shared player follows A-B-A', () => {
  const { dom, context, playCalls, pauseCalls } = fullUiContext();
  const meeting = meetingFixture({ status: 'done', sections: [
    { id: 'a', title: 'First <section>', originalName: 'first.mp3', transcribed: true },
    { id: 'b', title: 'Second', originalName: 'second.mp3', transcribed: true },
  ], segments: [{ sectionId: 'b', start: 4, end: 5, speaker: 0, text: '對照音訊', raw: '對照音訊' }] });
  context.me = { id: 'reviewer', role: 'member', displayName: 'Tester' };
  context.current = meeting;
  context.render(meeting);
  let audio = dom.window.document.querySelector('#audio');
  assert.equal(audio.getAttribute('src'), `/api/meetings/${meeting.id}/audio?section=a`);
  assert.equal(dom.window.document.querySelector('.current-section').textContent, '目前選取：第 1 部分 · First <section>');
  const firstButton = dom.window.document.querySelector('.media-section button[data-keep]');
  assert.equal(firstButton.textContent, '已選取');
  assert.equal(firstButton.getAttribute('aria-pressed'), 'true');
  assert.match(firstButton.getAttribute('aria-label'), /播放第 1 部分：First/);
  assert.doesNotMatch(firstButton.textContent, /目前播放/);
  context.setRate(1.5);
  context.render(meeting);
  assert.equal(dom.window.document.querySelector('#audio'), audio, 'same-section renders retain the shared audio element');
  assert.equal(audio.playbackRate, 1.5);

  const buttons = () => [...dom.window.document.querySelectorAll('.media-section button[data-keep]')];
  vm.runInContext(buttons()[1].getAttribute('onclick'), context);
  let audioB = dom.window.document.querySelector('#audio');
  assert.equal(audioB.getAttribute('src'), `/api/meetings/${meeting.id}/audio?section=b`);
  assert.equal(playCalls.at(-1), audioB);
  assert.equal(pauseCalls.at(-1), audio);
  vm.runInContext(buttons()[0].getAttribute('onclick'), context);
  const audioA = dom.window.document.querySelector('#audio');
  assert.equal(audioA.getAttribute('src'), `/api/meetings/${meeting.id}/audio?section=a`);
  assert.equal(playCalls.at(-1), audioA);
  assert.notEqual(audioA, audioB);
  const playsBeforeSeek = playCalls.length;
  assert.equal(context.seek(1), false);
  assert.equal(dom.window.document.querySelector('#audio').getAttribute('src'), `/api/meetings/${meeting.id}/audio?section=b`);
  assert.equal(playCalls.length, playsBeforeSeek, 'citation seeking selects and jumps without autoplay');
  context.playSection('a');

  meeting.perm = 'view';
  meeting.sections = [meeting.sections[1], { ...meeting.sections[0], title: 'Renamed <section>' }];
  context.render(meeting);
  assert.equal(dom.window.document.querySelector('.current-section').textContent, '目前選取：第 2 部分 · Renamed <section>');
  const readonlyPlay = buttons()[1];
  assert.equal(readonlyPlay.disabled, false);
  vm.runInContext(readonlyPlay.getAttribute('onclick'), context);
  assert.equal(playCalls.at(-1), dom.window.document.querySelector('#audio'), 'readonly users can still play sections');
});

test('section playback errors are visible and expected AbortError is ignored', async () => {
  let failure = Error('unsupported codec');
  const { dom, context, playCalls } = fullUiContext(undefined, () => Promise.reject(failure));
  const meeting = meetingFixture({ status: 'done', sections: [
    { id: 'a', title: 'First', originalName: 'first.mp3', transcribed: true },
    { id: 'b', title: 'Second', originalName: 'second.mp3', transcribed: true },
  ] });
  context.me = { id: 'reviewer', role: 'member' };
  context.current = meeting;
  context.render(meeting);
  context.playSection('a', true);
  await flushUi();
  assert.match(dom.window.document.querySelector('#player-status').textContent, /unsupported codec/);
  failure = Object.assign(Error('source changed'), { name: 'AbortError' });
  context.playSection('b', true);
  await flushUi();
  assert.equal(dom.window.document.querySelector('#player-status').textContent, '');
  assert.equal(playCalls.length, 2);
});

test('note-only drafts expose private review, save personal prompts, and never load answer images', async () => {
  const prompts = { presets: [
    { id: 'question', title: '會議問題', prompt: '請依會議內容回答。', sources: [
      { title: '參考指南', url: 'https://example.com/guide' }, { title: '不安全連結', url: 'javascript:alert(1)' },
    ] },
  ], custom: [{ id: 'existing', title: '既有提示', prompt: '保留這個提示。' }] };
  const writes = [];
  const fetcher = async (path, options = {}) => {
    if (path === '/api/review-prompts' && options.method === 'PUT') {
      const body = JSON.parse(options.body); writes.push(body.custom);
      return apiResponse({ presets: prompts.presets, custom: body.custom });
    }
    if (path === '/api/review-prompts') return apiResponse(prompts);
    if (path.endsWith('/review')) return apiResponse({ contextHash: 'same', messages: [{
      id: 'saved', question: '舊問題', answer: '參考 [1]。\n\n![遠端圖片](https://example.com/private.png)',
      createdAt: '2026-11-10T10:00:00+08:00', model: 'synthetic-model', effort: 'low', contextHash: 'same',
    }] });
    return apiResponse({});
  };
  const { dom, context } = fullUiContext(fetcher);
  const meeting = meetingFixture({ notes: '# 草稿筆記' });
  context.me = { id: 'reviewer', role: 'member' };
  context.current = meeting;
  context.render(meeting);
  assert.ok(dom.window.document.querySelector('#notes'), 'note-only drafts keep the notes editor available');
  assert.ok([...dom.window.document.querySelectorAll('[role=tab]')].some(tab => tab.textContent === '會議檢討'));
  context.setTab('review');
  await flushUi();
  await flushUi();
  assert.match(dom.window.document.querySelector('.review').textContent, /只有目前帳號能在此 app 查看對話；對話不隨會議分享/);
  assert.equal(dom.window.document.querySelectorAll('.review-sources a').length, 1);
  assert.ok(dom.window.document.querySelector('.review-message .cite'));
  const answer = dom.window.document.querySelector('.review-message .markdown');
  assert.equal(answer.querySelector('img'), null, 'private answers must not trigger remote image requests');
  assert.match(answer.textContent, /遠端圖片/);

  dom.window.document.querySelector('#review-title').value = '我的回顧';
  dom.window.document.querySelector('#review-prompt').value = '先區分事實與推測。';
  await context.saveReviewPrompt();
  assert.equal(writes[0].length, 2, 'saving a built-in prompt preserves the other personal prompts');
  const saved = writes[0].find(prompt => prompt.id === 'new-review-prompt-id');
  assert.deepEqual({ title: saved.title, prompt: saved.prompt }, { title: '我的回顧', prompt: '先區分事實與推測。' });
  dom.window.document.querySelector('#review-prompt').value = '更新後的個人提示。';
  await context.saveReviewPrompt();
  assert.equal(writes[1].length, 2);
  assert.equal(writes[1].find(prompt => prompt.id === saved.id).prompt, '更新後的個人提示。');
  const other = context.reviewState('22222222-2222-4222-8222-222222222222');
  context.reviewState(meeting.id).question = '目前草稿';
  other.question = '另一場草稿';
  assert.notEqual(context.reviewState(meeting.id).question, other.question);
  context.resetReviewData();
  context.me = { id: 'different-account', role: 'member' };
  assert.equal(context.reviewStates.size, 0, 'logout/account switch clears private review drafts and history');
  assert.equal(context.reviewPromptsCache, null);
});

test('review asks save latest notes first, reject oversized combined input, and retain drafts on 409', async () => {
  const calls = [], meeting = meetingFixture({ notes: '舊筆記' });
  const prompts = { presets: [{ id: 'question', title: '一般提問', prompt: '請依目前會議內容回答。' }], custom: [] };
  const fetcher = async (path, options = {}) => {
    const method = options.method ?? 'GET';
    calls.push({ path, method, body: options.body ? JSON.parse(options.body) : null });
    if (path === '/api/review-prompts') return apiResponse(prompts);
    if (path.endsWith('/review') && method === 'GET') return apiResponse({ contextHash: 'current', messages: [] });
    if (path.endsWith('/review') && method === 'POST') return apiResponse({ error: '會議內容已變更，請重試。' }, 409);
    if (method === 'PATCH') return apiResponse({ ...meeting, notes: JSON.parse(options.body).notes });
    return apiResponse({});
  };
  const { dom, context } = fullUiContext(fetcher);
  context.me = { id: 'reviewer', role: 'member' };
  context.current = meeting;
  context.tab = 'review';
  context.render(meeting);
  await flushUi();
  await flushUi();
  context.setReviewField('prompt', 'p'.repeat(10000));
  dom.window.document.querySelector('#review-question').value = '問題';
  context.setReviewField('question', '問題');
  await context.askReview();
  assert.match(dom.window.document.querySelector('[role=alert]').textContent, /提示詞與問題合計超過 10,000 字元/);
  assert.equal(calls.some(call => call.method === 'POST'), false);

  context.setReviewField('prompt', '依目前會議內容回答。');
  dom.window.document.querySelector('#review-question').value = '依最新筆記，我下一步要做什麼？';
  context.setReviewField('question', dom.window.document.querySelector('#review-question').value);
  vm.runInContext("pendingNotes.set(current.id, '最新筆記')", context);
  await context.askReview();
  const patchAt = calls.findIndex(call => call.method === 'PATCH');
  const postAt = calls.findIndex(call => call.method === 'POST');
  assert.ok(patchAt >= 0 && patchAt < postAt, 'the newest draft notes are saved before the review request');
  assert.equal(calls[patchAt].body.notes, '最新筆記');
  assert.match(calls[postAt].body.question, /依最新筆記，我下一步要做什麼？/);
  assert.match(dom.window.document.querySelector('#review-question').value, /依最新筆記/);
  assert.match(dom.window.document.querySelector('[role=alert]').textContent, /會議內容已變更/);
  assert.equal(context.reviewStates.get(meeting.id).needsRefresh, true);
});

test('in-flight review GET and POST responses cannot reactivate citations after section reordering', async () => {
  const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
  const gets = [deferred(), deferred(), deferred()];
  const post = deferred();
  let getCount = 0;
  const prompts = { presets: [{ id: 'question', title: '一般提問', prompt: '請回答。' }], custom: [] };
  const oldMessage = { id: 'old', question: '舊問題', answer: '舊引用 [2]', model: 'model', contextHash: 'before' };
  const fetcher = async (path, options = {}) => {
    if (path === '/api/review-prompts') return apiResponse(prompts);
    if (path.endsWith('/review') && options.method === 'POST') return post.promise;
    if (path.endsWith('/review')) return ++getCount <= gets.length ? gets[getCount - 1].promise : apiResponse({
      contextHash: 'after', messages: [oldMessage],
    });
    return apiResponse({});
  };
  const { dom, context } = fullUiContext(fetcher);
  const meeting = meetingFixture({ status: 'done', sections: [
    { id: 'a', title: 'First', originalName: 'first.mp3', transcribed: true },
    { id: 'b', title: 'Second', originalName: 'second.mp3', transcribed: true },
  ] });
  context.me = { id: 'reviewer', role: 'member' };
  context.current = meeting;
  context.tab = 'review';
  const state = context.reviewState(meeting.id);
  state.loaded = true;
  state.contextHash = 'before';
  state.messages = [oldMessage];
  context.invalidateReview(meeting.id);
  context.render(meeting);
  meeting.sections = [meeting.sections[1], meeting.sections[0]];
  context.invalidateReview(meeting.id);
  context.render(meeting);
  gets[0].resolve(apiResponse({ contextHash: 'before', messages: [oldMessage] }));
  await flushUi();
  await flushUi();
  assert.equal(getCount, 2, 'an obsolete GET automatically triggers a fresh context read');
  assert.equal(state.contextHash, 'before', 'the obsolete response does not replace the last known hash');
  assert.equal(dom.window.document.querySelector('.review-message .cite'), null);
  gets[1].resolve(apiResponse({ contextHash: 'after', messages: [oldMessage] }));
  await flushUi();
  await flushUi();
  assert.equal(state.contextHash, 'after');
  assert.equal(dom.window.document.querySelector('.review-message .cite'), null);

  dom.window.document.querySelector('#review-question').value = '新問題';
  context.setReviewField('question', '新問題');
  const asking = context.askReview();
  await flushUi();
  meeting.sections = [meeting.sections[1], meeting.sections[0]];
  context.invalidateReview(meeting.id);
  context.render(meeting);
  assert.equal(dom.window.document.querySelector('.review-message .cite'), null);
  post.resolve(apiResponse({ contextHash: 'before', messages: [{ ...oldMessage, id: 'late' }] }));
  await asking;
  assert.equal(state.needsRefresh, true);
  assert.equal(dom.window.document.querySelector('.review-message .cite'), null);
  gets[2].resolve(apiResponse({ contextHash: 'after', messages: [{ ...oldMessage, id: 'late' }] }));
  await flushUi();
  await flushUi();
  await flushUi();
  assert.equal(state.contextHash, 'after');
  assert.equal(dom.window.document.querySelector('.review-message .cite'), null, 'stale citations stay plain until the response hash matches');
  assert.match(dom.window.document.querySelector('.review-history').textContent, /會議內容已有變更/);
  assert.equal(getCount, 4, 'the pending GET is discarded and followed by another current-context read');
});
