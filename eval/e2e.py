"""App regression: upload the test set to a running server and check the acceptance bar.

usage: python3 -I eval/e2e.py <base-url> <testset-dir>
Start the server first (see CLAUDE.md), normally with an empty DATA_DIR: the script then creates the first
(admin) account itself. Against existing data, set E2E_USER / E2E_PASS to an account that can create meetings.
Exits 1 if any bar fails:
  meeting.mp3       terms >= 44/45, 0 Simplified chars, 3 voices separated, every line on its voice's speaker
  meeting-hard.mp3  terms >= 40/45, 0 Simplified chars, 3 voices separated, every line on its voice's speaker
voices_separated alone passes even when a voice drifts to another label mid-meeting, so spk_consistent must be n/n.
"""
import http.cookiejar, json, os, sys, time, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
from score import TERMS, load_set, text_score, speaker_score

base, d = sys.argv[1].rstrip('/'), sys.argv[2]
# Every API call carries the session cookie from the login below.
urllib.request.install_opener(urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())))
creds = {'username': os.environ.get('E2E_USER', 'e2e-admin'), 'password': os.environ.get('E2E_PASS', 'e2e-password')}
post = lambda path, body: urllib.request.urlopen(urllib.request.Request(f'{base}{path}', json.dumps(body).encode(), {'Content-Type': 'application/json'}))
if json.load(urllib.request.urlopen(f'{base}/api/auth/me'))['needsSetup']:
    post('/api/auth/register', creds)
else:
    post('/api/auth/login', creds)
voices, refs, durs = load_set(d)
failed = False
for audio, tempo, min_terms in (('meeting.mp3', 1.0, 44), ('meeting-hard.mp3', 1.15, 40)):
    q = urllib.parse.urlencode({'filename': audio, 'lang': 'zh-TW', 'title': f'e2e {audio}', 'glossary': ', '.join(TERMS)})
    req = urllib.request.Request(f'{base}/api/meetings?{q}', open(f'{d}/{audio}', 'rb').read(), {'Content-Type': 'audio/mpeg'})
    m = json.load(urllib.request.urlopen(req))
    t = time.time()
    while m['status'] not in ('done', 'error') and time.time() - t < 600:
        time.sleep(2)
        m = json.load(urllib.request.urlopen(f"{base}/api/meetings/{m['id']}"))
    text = ''.join(s['text'] for s in m['segments'])
    r = {'audio': audio, 'status': m['status'], 'error': m.get('error'), 'secs': round(time.time() - t),
         **text_score(text, refs), 'unsure_marks': text.count('【?】'),
         **(speaker_score(m['segments'], voices, durs, tempo) if m['segments'] else {})}
    ok = (m['status'] == 'done' and int(r['terms'].split('/')[0]) >= min_terms and r['simplified'] == 0
          and r.get('voices_separated') == '3/3' and r.get('spk_consistent') == f'{len(voices)}/{len(voices)}')
    failed |= not ok
    print(('PASS ' if ok else 'FAIL ') + json.dumps(r, ensure_ascii=False), flush=True)
sys.exit(1 if failed else 0)
