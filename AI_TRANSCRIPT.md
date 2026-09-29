# AI Transcript

This is a prompt transcript from the actual coding session, edited for readability rather than copied word-for-word. The requests below preserve the work I asked the coding agent to do. Assistant notes summarize the corresponding implementation and checks; they are not presented as verbatim model responses.

## Prompt 1: Implement The Assignment

**My prompt**

> I am building the DocpatQ Clinic Front Desk Agent take-home assignment from the supplied September 2026 brief and `schema.md`. Please reorganize this repository into a Python FastAPI backend, a React/Vite frontend, eight adversarial cases, and the 15 supplied conversations. Implement the six required clinic tools against `clinic.json`, preserve deterministic behavior and request-local state, resolve dates from the request's `today`, and make emergency symptoms preempt any booking flow. Please also produce the README, architectural decisions, and an AI transcript. The assignment pack and screen references are in `instructions-agent/`.

**Coding agent summary**

I inspected the PDF, schema, fixtures, and existing TanStack source. I moved the existing UI beneath `/frontend`, implemented the Python tools and conversation policy beneath `/backend`, and added fixture-based tests. The safety policy checks the full transcript before scheduling and resolves dates from request input. The UI fixture imports now point to the root conversation data without making those files Vite's public root.

## Prompt 2: Make The Conversation Screen Reachable

**My prompt**

> I still do not see the conversation screen or a clear navigation path to it. Please fix the route collision, connect the conversation links to the detail screen, remove obsolete root files that were moved into `frontend/` or `backend/`, and leave `instructions-agent/` intact. Update the root README with the actual startup commands.

**Coding agent summary**

I verified the dynamic conversation route and the route collision fix, updated the root run instructions, and removed the stale roadmap while preserving the assignment fixtures. I also verified that opening a conversation ID in the queue renders the detail page.

## Prompt 3: Explain API Testing And Demo Flow

**My prompt**

> The UI shows staff handoffs, but I do not see a Send button. How should I test the API and what should I demonstrate? Please verify a real request against the running FastAPI endpoint so I can show its JSON response with the matching conversation detail page.

**Coding agent summary**

The two required screens are a staff queue and conversation detail view, not a caller-facing chat application. I started the local services and posted the `cv_0011` emergency script to `POST /agent/run`. It returned `escalated` with `clinical_urgent`, called only `escalate_to_human`, and created no appointment.

## Prompt 4: Prepare My Demo And Refine The Submission

**My prompt**

> I am a backend developer with a little over one year of experience. Please make me a practical demo script with the commands I will need: install/setup, start both services, post the urgent example, run the supplied repeatability check, run tests/build, open the relevant UI page, and stop the local services. Explain how `npm run dev` starts both the React and Python servers.
>
> Please rewrite `AI_TRANSCRIPT.md` as a professional record of my actual prompts to the coding agent. Keep it in my voice and show that I directed the work as a backend developer; do not invent a conversation between two developers.
>
> I may deploy this to Vercel. Check whether the current repository is ready and explain any deployment changes still needed. Finally, restore the reference sidebar's circular dot styling and remove the two added icons. The conversation table's clickable IDs already provide access to the detail screen, so keep that navigation and remove the icon shortcuts.

**Coding agent summary**

I added `scripts/demo.ps1` with setup, start, emergency POST, repeatability, test, build, browser-open, and stop actions. The local combined launcher runs a Node script that spawns Uvicorn and Vite as child processes. The sidebar was returned to its round indicator styling, leaving the conversation ID links as the route into detail.

## Implementation And Validation Notes

- Backend: six deterministic tools operate on a freshly loaded `clinic.json` copy for each request.
- Emergency behavior: `cv_0011` terminates with `clinical_urgent` before any search or booking tool call.
- Standard validation: the supplied 15 conversations passed the HTTP runner three times with stable state/reason/tool fingerprints.
- Adversarial validation: all eight custom cases passed expected-state, escalation-reason, and tool-call checks.
- Frontend validation: production build passed, and `/conversations/cv_0011` rendered as a routed detail page.
- Deployment status: no Vercel deployment was performed. Official Vercel documentation supports both TanStack Start with Nitro and FastAPI on Python Functions, but this repository needs a Vercel-specific configuration for its current Cloudflare-targeted frontend build and the combined monorepo routing before it can be called deployment-ready.
