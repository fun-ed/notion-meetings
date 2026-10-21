"""Shared scoring for the zh-TW + English jargon test set (see docs/research/2026-10-20-stt-evaluation.md)."""
import re, subprocess, difflib
from collections import Counter
from pathlib import Path

TERMS = Path(__file__).with_name('terms.txt').read_text(encoding='utf-8').split('\n')
TERMS = [t for t in TERMS if t]
# Simplified forms of characters that appear in the reference lines; used to count leftover Simplified script.
T2S = dict(zip('這從飆們順調數夠請過處後財說補費勞稅節權時確認麼還會', '这从飙们顺调数够请过处后财说补费劳税节权时确认么还会'))
S2T = {v: k for k, v in T2S.items()}
norm = lambda s: re.sub(r'[\s\-_.,，。、:：;；!?！？"“”\'()（）]', '', s.lower())

def load_set(d):
    lines = [l.rstrip('\n').split('\t') for l in open(f'{d}/lines.tsv', encoding='utf-8')]
    durs = [float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f'{d}/l{i + 1}.wav']))
            for i in range(len(lines))]
    return [v for v, _ in lines], [t for _, t in lines], durs

def text_score(full, refs):
    # Jargon is scored after Simplified→Traditional so it measures hearing; script is reported separately.
    nf = norm(''.join(S2T.get(c, c) for c in full))
    missed = [t for t in TERMS if norm(t) not in nf]
    return {'terms': f'{len(TERMS) - len(missed)}/{len(TERMS)}', 'missed': missed,
            'simplified': sum(full.count(c) for c in T2S.values()),
            'diff': round(1 - difflib.SequenceMatcher(None, norm(''.join(refs)), nf, autojunk=False).ratio(), 3)}

def speaker_score(items, voices, durs, tempo):
    """items: [{start,end,speaker}]. Labels each reference line by the item nearest its midpoint."""
    starts = [sum(durs[:i]) / tempo for i in range(len(durs))]
    mids = [s + (durs[i] - 0.6) / tempo / 2 for i, s in enumerate(starts)]
    lab = [min(items, key=lambda g: max(g['start'] - m, m - g['end'], 0)).get('speaker') for m in mids]
    per_voice = {v: Counter(l for l, vv in zip(lab, voices) if vv == v) for v in set(voices)}
    ok = sum(c.most_common(1)[0][1] for c in per_voice.values() if c.most_common(1)[0][0] is not None)
    return {'spk_consistent': f'{ok}/{len(voices)}',
            'voices_separated': f'{len({c.most_common(1)[0][0] for c in per_voice.values()})}/{len(per_voice)}'}
