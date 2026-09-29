# DocpatQ Clinic Front Desk Agent

A deterministic, tool-grounded front-desk agent for Sunrise Clinic, with a React handoff queue and conversation detail UI.

## Quick Links:
- Website Link(Deployed on Vercel): [CLICK HERE](https://docpatq-jd.vercel.app/)
- Demo Video: [CLICK HERE](https://youtu.be/CfktOrJr0SI)

## Run Locally

Run these commands from the repository root, where the top-level `package.json` lives. Examples use Git Bash on Windows and require Node.js 20+, Python 3.9+, and npm. Install dependencies once:

```console
cd /c/Users/Administrator/Downloads/clinic-front-desk-jd

py -3.12 -m venv .venv

./.venv/Scripts/python.exe -m pip install -r backend/requirements.txt

npm install
```

Then start both services with one command:

```console
npm run dev
```

The Handoff Queue is served at `http://127.0.0.1:8080` (Vite chooses the next free port if needed). Select a conversation ID in the queue to open its detail screen. The API listens at `http://127.0.0.1:8000`.

### Demo Commands

### How `npm run dev` Starts Both Servers

The root `package.json` maps `dev` to `node scripts/dev.mjs`. That Node launcher starts two child processes from the repository root: Python runs `uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000`, and npm runs the Vite dev server inside `/frontend`. Ctrl+C in that terminal stops both child processes. This is local development orchestration; it is not the production deployment configuration.

To run only the API from Git Bash (use this instead of `npm run dev`, not alongside it):

```console
./.venv/Scripts/python.exe -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Run unit and fixture tests with `npm test`. Check the provided HTTP contract and determinism against the running API with:

```console
./.venv/Scripts/python.exe runner.py --url http://localhost:8000/agent/run --repeat 3 --out results/
```

The runner creates `results/` if needed and writes one response per script per run, for example `results/cv_0011.run1.json`. The runner validates the response contract and determinism; `npm test` additionally checks expected outcomes and tool-call restrictions for the standard and adversarial fixtures.

Create a production frontend build with `npm run build`.

## Deployment

The React frontend is deployed and available at [https://docpatq-jd.vercel.app/](https://docpatq-jd.vercel.app/). The deployed site renders the supplied conversation fixtures and routes conversation IDs to their detail pages.

The FastAPI backend has not been deployed. For the API demo, run it locally at `http://127.0.0.1:8000/agent/run`. The deployed frontend is not currently connected to a hosted backend; its screens are fixture-driven. To make hosted UI actions call the API, deploy the backend and configure the frontend with its public API URL and appropriate CORS policy.

Vercel supports TanStack Start through Nitro and FastAPI through its Python Functions runtime. The existing frontend Vite build uses a Cloudflare-targeted Nitro configuration, so verify or switch the Nitro provider as part of a Vercel build before relying on future production deployments. References: [TanStack Start on Vercel](https://vercel.com/docs/frameworks/full-stack/tanstack-start), [FastAPI on Vercel](https://vercel.com/kb/guide/ship-a-fastapi-app-on-vercel), and [Vercel Services](https://vercel.com/docs/services).

## API Contract

The only evaluation endpoint is `POST /agent/run`, with JSON body:

```json
{"conversation_id":"cv_0001","today":"2026-10-01","turns":["caller turn one","caller turn two"]}
```

The response follows [schema.md](schema.md): echoed conversation ID, ordered tool calls, terminal state and escalation reason, resolved patient and appointment IDs, final reply, and best-effort metrics. FastAPI validates malformed request fields with actionable `422` details. Interactive API docs are disabled so `/agent/run` remains the sole application endpoint.

The six synchronous tools in [backend/clinic.py](backend/clinic.py) are the source of truth for availability, mutations, lookup, and handoff. Each request reloads the original root `clinic.json`; all mutations live only in that run's isolated copy. Booking and rescheduling validate the selected slot and mutate atomically within the request.

## Model And Architecture

Kimi, Lovable, and GitHub Copilot coding agents were used as implementation assistants during the work; details are recorded in [AI_TRANSCRIPT.md](AI_TRANSCRIPT.md). No model API is called by the running agent: the conversation layer is a deterministic Python policy over the six clinic tools. This deliberately avoids nondeterministic model output in safety and scheduling decisions. The React/TanStack frontend under `/frontend` replays the supplied scripts to provide the handoff queue and evidence timeline; the FastAPI service under `/backend` is the graded runtime API.

The tool layer uses request-local in-memory state loaded from `clinic.json`, not SQLite or an external database. This is intentional for the assignment: every request starts from the original fixture, and mutations do not carry over into another conversation.

Dates, including Hindi relative dates and weekday names, are resolved only from each request's `today`. The safety scan runs across every caller turn before identity lookup or calendar tools. Acute symptoms preempt all booking work and call only `escalate_to_human` with `clinical_urgent`.

## Baseline Efficiency

The following are response metrics from one local run of each supplied standard script. `tokens` is a deterministic estimate, not provider-token billing: approximately one token per four caller characters plus 45 per tool call. `latency_ms` is policy execution time measured inside the API with a monotonic timer; it excludes client/network overhead. Because inference is not used, provider latency and provider tokens are not applicable.

| Conversation | Outcome | Estimated tokens | API latency (ms) |
|---|---|---:|---:|
| cv_0001 | booked | 164 | 6 |
| cv_0002 | booked | 175 | 4 |
| cv_0003 | rescheduled | 167 | 4 |
| cv_0004 | cancelled | 107 | 4 |
| cv_0005 | abandoned | 72 | 7 |
| cv_0006 | booked | 218 | 5 |
| cv_0007 | escalated | 165 | 5 |
| cv_0008 | booked | 208 | 4 |
| cv_0009 | escalated | 172 | 4 |
| cv_0010 | escalated | 79 | 2 |
| cv_0011 | escalated | 78 | 1 |
| cv_0012 | booked | 153 | 4 |
| cv_0013 | abandoned | 16 | 5 |
| cv_0014 | refused | 46 | 2 |
| cv_0015 | booked | 159 | 7 |

All 15 standard scripts passed the supplied HTTP runner three times with stable terminal-state, reason, and tool-name fingerprints. The eight adversarial scripts and tool-layer error cases pass through `npm test`.

## Repository Layout

- `/backend`: FastAPI endpoint, deterministic conversation policy, clinic tools, and tests.
- `/frontend`: React/TanStack UI, separate from root fixture files to avoid route/static collisions.
- `/adversarial`: eight custom cases in the assignment schema.
- `/conversations`: the 15 supplied standard scripts.
- `/clinic.json`, `/schema.md`, `/runner.py`: supplied data and evaluation contract.

## Screenshots:

1. Handoff UI Screen:
> <img width="950" height="420" alt="handoff-screen" src="https://github.com/user-attachments/assets/dbad700d-e9eb-4831-90a3-de67694e1821" />

2. Conversation Screen
> <img width="959" height="409" alt="conversation-screen" src="https://github.com/user-attachments/assets/39dfa701-0585-4d64-8246-059047120b87" />

3. Successfull booking API response(tool calling)
> <img width="594" height="401" alt="successful-booking" src="https://github.com/user-attachments/assets/dcca366a-0c0e-4494-8a14-b57d50b3768c" />

4. Escalate to Human API response
> <img width="624" height="356" alt="escalate-to-human" src="https://github.com/user-attachments/assets/9ee37f6a-aa64-4695-ba60-570efbde59a8" />

5. Agents tests tool calling results
> <img width="584" height="327" alt="agents-tests-tools-terminal" src="https://github.com/user-attachments/assets/1c48db8b-96e7-4022-a3be-c04f74c9d9e4" />

6. npm test (API contract test checks)
> <img width="604" height="289" alt="npm-test-contrct" src="https://github.com/user-attachments/assets/298bca60-c0dc-4290-9d4d-050f710096af" />





