"""Run OpenRouter STT configs against the test set.

usage: python3 -I eval/stt_eval.py <testset-dir> <audio.mp3> <tempo> <configs.json>
tempo is 1.0 for meeting.mp3 and 1.15 for meeting-hard.mp3 (aligns reference line timing).
Config bodies may use "$TERMS" where the glossary list goes. Key: OPENROUTER_API_KEY or ~/.config/openrouter/key.
"""
import base64, json, os, sys, time, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
from score import TERMS, load_set, text_score, speaker_score

KEY = os.environ.get('OPENROUTER_API_KEY') or open(os.path.expanduser('~/.config/openrouter/key')).read().strip()

def stt(body, audio):
    body = {**body, 'input_audio': {'data': base64.b64encode(open(audio, 'rb').read()).decode(), 'format': 'mp3'}}
    req = urllib.request.Request('https://openrouter.ai/api/v1/audio/transcriptions', json.dumps(body).encode(),
                                 {'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
    try:
        return json.load(urllib.request.urlopen(req, timeout=300))
    except urllib.error.HTTPError as e:
        return {'error': e.code, 'body': e.read().decode()[:600]}

def fill(o):
    if o == '$TERMS': return TERMS
    if isinstance(o, dict): return {k: fill(v) for k, v in o.items()}
    if isinstance(o, list): return [fill(v) for v in o]
    return o

d, audio, tempo, configs = sys.argv[1], sys.argv[2], float(sys.argv[3]), json.load(open(sys.argv[4]))
voices, refs, durs = load_set(d)
os.makedirs(f'{d}/results', exist_ok=True)
for name, body in configs:
    t = time.time()
    r = stt(fill(body), f'{d}/{audio}')
    sec = round(time.time() - t, 1)
    if 'error' in r:
        print(json.dumps({'cfg': name, 'audio': audio, 'error': r}, ensure_ascii=False), flush=True)
        continue
    json.dump(r, open(f'{d}/results/{name}-{audio}.json', 'w'), ensure_ascii=False)
    items = [w for w in r.get('words') or [] if 'speaker' in w] or [s for s in r.get('segments') or [] if 'speaker' in s]
    out = {'cfg': name, 'audio': audio, 'sec': sec, 'cost': (r.get('usage') or {}).get('cost'), **text_score(r.get('text', ''), refs),
           **(speaker_score(items, voices, durs, tempo) if items else {'speakers': 'none returned'}), 'text': r.get('text', '')}
    print(json.dumps(out, ensure_ascii=False), flush=True)
