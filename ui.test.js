import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const script = scripts.at(-1);
const esc = html.match(/^const esc = .*;$/m)[0];
const markdownSource = script.slice(script.indexOf('function markdown('), script.indexOf('const pendingNotes'));

test('UI scripts parse and Markdown notes render without executing HTML or unsafe links', () => {
  for (const source of scripts) new vm.Script(source);
  const context = vm.createContext({});
  vm.runInContext(`${esc}\n${markdownSource}`, context);
  const render = text => context.markdown(text);
  const output = render('# 議程\n**重點** 和 *說明*\n- [x] 完成\n1. 下一步\n> 引言\n```js\n<script>alert(1)</script>\n```\n[文件](https://example.com)');
  for (const expected of ['<h1>議程</h1>', '<strong>重點</strong>', '<em>說明</em>', 'type="checkbox" disabled checked', '<ol>', '<blockquote>引言</blockquote>', '<pre><code>', 'href="https://example.com"']) assert.ok(output.includes(expected), expected);
  assert.doesNotMatch(output, /<script>/);
  assert.doesNotMatch(render('[執行](javascript:alert) [內容](data:text/html,bad) <img src=x onerror=alert(1)>'), /href=|<img/);
  assert.equal(render('`**literal**`'), '<p><code>**literal**</code></p>');
  assert.match(render('```\n未結束的程式碼'), /<pre><code>未結束的程式碼<\/code><\/pre>/);
  assert.doesNotMatch(render('[引號](https://example.com/"onclick="x)'), /href="[^"]*"onclick=/);
});

test('notes autosave retains edits made while a previous save is in flight', async () => {
  let release;
  const saved = [], status = {};
  const context = vm.createContext({
    current: { id: 'draft', notes: '' },
    $: () => status,
    clearTimeout: () => {}, setTimeout: () => 1,
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
