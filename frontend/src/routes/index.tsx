import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, Badge, reasonTone } from "@/components/AppShell";
import { REASON_LABEL, callerSaid, getConversations } from "@/lib/dashboard";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Handoff Queue — Sunrise Clinic Front Desk" },
      { name: "description", content: "Conversations the Sunrise Clinic front-desk agent escalated to staff." },
      { property: "og:title", content: "Handoff Queue — Sunrise Clinic Front Desk" },
      { property: "og:description", content: "Conversations the Sunrise Clinic front-desk agent escalated to staff." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HandoffQueue,
});

function HandoffQueue() {
  const all = getConversations();
  const escalated = all.filter((c) => c.terminal_state === "escalated");
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const open = escalated
    .filter((c) => !resolved.has(c.conversation_id))
    .sort((a, b) => b.time.localeCompare(a.time));
  const completed = all.filter((c) => c.terminal_state !== "escalated" && c.terminal_state !== "abandoned").length;
  const urgent = open.filter((c) => c.escalation_reason === "clinical_urgent").length;
  const pct = all.length ? Math.round((completed / all.length) * 100) : 0;

  const stats = [
    { label: "Conversations", value: all.length, sub: "today", tone: "text-subtle" },
    { label: "Completed by agent", value: completed, sub: `${pct}%`, tone: "text-subtle" },
    { label: "Escalated", value: escalated.length, sub: `${open.length} still open`, tone: "text-brand" },
    { label: "Urgent", value: urgent, sub: "clinical, unresolved", tone: "text-danger" },
  ];

  return (
    <AppShell>
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-[20px] font-bold leading-[28px]">Handoff Queue</h1>
          <p className="mt-[2px] text-[12px] text-subtle">Sunrise Clinic, Dehradun — conversations the agent escalated</p>
        </div>
        <Badge tone="brand">{open.length} open</Badge>
      </header>

      <section className="mt-[18px] grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-[6px] border border-line bg-card px-[15px] pb-[14px] pt-[16px]">
            <div className="text-[11px] uppercase tracking-[0.08em] text-subtle">{s.label}</div>
            <div className="mt-[6px] text-[22px] font-bold leading-[26px]">{s.value}</div>
            <div className={`text-[11px] ${s.tone}`}>{s.sub}</div>
          </div>
        ))}
      </section>

      <section className="mt-[14px] rounded-[6px] border border-line bg-card px-[15px] pb-[16px] pt-[12px]">
        <h2 className="text-[13px] font-bold">Open handoffs</h2>
        <div className="overflow-x-auto">
          <table className="mt-[8px] w-full min-w-[640px] text-left text-[11px]">
            <thead>
              <tr className="border-b border-line text-[10px] uppercase tracking-[0.08em] text-subtle">
                <th className="w-[20%] pb-[6px] font-normal">Conversation</th>
                <th className="w-[39%] pb-[6px] font-normal">Caller said</th>
                <th className="w-[31%] pb-[6px] font-normal">Reason</th>
                <th className="pb-[6px] font-normal">Time</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {open.map((c, i) => (
                <tr key={c.conversation_id} className="h-[35px] border-b border-line last:border-b-0">
                  <td className="font-mono">
                    <Link to="/conversations/$id" params={{ id: c.conversation_id }} className="hover:text-brand">
                      {c.conversation_id}
                    </Link>
                  </td>
                  <td className="font-bold">{callerSaid(c)}</td>
                  <td>
                    <Badge tone={reasonTone(c.escalation_reason)}>{REASON_LABEL[c.escalation_reason ?? ""] ?? c.escalation_reason}</Badge>
                  </td>
                  <td>{c.time}</td>
                  <td className="text-right">
                    <button
                      type="button"
                      onClick={() => setResolved((prev) => new Set(prev).add(c.conversation_id))}
                      className={
                        i === 0
                          ? "rounded-[3px] bg-brand px-[10px] py-[4px] text-[10px] font-bold text-primary-foreground"
                          : "rounded-[3px] border border-subtle/40 bg-card px-[10px] py-[4px] text-[10px] font-bold text-ink/70"
                      }
                    >
                      Resolve
                    </button>
                  </td>
                </tr>
              ))}
              {!open.length && (
                <tr>
                  <td colSpan={5} className="py-[18px] text-center text-subtle">
                    All handoffs resolved.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
