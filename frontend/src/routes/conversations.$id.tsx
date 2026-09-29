import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { AppShell, Badge, reasonTone } from "@/components/AppShell";
import { REASON_LABEL, getConversation, prettyDay } from "@/lib/dashboard";

export const Route = createFileRoute("/conversations/$id")({
  loader: ({ params }) => {
    if (!getConversation(params.id)) throw notFound();
    return { id: params.id };
  },
  head: ({ params }) => ({
    meta: [
      { title: `Conversation ${params.id} — Sunrise Clinic Front Desk` },
      { name: "description", content: `Transcript, tool calls and outcome for ${params.id}.` },
      { property: "og:title", content: `Conversation ${params.id} — Sunrise Clinic Front Desk` },
      { property: "og:description", content: `Transcript, tool calls and outcome for ${params.id}.` },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  notFoundComponent: () => (
    <AppShell>
      <p className="text-[13px]">
        Conversation not found. <Link to="/" className="text-brand">Back to queue</Link>
      </p>
    </AppShell>
  ),
  component: ConversationDetail,
});

function formatArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(", ");
}

function ConversationDetail() {
  const { id } = Route.useLoaderData();
  const c = getConversation(id)!;
  const status =
    c.terminal_state === "escalated"
      ? `Escalated — ${REASON_LABEL[c.escalation_reason ?? ""] ?? c.escalation_reason}`
      : c.terminal_state;
  const tone = c.terminal_state === "escalated" ? reasonTone(c.escalation_reason) : c.terminal_state === "abandoned" || c.terminal_state === "refused" ? "warn" : "ok";
  const hadBooking = c.tool_calls.some((t) => t.name === "search_slots");
  const committed = c.tool_calls.some((t) => ["book_appointment", "reschedule_appointment", "cancel_appointment"].includes(t.name));

  const rows: [string, string][] = [
    ["terminal_state", c.terminal_state],
    ["escalation_reason", c.escalation_reason ?? "null"],
    ["patient_id", c.patient_id ?? "null"],
    ["appointment_id", c.appointment_id ?? "null"],
    ["tool_calls", String(c.tool_calls.length)],
    ["turns", String(c.metrics.turns)],
    ["tokens", c.metrics.tokens.toLocaleString("en-US")],
    ["latency", `${c.metrics.latency_ms} ms`],
  ];

  return (
    <AppShell>
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-[20px] font-bold leading-[28px]">Conversation {c.conversation_id}</h1>
          <p className="mt-[2px] text-[12px] text-subtle">
            Sunrise Clinic, Dehradun — {prettyDay(c.today)}, {c.time}
          </p>
        </div>
        <Badge tone={tone}>{status}</Badge>
      </header>

      <div className="mt-[18px] grid gap-[14px] lg:grid-cols-[1fr_342px]">
        <section className="rounded-[6px] border border-line bg-card px-[15px] pb-[20px] pt-[12px]">
          <h2 className="text-[13px] font-bold">Transcript and tool calls</h2>
          <ol className="mt-[14px] space-y-[12px]">
            {c.timeline.map((t, i) => (
              <li key={i} className="grid grid-cols-[58px_1fr] items-start gap-[0px]">
                <span className="pt-[3px] text-right text-[10px] uppercase tracking-[0.08em] text-subtle pr-[14px]">{t.role}</span>
                {t.role === "tool" ? (
                  <div className="w-fit max-w-full rounded-[3px] border-l-2 border-brand bg-tool-soft px-[10px] py-[6px] font-mono text-[10.5px] leading-[16px] text-ink">
                    <span className="font-bold">{t.name}</span>({formatArgs(t.arguments)})
                    <div>→ {t.summary}</div>
                  </div>
                ) : (
                  <div
                    className={`w-fit max-w-[370px] rounded-[4px] px-[10px] py-[7px] text-[12px] leading-[18px] ${
                      t.role === "caller" ? "bg-caller-soft" : "border border-line bg-card"
                    }`}
                  >
                    {t.text}
                  </div>
                )}
              </li>
            ))}
            {c.terminal_state === "escalated" && hadBooking && !committed && (
              <li className="grid grid-cols-[58px_1fr]">
                <span />
                <div className="w-fit rounded-[4px] border border-danger/40 bg-danger-soft px-[10px] py-[6px] text-[11px] font-bold text-danger">
                  Booking flow abandoned. No appointment was created.
                </div>
              </li>
            )}
          </ol>
        </section>

        <aside className="self-start rounded-[6px] border border-line bg-card px-[15px] pb-[18px] pt-[12px]">
          <h2 className="text-[13px] font-bold">Outcome</h2>
          <dl className="mt-[10px]">
            {rows.map(([k, v]) => (
              <div key={k} className="flex h-[23px] items-center justify-between border-b border-line text-[11px]">
                <dt className="text-subtle">{k}</dt>
                <dd className="font-mono font-bold">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-[24px] border-t border-line pt-[14px]">
            <div className="text-[10px] uppercase tracking-[0.08em] text-subtle">Determinism</div>
            <div className="mt-[12px] flex items-center gap-[8px] text-[11px]">
              {c.stable ? "Same terminal state across 3 runs." : "Outcome changed between runs."}
              <Badge tone={c.stable ? "ok" : "danger"}>{c.stable ? "Stable" : "Unstable"}</Badge>
            </div>
          </div>
          <div className="mt-[16px] text-[11px]">
            <span className="text-subtle">Reply: </span>
            {c.reply}
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
