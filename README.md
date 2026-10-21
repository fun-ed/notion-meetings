# notion-meetings

English | [繁體中文](README.zh-TW.md)

A local clone of Notion AI Meeting Notes. Record or upload a meeting, get a speaker-separated transcript in Taiwan Traditional Chinese with correct English technical terms, and let Claude write the summary and action items.

Releases: <https://github.com/fun-ed/notion-meetings/releases> · Changes: [CHANGELOG.md](CHANGELOG.md)

![Meeting page](docs/images/meeting.png)

## Features

- Microphone recording or upload of audio and video (mp4, mov, m4a, mp3, wav, webm). The original file is kept and can be downloaded.
- Transcription with MAI-Transcribe 2 through OpenRouter (zero data retention), OpenCC conversion to Taiwan wording, and a Claude pass that fixes only the terms in the meeting glossary. Unsure words are marked 【?】 and the raw output is kept.
- Speaker correction: rename speakers, reassign one segment or a range, merge two speakers, and add participants who did not speak.
- Learning loop: meeting terms become a team glossary applied to every transcription; Hangul or kana in a Chinese transcript is flagged 【?】; Claude suggests who each speaker is from name cues ("thanks, X"), and you apply a suggestion with one click; corrected meetings can be frozen as a benchmark to track speaker accuracy and CER.
- Summaries from configurable agents (DRI handover, architecture, EKS upgrade, CI/CD, design reviews and others). Each point cites its transcript line.
- Action items across meetings, grouped by meeting, team, owner or Y leader.
- Search with Simplified/Traditional matching and filters such as `tag:`, `who:`, `team:`, `after:`.
- Accounts with admin, member and read-only roles, per-meeting access, revocable share links and comments.
- AI usage per call (tokens, audio seconds, cost, time), light and dark themes, and Taiwan time (GMT+8) throughout.

![Transcript with speaker range correction (dark theme)](docs/images/transcript-dark.png)

![Action items](docs/images/action-items.png)

## Requirements

| Item | Notes |
|---|---|
| ffmpeg | On `PATH` (`brew install ffmpeg`, `apt install ffmpeg`) |
| OpenRouter key | Required for transcription |
| Claude | `ANTHROPIC_API_KEY`, or a gateway via `ANTHROPIC_BASE_URL` |
| Node.js | Only when running from source |

Store the OpenRouter key outside the project, readable only by you (zsh):

```bash
read -s "K?OpenRouter key: " && mkdir -p ~/.config/openrouter && printf %s "$K" > ~/.config/openrouter/key && chmod 600 ~/.config/openrouter/key && unset K
```

`OPENROUTER_API_KEY` overrides the file. Restrict the key with an OpenRouter guardrail: allow only `microsoft/mai-transcribe-2` and turn on zero data retention.

## Run

From a release binary (macOS, Linux, Windows):

```bash
ANTHROPIC_API_KEY=... ./notion-meetings-v<version>-darwin-arm64
```

On macOS, run `xattr -d com.apple.quarantine <file>` once after downloading. Data goes to `~/.notion-meetings`.

From source:

```bash
mise exec -- npm install
mise exec -- npm start              # Anthropic API (ANTHROPIC_API_KEY)
mise exec -- npm run start:magpie   # local magpie gateway at 127.0.0.1:3425
```

Open <http://localhost:3000>. The first account you create is the admin.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Server port |
| `DATA_DIR` | `./data` (binary: `~/.notion-meetings`) | Meetings, accounts, directory and model settings |
| `OPENROUTER_API_KEY` | `~/.config/openrouter/key` | Transcription key |
| `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY` | Anthropic API | Default endpoint and key for Anthropic models |
| `OPENAI_BASE_URL`, `OPENAI_API_KEY` | — | Default endpoint and key for OpenAI-compatible models (for example LiteLLM) |

Admins configure LLMs under Admin › Models. Each model has a provider, an LLM endpoint and an API key:

- **OpenAI-compatible** (recommended): a company LiteLLM proxy, magpie or OpenAI, for example `https://litellm.example.com/v1`. Use "讀取模型" to pick a model ID from the endpoint.
- **Anthropic**: the native Anthropic API.

The API key is entered once in the admin page and stored only on this Mac in `data/secrets.json` (mode 600). Models on the same endpoint share it, and the page shows only its last four characters. You can name an environment variable instead. Term correction and speaker suggestions can use their own model. Built-in profiles include Claude Opus 5.5 (default), Sonnet 5.5, GPT-6.1 Sol and GPT-6 Luna.

## Search syntax

| Query | Matches |
|---|---|
| `kafka 延遲` | Meetings that contain both words |
| `"consumer lag"` | The exact phrase |
| `tag:平台`, `type:站立` | Tag, summary type |
| `who:小美`, `team:SPC`, `leader:Ken`, `group:ZTSA` | Speaker or action owner, by person, team, Y leader or group |
| `after:2026-10-01`, `before:2026-10-31` | Meeting date range, inclusive |

## Privacy

- The server listens on `127.0.0.1` only. It has no HTTPS, so do not expose it to a network.
- Audio goes to OpenRouter's zero-data-retention endpoint. Transcript text and agent skills go to the LLM endpoint you configure; a company LiteLLM proxy is recommended.
- Live captions while recording are off by default. When turned on, they use only the browser's on-device speech recognition and never fall back to a cloud service.
- `data/` is not tracked by git. Each meeting is stored in `data/<YYYY-MM-DD>/<id>/` as the original recording and `meeting.json`. The team glossary and benchmark results are in `data/learned.json` on each Mac.
- Passwords are hashed with scrypt. Sessions are HttpOnly cookies held in server memory, so a restart signs everyone out.

## Development

```bash
mise exec -- npm test        # unit and API tests, no external calls
mise exec -- npm run build   # single-file binaries in dist/ (Bun)
```

The pipeline regression test (`eval/e2e.py`) and the binary release check (`scripts/smoke-binary.sh`) call the real APIs. The steps are in the `meetings-dev` skill.

| Path | Contents |
|---|---|
| [docs/decisions.md](docs/decisions.md) | Decisions and reasons. Read before changing code |
| [docs/architecture.md](docs/architecture.md) | Pipeline, data fields, API |
| [docs/plans/](docs/plans/) | Plans, named `YYYY-MM-DD-<topic>.md` |
| [docs/research/](docs/research/) | Transcription model evaluations |
| `.claude/skills/meetings-dev` | Development, testing, build and release |
| `.claude/skills/stt-research` | Evaluating new transcription models |
