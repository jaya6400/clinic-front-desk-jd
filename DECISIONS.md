# Decisions

## Runtime And State

- The Python API is the graded implementation. The retained React/TanStack project is confined to `/frontend`; root scripts and data fixtures are outside Vite's public root so `/conversations/:id` resolves to the router instead of a JSON asset.
- Every `POST /agent/run` constructs a new `Clinic` from the shipped `clinic.json`. Bookings, cancellations, and reschedules therefore never leak between scripted conversations. Mutations are guarded by a per-run re-entrant lock and revalidate free slots immediately before committing.
- The brief asks for both reset-on-every-request and protection against two conversations racing for a slot. Those requirements conflict if interpreted as persistent shared state: an isolated reset means a booking in one request cannot reserve a slot in another. I chose the explicit evaluation contract's reset rule; atomic locking prevents concurrent commits against the same in-memory run, while separate requests intentionally remain independent simulations.
- The conversation policy is deterministic and calls no LLM. Kimi Agent was used as a coding assistant under the time constraint, not as an inference service. This makes retries and the runner's repeated requests reproducible and prevents free-form model output from creating a tool call.

## Safety And Identity

- The complete transcript is safety-scanned before identity resolution or any availability lookup. Acute symptoms, including chest pain, breathing difficulty, and severe bleeding, terminate the request with only `escalate_to_human(reason="clinical_urgent")`; no booking/search continues. Medication or diagnosis questions escalate as `medical_advice`.
- Prompt injection and bulk actions are refused, not escalated: the synthetic request does not represent a legitimate human task. The tool set deliberately has no bulk-record operation.
- Patient matching returns every best candidate. It never chooses among tied names. A name plus registered phone narrows candidates only when the tool result actually identifies one record; otherwise the caller is handed to staff as `ambiguous_patient`.
- A distinct caller and appointment subject are looked up separately. Acting for another person requires a listed `guardian_of` relationship. A claimed colleague, neighbour, friend, or other non-guardian relationship remains unauthorized even if the target name is known.
- A missing patient detail is abandoned rather than escalated when there is no evidence of a human-only risk. A clear request outside scheduling is escalated as `out_of_scope`.

## Date, Time, And Slot Edge Cases

- Relative dates and weekdays are anchored to the request's `today`, never the machine clock. When a weekday is mentioned without an explicit date, the next occurrence is chosen (a same-day weekday means seven days later); explicit day-of-month phrases choose the current month when not earlier than `today`, otherwise the next month.
- If one utterance corrects itself and names multiple dates or times, the final mentioned value wins. This reflects conversational repair in the supplied scripts; it is a deterministic rule, not a general natural-language guarantee.
- The schedule uses fixed 15-minute slots. Overlapping doctor windows are deduplicated by start time; an occupied interval blocks any overlapping slot.
- A requested unavailable time is never silently booked. If the caller explicitly allows any available time, the first chronologically free slot is selected; otherwise the conversation pauses without a mutation.
- A cancellation with a requested date only affects an appointment on that exact date. It never falls back to the patient's nearest appointment. If the patient has multiple matching active appointments, the agent asks for clarification and makes no change.
- Rescheduling requires an existing appointment and a distinct destination date. A free destination slot is searched before mutation; the original appointment remains unchanged if the requested time is unavailable.

## Supplied-Material Ambiguities

- `schema.md` correctly says every tool call, including a failed call, belongs in `tool_calls`; the API logs calls before invoking tools and records tool errors with stable codes internally. Tool details are not added to the public response because the contract has no field for them.
- The sample response's `tokens` and `latency_ms` look like model-provider metrics, but the brief allows any LLM and does not prescribe a tokenizer or timing boundary. Since this implementation uses no inference provider, the API reports a documented deterministic token estimate and monotonic in-process latency. These are best-effort efficiency indicators, not billed token counts or end-to-end network time.
- The UI screenshot shows a production-style 37-conversation queue, while the supplied fixture pack contains 15 standard plus eight adversarial cases. The dashboard uses fixture-derived conversations and counters instead of inventing additional patients or calls; layout and information hierarchy follow the reference screens.
- The PDF asks for a hosted live link and a three-minute self-critique video, but neither deployment credentials nor an external video destination are part of this workspace. They remain submission steps outside this local implementation.
