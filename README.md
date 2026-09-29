# DocpatQ Clinic Front Desk Agent

A deterministic, tool-grounded front-desk agent for Sunrise Clinic, with a React handoff queue and conversation detail UI.

## Run Locally

Run these commands from the repository root, where the top-level `package.json` lives. Requires Node.js 20+, Python 3.9+, and npm. Install dependencies once:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r backend\requirements.txt
npm install
```

Then start both services with one command:

```powershell
npm run dev
```

The Handoff Queue is served at `http://127.0.0.1:8080` (Vite chooses the next free port if needed). Select a conversation ID in the queue to open its detail screen. The API listens at `http://127.0.0.1:8000`.

### Demo Commands

The PowerShell helper covers the common demo flow. From the repository root:

```powershell
.\scripts\demo.ps1 -Action Help
.\scripts\demo.ps1 -Action Setup
.\scripts\demo.ps1 -Action Demo
```

`Demo` starts both services in a separate command window, posts the urgent `cv_0011` request and prints its JSON response, runs that case three times through the supplied runner, then opens the matching conversation detail page. The services stay open after the script ends so you can continue navigating the UI.

Individual actions are available when presenting step by step:

```powershell
.\scripts\demo.ps1 -Action Start
.\scripts\demo.ps1 -Action Emergency
.\scripts\demo.ps1 -Action Repeat
.\scripts\demo.ps1 -Action Tests
.\scripts\demo.ps1 -Action Build
.\scripts\demo.ps1 -Action Open
.\scripts\demo.ps1 -Action Stop
```

### How `npm run dev` Starts Both Servers

The root `package.json` maps `dev` to `node scripts/dev.mjs`. That Node launcher starts two child processes from the repository root: Python runs `uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000`, and npm runs the Vite dev server inside `/frontend`. Ctrl+C in that terminal stops both child processes. This is local development orchestration; it is not the production deployment configuration.

To run only the API on Windows:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Run unit and fixture tests with `npm test`. Check the provided HTTP contract and determinism against the running API with:

```powershell
.\.venv\Scripts\python.exe runner.py --url http://localhost:8000/agent/run --repeat 3
```

Create a production frontend build with `npm run build`.

## Vercel Deployment Status

Vercel supports TanStack Start through Nitro and FastAPI through its Python Functions runtime, so this stack can be deployed there. This repository is **not Vercel-ready yet**: the existing frontend config currently emits a Cloudflare-targeted Nitro build, and the local `npm run dev` launcher starts two long-running processes, which Vercel does not use as a production command. The monorepo also needs deployment routing/build configuration and a verified way to include root fixture JSON with both service bundles.

Before deployment, configure the TanStack Start Nitro Vercel provider, choose either Vercel Services for one monorepo deployment (currently documented as a beta feature) or separate frontend/backend Vercel projects, and verify that `/agent/run` plus `/conversations/cv_0011` both work on the deployed URLs. No live Vercel deployment has been made from this workspace. References: [TanStack Start on Vercel](https://vercel.com/docs/frameworks/full-stack/tanstack-start), [FastAPI on Vercel](https://vercel.com/kb/guide/ship-a-fastapi-app-on-vercel), and [Vercel Services](https://vercel.com/docs/services).

## API Contract

The only evaluation endpoint is `POST /agent/run`, with JSON body:

```json
{"conversation_id":"cv_0001","today":"2026-10-01","turns":["caller turn one","caller turn two"]}
```

The response follows [schema.md](schema.md): echoed conversation ID, ordered tool calls, terminal state and escalation reason, resolved patient and appointment IDs, final reply, and best-effort metrics. FastAPI validates malformed request fields with actionable `422` details. Interactive API docs are disabled so `/agent/run` remains the sole application endpoint.

The six synchronous tools in [backend/clinic.py](backend/clinic.py) are the source of truth for availability, mutations, lookup, and handoff. Each request reloads the original root `clinic.json`; all mutations live only in that run's isolated copy. Booking and rescheduling validate the selected slot and mutate atomically within the request.

## Model And Architecture

Kimi Agent was utilized as an implementation assistant because of the tight deadline constraints. No model API is called by the running agent: the conversation layer is a deterministic Python policy over the six clinic tools. This deliberately avoids nondeterministic model output in safety and scheduling decisions. The React/TanStack frontend under `/frontend` replays the supplied scripts to provide the handoff queue and evidence timeline; the FastAPI service under `/backend` is the graded runtime API.

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
