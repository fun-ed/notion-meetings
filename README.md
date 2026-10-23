# notion-meetings

English | [繁體中文](README.zh-TW.md)

A local clone of Notion AI Meeting Notes. Record or upload a meeting, get a speaker-separated transcript in Taiwan Traditional Chinese with correct English technical terms, and let Claude write the summary and action items.

Releases: <https://github.com/fun-ed/notion-meetings/releases> · Changes: [CHANGELOG.md](CHANGELOG.md)

![Meeting page](docs/images/meeting.png)

## Features

- Microphone recording or upload of audio and video (mp4, mov, m4a, mp3, wav, webm). The original file is kept and can be downloaded.
- Transcription with MAI-Transcribe 2 through OpenRouter (zero data retention), OpenCC conversion to Taiwan wording, and a Claude pass that fixes only glossary terms. Every edit is checked: anything other than a change into a glossary term or an added 【?】 is reverted. Unsure words are marked 【?】 and the raw output is kept.
- Speaker correction: rename speakers, reassign one segment or a range, merge two speakers, and add participants who did not speak.
- Learning loop: meeting terms become a team glossary applied to every transcription; Hangul or kana in a Chinese transcript is flagged 【?】; Claude suggests who each speaker is from name cues ("thanks, X"), and you apply a suggestion with one click; corrected meetings can be frozen as a benchmark to track speaker accuracy and CER.
- Team knowledge: `data/knowledge.json` lists what your terms mean, their aliases and common mishearings, and team notes. Its terms join the transcription glossary, its mishearings guide the term correction ("CloudCode → Claude Code"), and every agent's summary loads it as background, so acronyms are explained. Add a mishearing once and later meetings get it fixed.
- Tidy transcript view (on by default) hides filler sounds such as 呃 and 嗯 without changing the stored transcript.
- Summaries from configurable agents (DRI handover, architecture, EKS upgrade, CI/CD, design reviews and others). Each point cites its transcript line.
- Action items across meetings, grouped by meeting, team, owner or Y leader.
- Search with Simplified/Traditional matching and filters such as `tag:`, `who:`, `team:`, `after:`.
- Accounts with admin, member and read-only roles, per-meeting access, revocable share links and comments.
- AI usage per call (tokens, audio seconds, cost, time), light and dark themes, and Taiwan time (GMT+8) throughout.
- Transcription diagnostics (0.9.0): check the OpenRouter key allowance, ffmpeg and a short ZDR audio request from the admin page or terminal. Failures include actionable messages and request information without exposing credentials or audio.

![Transcript with speaker range correction (dark theme)](docs/images/transcript-dark.png)

![Action items](docs/images/action-items.png)

## Requirements

| Item | Notes |
|---|---|
| ffmpeg | On `PATH` (`brew install ffmpeg`, `apt install ffmpeg`) |
| OpenRouter key | Required for transcription |
| LLM | The magpie gateway (default) or a company LiteLLM proxy; see Run |
| Node.js | Only when running from source |

Store the OpenRouter key outside the project, readable only by you (zsh):

```bash
read -s "K?OpenRouter key: " && mkdir -p ~/.config/openrouter && printf %s "$K" > ~/.config/openrouter/key && chmod 600 ~/.config/openrouter/key && unset K
```

`OPENROUTER_API_KEY` overrides the file. Restrict the key with an OpenRouter guardrail: allow only `microsoft/mai-transcribe-2` and turn on zero data retention.

## Run

The default setup uses the magpie gateway for every LLM call. A company LiteLLM proxy is an alternative (see below). Transcription always uses OpenRouter MAI-Transcribe 2.

From source:

```bash
mise exec -- npm install
mise exec -- npm run start:magpie   # default: magpie gateway at 127.0.0.1:3425
mise exec -- npm run start:litellm  # company LiteLLM instead of magpie
mise exec -- npm start              # Anthropic API (ANTHROPIC_API_KEY)
```

From a release binary (macOS, Linux, Windows), set the same variables the npm scripts set:

```bash
# magpie
ANTHROPIC_BASE_URL=http://127.0.0.1:3425 ANTHROPIC_API_KEY=magpie OPENAI_BASE_URL=http://127.0.0.1:3425/v1 OPENAI_API_KEY=magpie ./notion-meetings-v<version>-darwin-arm64
# company LiteLLM
LLM_PROVIDER=openai OPENAI_BASE_URL="$(cat ~/.config/litellm/base_url)" OPENAI_API_KEY="$(cat ~/.config/litellm/key)" ./notion-meetings-v<version>-darwin-arm64
```

On macOS, run `xattr -d com.apple.quarantine <file>` once after downloading. The binary stores data in `~/.notion-meetings`.

Open <http://localhost:3000>. The first account you create is the admin.

### Switch to the company LiteLLM

1. Store the endpoint and your own key on this Mac, outside the repo. Do this once:

   ```bash
   mkdir -p ~/.config/litellm && chmod 700 ~/.config/litellm
   echo 'https://<your-litellm-host>/v1' > ~/.config/litellm/base_url
   read -s "K?LiteLLM key: " && printf %s "$K" > ~/.config/litellm/key && chmod 600 ~/.config/litellm/key && unset K
   ```

2. Start with `mise exec -- npm run start:litellm`. Every built-in model without its own endpoint, Claude included, then goes through LiteLLM. The magpie prefix in model IDs (`codex/`) is dropped automatically, and the cost LiteLLM reports is recorded with each call.
3. Under Admin › Models, press "測試" on each model you enable to confirm it answers.

Transcription stays on OpenRouter MAI-Transcribe 2 in both setups. The transcription models on the company LiteLLM did not meet the zh-TW, jargon and speaker bar ([report](docs/research/2026-10-21-litellm.md)), so you still need the OpenRouter key.

### Model pairing

Results are from the synthetic test set ([OpenAI models](docs/research/2026-10-21-openai-models.md), [LiteLLM](docs/research/2026-10-21-litellm.md)).

| Model | magpie ID | LiteLLM ID | Use for | Notes |
|---|---|---|---|---|
| Claude Opus 5.5 | `claude-opus-5-5` | `claude-opus-5-5` | Default for everything | Most careful term correction: marks unsure words 【?】 instead of guessing |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | `claude-sonnet-5-5` | Summaries when cost matters | Half Opus's input price on LiteLLM |
| GPT-6.1 Sol | `codex/gpt-6.1-sol` | `gpt-6.1-sol` | Summaries, or correction when speed matters | Correction passed (45/45, 42/45) and is several times faster, but it once replaced a misheard word with the wrong glossary term without marking it |
| GPT-6 Luna | `codex/gpt-6-luna` | `gpt-6-luna` | Not for term correction | Fastest and cheapest; correction failed the noisy test (39/45) |
| MAI-Transcribe 2 | — | — | Transcription | Through OpenRouter (zero data retention) in every setup |

Recommended: keep Opus 5.5 as the default model. For faster or cheaper summaries, make Sonnet 5.5 or GPT-6.1 Sol the default model (or set it on an agent), and set term correction to Opus 5.5 under Admin › Models › 用途. Speaker suggestions run at low effort and work with any of these.

### Settings

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Server port |
| `DATA_DIR` | `./data` (binary: `~/.notion-meetings`) | Meetings, accounts, directory and model settings |
| `OPENROUTER_API_KEY` | `~/.config/openrouter/key` | Transcription key |
| `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY` | Anthropic API | Default endpoint and key for Anthropic models |
| `OPENAI_BASE_URL`, `OPENAI_API_KEY` | — | Default endpoint and key for OpenAI-compatible models |
| `LLM_PROVIDER` | — | `openai` sends every model without its own endpoint, Claude included, through `OPENAI_BASE_URL` (set by `npm run start:litellm`) |

Admins can also set an endpoint and API key per model under Admin › Models. Use the "OpenAI-compatible" provider for LiteLLM, magpie or OpenAI, and "Anthropic" for the native Anthropic API. "讀取模型" lists the model IDs the endpoint offers. A key entered there is stored only on this Mac in `data/secrets.json` (mode 600), is shared by models on the same endpoint, and the page shows only its last four characters.

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
- `data/` is not tracked by git. Each meeting is stored in `data/<YYYY-MM-DD>/<id>/` as the original recording and `meeting.json`. The team glossary and benchmark results are in `data/learned.json`, and team knowledge in `data/knowledge.json`, on each Mac. Both are always loaded: the glossary and the knowledge's terms into every transcription and term correction, the knowledge's mishearings into term correction, and the knowledge into every summary.
- Passwords are hashed with scrypt. Sessions are HttpOnly cookies held in server memory, so a restart signs everyone out.

## Development

```bash
mise exec -- npm test        # unit and API tests, no external calls
mise exec -- npm run build   # single-file binaries in dist/ (Bun)
```

A manually triggered GitHub Actions workflow (`gh workflow run ci.yml`) runs the unit tests, builds the five binaries, checks `SHA256SUMS` and starts the Linux x64 binary. The pipeline regression test (`eval/e2e.py`) and the binary release check (`scripts/smoke-binary.sh`) call the real APIs, so they run manually; the steps are in the `meetings-dev` skill.

### Transcription diagnostics

For transcription failures, use **Admin → Test transcription connection** or run:

```bash
mise exec -- node server.js --debug-transcription
```

This checks the API key's remaining allowance, ffmpeg, and a one-second silent audio request with the current team glossary and ZDR enabled. It does not send meeting recordings, but incurs a small API charge.

The transcription API accepts at most 200 glossary phrases in our tests. Meeting terms come first; only the first 200 are sent. Any omitted count is shown in diagnostics, terminal logs and meeting usage details. This does not delete terms or reduce the glossary used for correction.

The JSON report includes `ok`, `message` and per-check results in `checks`; exit status is 0 on success and 1 on failure. It does not verify long recordings or recognition quality.

Normal transcription errors also appear on the meeting page and in terminal logs, with HTTP status, model, audio size, phrase count and elapsed time, without credentials or audio content. A `429` indicates rate limiting, not exhausted credit; the response alone may not identify whether the limit applies to the key, account, IP or shared provider capacity.

Restart the source server after updating backend code; existing failure records are not rewritten. Older release binaries do not gain the diagnostics by updating the source files.

| Path | Contents |
|---|---|
| [docs/decisions.md](docs/decisions.md) | Decisions and reasons. Read before changing code |
| [docs/architecture.md](docs/architecture.md) | Pipeline, data fields, API |
| [docs/architecture.drawio](docs/architecture.drawio) | Editable 0.9.0 component and pipeline diagrams, including diagnostics and the 200-phrase transcription limit |
| [docs/plans/](docs/plans/) | Plans, named `YYYY-MM-DD-<topic>.md`; start with [next steps](docs/plans/2026-10-21-next-steps.md) |
| [docs/research/](docs/research/) | Evaluations; the accuracy of every tested setup is summarized in [benchmark standards](docs/research/2026-10-21-benchmark-standards.md) |
| `.claude/skills/meetings-dev` | Development, testing, build and release |
| `.claude/skills/stt-research` | Evaluating new transcription models |
