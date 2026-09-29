/**
 * Front-desk dashboard data: every script in conversations/ and adversarial/
 * replayed through the real engine, three times each, to prove determinism.
 * Pure and deterministic, so it is identical on server and client.
 */
import { runConversation, type AgentResult } from "./agent/engine";

type Script = { id: string; today: string; turns: string[] };

const files = {
  ...import.meta.glob<Script>("../../../conversations/*.json", { eager: true, import: "default" }),
  ...import.meta.glob<Script>("../../../adversarial/*.json", { eager: true, import: "default" }),
};

export type DashboardConversation = AgentResult & {
  today: string;
  time: string;
  stable: boolean;
};

const fingerprint = (r: AgentResult) =>
  `${r.terminal_state}|${r.escalation_reason}|${r.tool_calls.map((c) => c.name).join(",")}`;

// Scripts carry no call time; show a stable, evenly spaced morning clock so the
// queue reads like a day of calls (earliest script = earliest call).
function callTime(index: number): string {
  const minutes = 9 * 60 + 5 + index * 17;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

let cache: DashboardConversation[] | null = null;

export function getConversations(): DashboardConversation[] {
  if (cache) return cache;
  const scripts = Object.values(files).sort((a, b) => a.id.localeCompare(b.id));
  cache = scripts.map((s, i) => {
    const runs = [0, 1, 2].map(() => runConversation(s.id, s.today, s.turns));
    const first = runs[0]!;
    return {
      ...first,
      today: s.today,
      time: callTime(i),
      stable: new Set(runs.map(fingerprint)).size === 1,
    };
  });
  return cache;
}

export function getConversation(id: string): DashboardConversation | undefined {
  return getConversations().find((c) => c.conversation_id === id);
}

/** First thing the caller said that explains the handoff. */
export function callerSaid(c: DashboardConversation): string {
  const turns = c.timeline.filter((t) => t.role === "caller").map((t) => ("text" in t ? t.text : ""));
  if (c.escalation_reason === "ambiguous_patient") {
    const lookup = c.timeline.find((t) => t.role === "tool" && t.name === "lookup_patient");
    const n = lookup && "summary" in lookup ? lookup.summary.match(/(\d+) candidates/)?.[1] : undefined;
    return n ? `"${shorten(turns[0] ?? "")}" — ${n} matches` : `"${shorten(turns[0] ?? "")}"`;
  }
  const pick =
    c.escalation_reason === "clinical_urgent"
      ? turns.find((t) => /dard|saans|behosh|khoon|chest|pain|bukhar/i.test(t))
      : c.escalation_reason === "medical_advice"
        ? turns.find((t) => /dawai|dava|medicine|tablet|lun|khau/i.test(t))
        : undefined;
  return `"${shorten(pick ?? turns[turns.length - 1] ?? "")}"`;
}

function shorten(text: string, max = 48): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export const REASON_LABEL: Record<string, string> = {
  clinical_urgent: "Clinical",
  medical_advice: "Medical advice",
  not_authorised: "Not authorised",
  ambiguous_patient: "Ambiguous patient",
  out_of_scope: "Out of scope",
};

export function prettyDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
