# Vexa Lite (v0.12)

The whole v0.12 control plane in **one container**. The simplest way to self-host — `make lite`
from the repo root provisions PostgreSQL + MinIO and runs everything else in a single image.

## Why

Everything except the datastores runs in one container — gateway, admin, meeting-api, runtime,
agent control plane, redis, and the X11/audio stack. No Docker socket, no per-service
containers. The runtime uses the **process backend**: meeting bots and agent workers run as
**child processes** inside the container, not socket-spawned containers.

- One app container instead of eight + on-demand workers
- Full API + terminal + meeting bots + agent
- No GPU required — transcription runs via an external API (or your own GPU service)

## Quick start

From the repo root:

```bash
make lite
```

Provisions a PostgreSQL + MinIO sidecar, pulls/builds the lite image, starts everything on the
host network, and probes the front doors. Set `TRANSCRIPTION_SERVICE_URL` /
`TRANSCRIPTION_SERVICE_TOKEN` in the repo-root `.env` for transcripts (get a token at
`vexa.ai/account`, or self-host the transcription service on a GPU).

### Transcripts with no token and no GPU — `LOCAL_STT=1`

```bash
make -C deploy/lite up LOCAL_STT=1
```

Runs a bundled **faster-whisper CPU server on the tiny model** (`vexa-lite-whisper`) on the same
network and **auto-wires `TRANSCRIPTION_SERVICE_URL`** to it — real transcripts out of the box,
slower than a GPU but zero setup. This is also how a **witness / human-eval box** always comes up
with transcription ready. Verify it end-to-end (synthesize speech → transcribe):

```bash
make -C deploy/lite stt-smoke        # ✓ local STT transcribes (model=whisper-1 → words)
```

Override the model or image for more accuracy: `WHISPER_MODEL=Systran/faster-whisper-small.en`, or
a GPU image via `WHISPER_IMAGE=...`. (The client sends `model=whisper-1`, the OpenAI id;
faster-whisper-server accepts it and serves `WHISPER_MODEL`.)

After it finishes:

- **Terminal:** `http://YOUR_IP:3001` (the agent-domain browser-CLI workbench)
- **API:** `http://YOUR_IP:8056` (the gateway — auth, routing) · docs at `/docs`
- **Agent API:** `http://YOUR_IP:8100`

To stop: `make lite-down` (data volumes are kept; `docker volume rm vexa-lite-pgdata
vexa-lite-miniodata` to wipe).

## What's inside

Supervised by `supervisord`:

| Service | Port | Role |
|---|---|---|
| gateway | **8056** | the one front door — auth, scopes, routing, `/ws` fan-out |
| admin-api | 8001 | users + API keys + `/internal/validate` |
| meeting-api | 8080 | bots, transcripts, recordings (→ MinIO) |
| runtime | 8090 | spawns bot + agent workers as **child processes** (process backend) |
| agent-api | **8100** | the agent control plane — dispatch, chat (SSE), routines |
| terminal | **3001** | agent-domain browser-CLI workbench (Next.js + custom `server.mjs` SSE/`/ws` relay) |
| redis | 6379 | bus + scheduler + per-dispatch streams (internal) |
| Xvfb · fluxbox · PulseAudio | :99 | display + audio for the headful bot browser |
| x11vnc · noVNC | 5900 / 6080 | browser view (debugging) |

External (the `make lite` sidecars): **PostgreSQL** (metadata) and **MinIO** (recordings +
agent workspaces).

### Architecture

```
+--------------------------------------------------------------+
|                    Vexa Lite container                       |
|                                                              |
|  gateway  admin-api  meeting-api  runtime                    |
|   :8056     :8001      :8080       :8090                      |
|                                                              |
|  agent-api   redis   Xvfb  fluxbox  PulseAudio  noVNC        |
|   :8100      :6379    :99                        :6080       |
|                                                              |
|  bot processes (Playwright)  +  agent workers (Claude Code)  |
|     ← runtime spawns as child processes (process backend)    |
+--------------------------------------------------------------+
        |                    |                    |
        v                    v                    v
   Transcription        PostgreSQL             MinIO
     (external)         (sidecar)             (sidecar)
```

In [compose mode](../compose/README.md) the runtime spawns each bot/agent in its **own
container** via the Docker socket; in lite they are child processes sharing one display/audio.

## Configuration

The repo-root `.env` (auto-seeded from `deploy/compose/.env` if present, else minimal):

| Variable | Default | Description |
|---|---|---|
| `TRANSCRIPTION_SERVICE_URL` / `_TOKEN` | — | STT endpoint + key, shared by the bot transcript pipeline and the terminal composer mic (dictation `/api/stt`). Unset → bots capture, no transcript; composer mic returns 503 "not configured" |
| `TRANSCRIPTION_MODEL` | — | STT model id sent on every request — required by backends that validate it (Groq `whisper-large-v3-turbo`, vLLM's served name). Unset → `whisper-1` |
| `ADMIN_TOKEN` | generated | admin API token (the stack's shared admin secret). Unset → `make up` generates one and writes it to `.env`; a bare `docker run` generates one inside the container (`docker exec vexa-lite cat /var/lib/vexa/generated-secrets.env`) |
| `IMAGE_TAG` | `latest` | the `vexaai/vexa-lite` tag to pull (a local `vexa-lite:dev` build wins) |

The front doors are published on `127.0.0.1` only. `make up BIND_ADDR=0.0.0.0` serves the LAN — do
that only with a strong `ADMIN_TOKEN`. `INTERNAL_API_SECRET`, `VEXA_DISPATCH_SIGNING_KEY` and
`NEXTAUTH_SECRET` have no published default either: unset, the container generates them on first
start and keeps them across restarts (a recreated container generates new ones — a re-login).

`make` variables (not `.env`) for the bundled local STT: `LOCAL_STT=1` (off by default),
`WHISPER_MODEL` (`Systran/faster-whisper-tiny.en`), `WHISPER_IMAGE`, `HOST_STT_PORT` (`8083`). When
`LOCAL_STT=1`, the bundled server overrides `TRANSCRIPTION_SERVICE_URL` for you.

Agent inference is BYO — point the runtime at your endpoint via `ANTHROPIC_*` / `VEXA_AGENT_MODEL`
in `.env`; the runtime brokers credentials into spawned workers (nothing leaves the network).

## Debugging

```bash
docker logs -f vexa-lite                          # container logs
docker exec vexa-lite supervisorctl status        # all supervised services
docker exec vexa-lite supervisorctl restart meeting-api
docker exec vexa-lite ps aux | grep dist/index.js # running bot processes
```

## Lite vs. Compose

| | Lite | Compose |
|---|---|---|
| Bot / agent isolation | POSIX (per-subject uid, 0700 tiers, per-share gids) | separate containers (per-mount binds) |
| Docker socket | not needed | required (runtime spawns over it) |
| Datastores | postgres + minio sidecars | in-stack |
| Setup | `make lite` | `make all` |

Outgrow lite? Switch to [compose](../compose/README.md) — same images, same contracts.

## Known limitations

| Issue | Note |
|---|---|
| Shared X11 display | bots share one Xvfb (`:99`) — best for one browser session at a time |
| Ephemeral redis | internal redis is in-container; mount `/var/lib/redis` for persistence |
| Agent ↔ gateway | the agent control plane is reached directly on `:8100` (gateway-fronting is roadmap) |

## Smoke probe — "is this install actually working?"

```bash
make probe SURFACE=lite          # from the repo root, against a running `make lite`
```

The full-journey smoke (spawn → schedule → boot → join → transcribe → live-view → stop + a
one-shot log sweep of the container and every bot workload log), driven through the published
gateway. Lite runs the real bot, so the dead-URL journey's truthful terminal is a NAMED
failure — never a fake green. See `deploy/lite/probe.sh`.

## Speaker-stream tuning against a rate-limited STT backend

The bot re-submits each speaker's growing buffer every `submitInterval` seconds (default 2)
until `confirmThreshold` consecutive results agree — deliberate redundancy that keeps the live
transcript flowing, but it multiplies request count well past the audio duration.

Against Groq's free tier (20 requests/min for Whisper) this saturates immediately. Measured on
a four-speaker, 17.7-minute meeting with defaults: 376 requests (21.2/min), 1720 rate-limit
responses, 268 segments lost for good — more audio dropped than transcribed, while the bot
reported healthy throughout.

If your STT backend caps requests rather than audio minutes, trade latency for request count:

```bash
BOT_SPEAKER_SUBMIT_INTERVAL_SEC=6   # default 2
BOT_SPEAKER_MIN_AUDIO_SEC=4         # default 2
```

Roughly a third of the requests, at the cost of the transcript arriving later. Fine for
recording, noticeable for anything acting on the transcript live. Leave the defaults if your
backend is billed per audio-minute rather than per request.
