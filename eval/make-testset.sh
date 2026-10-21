#!/usr/bin/env bash
# Build the zh-TW + English jargon test set into <out-dir>:
#   meeting.mp3       clean, 3 voices (macOS `say`)
#   meeting-hard.mp3  pink noise + phone band + 1.15x tempo + echo
# Scorers read lines.tsv and l<n>.wav from the same dir for reference text and line timing.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="${1:?usage: make-testset.sh <out-dir>}"
mkdir -p "$out"
cp "$here/lines.tsv" "$out/"
: > "$out/list.txt"
i=0
while IFS=$'\t' read -r voice text; do
  i=$((i + 1))
  say -v "$voice" "$text" -o "$out/l$i.aiff"
  ffmpeg -loglevel error -y -i "$out/l$i.aiff" -af apad=pad_dur=0.6 -ar 16000 -ac 1 "$out/l$i.wav"
  echo "file 'l$i.wav'" >> "$out/list.txt"
done < "$here/lines.tsv"
ffmpeg -loglevel error -y -f concat -safe 0 -i "$out/list.txt" -b:a 48k "$out/meeting.mp3"
# Encode via WAV: piping the filter graph straight into libmp3lame truncated the last frame.
ffmpeg -loglevel error -y -i "$out/meeting.mp3" -f lavfi -i "anoisesrc=color=pink:amplitude=0.12:d=80:sample_rate=16000" \
  -filter_complex "[0]aresample=16000,atempo=1.15,highpass=f=300,lowpass=f=3400,aecho=0.8:0.5:60:0.35[s];[s][1]amix=inputs=2:duration=first:weights=1 0.7" \
  -ac 1 "$out/hard.wav"
ffmpeg -loglevel error -y -i "$out/hard.wav" -b:a 24k "$out/meeting-hard.mp3"
echo "$out/meeting.mp3 $out/meeting-hard.mp3"
