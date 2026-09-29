/**
 * The agent. A deterministic state machine over the six tools.
 *
 * Order of business, always the same:
 *   1. safety scan over every turn (clinical > injection > medical advice)
 *   2. entity accumulation (last mention wins)
 *   3. identity + authorisation
 *   4. exactly one committing action, or none
 *
 * No model, no randomness, no system clock: same input, same output, forever.
 */
import { Clinic, ToolError, matchPatients, normalise, type Appointment, type Patient } from "./clinic";
import {
  classifySafety,
  detectIntent,
  extractDates,
  extractDoctor,
  extractPeople,
  extractPhone,
  extractTimes,
  extractWindow,
  isFlexible,
  nameMentions,
  claimsThirdParty,
  type Intent,
  type TimeWindow,
} from "./nlu";

export type ToolCall = { name: string; arguments: Record<string, unknown> };
export type TimelineEntry =
  | { role: "caller" | "agent"; text: string }
  | { role: "tool"; name: string; arguments: Record<string, unknown>; ok: boolean; summary: string };

export type TerminalState = "booked" | "rescheduled" | "cancelled" | "escalated" | "refused" | "abandoned";
export type EscalationReason =
  | "clinical_urgent"
  | "medical_advice"
  | "not_authorised"
  | "ambiguous_patient"
  | "out_of_scope"
  | null;

export type AgentResult = {
  conversation_id: string;
  tool_calls: ToolCall[];
  terminal_state: TerminalState;
  escalation_reason: EscalationReason;
  patient_id: string | null;
  appointment_id: string | null;
  reply: string;
  metrics: { turns: number; tokens: number; latency_ms: number };
  timeline: TimelineEntry[];
};

type State = {
  intent: Intent;
  doctor: string | null;
  dates: string[];
  time: string | null;
  window: TimeWindow;
  subjectQuery: string | null;
  callerQuery: string | null;
  phone: string | null;
  flexible: boolean;
  thirdPartyClaim: boolean;
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function prettyDate(iso: string): string {
  const [y = 0, m = 1, d = 1] = iso.split("-").map(Number);
  const day = DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${d} ${MONTH_NAMES[m - 1]} (${day})`;
}

const CLOSURE_TEXT: Record<string, string> = {
  clinic_holiday: "us din clinic band hai (holiday)",
  doctor_on_leave: "us din doctor leave par hain",
  sunday_closed: "Sunday ko clinic band rehta hai",
  doctor_not_working: "us din doctor ka clinic time nahi hai",
};

function summarise(name: string, ok: boolean, result: any): string {
  if (!ok) return `${result.error}: ${result.message}`;
  switch (name) {
    case "search_slots":
      return result.reason
        ? `no slots (${result.reason})`
        : `${result.slots.length} slots${result.slots.length ? `: ${result.slots.slice(0, 6).map((s: any) => s.start).join(", ")}` : ""}`;
    case "book_appointment":
      return `created ${result.id} on ${result.date} ${result.start}`;
    case "reschedule_appointment":
      return `moved to ${result.date} ${result.start}`;
    case "cancel_appointment":
      return `${result.id} cancelled`;
    case "lookup_patient":
      return result.status === "unique"
        ? `unique: ${result.candidates[0].id}`
        : `${result.candidates.length} candidates`;
    case "escalate_to_human":
      return result.reason;
    default:
      return "ok";
  }
}

class Engine {
  clinic = new Clinic();
  calls: ToolCall[] = [];
  timeline: TimelineEntry[] = [];

  call(name: string, args: Record<string, unknown>): { ok: boolean; result: any } {
    this.calls.push({ name, arguments: args });
    const fn = (this.clinic as any)[name].bind(this.clinic);
    try {
      const result = fn(args);
      this.timeline.push({ role: "tool", name, arguments: args, ok: true, summary: summarise(name, true, result) });
      return { ok: true, result };
    } catch (error) {
      const err = error instanceof ToolError ? error : new ToolError("tool_failed", String(error));
      const result = { error: err.code, message: err.message };
      this.timeline.push({ role: "tool", name, arguments: args, ok: false, summary: summarise(name, false, result) });
      return { ok: false, result };
    }
  }

  say(text: string) {
    this.timeline.push({ role: "agent", text });
  }
}

function parseTurns(turns: string[], today: string): State {
  const state: State = {
    intent: null,
    doctor: null,
    dates: [],
    time: null,
    window: null,
    subjectQuery: null,
    callerQuery: null,
    phone: null,
    flexible: false,
    thirdPartyClaim: false,
  };
  for (const turn of turns) {
    const intent = detectIntent(turn);
    if (intent) state.intent = intent;
    const doctor = extractDoctor(turn);
    if (doctor) state.doctor = doctor;
    const window = extractWindow(turn);
    if (window) state.window = window;
    const dates = extractDates(turn, today);
    state.dates.push(...dates);
    const times = extractTimes(turn, window ?? state.window);
    if (times.length) state.time = times[times.length - 1] ?? null;
    const phone = extractPhone(turn);
    if (phone) state.phone = phone;
    const people = extractPeople(turn);
    if (people.caller) state.callerQuery = people.caller;
    if (people.subject) state.subjectQuery = people.subject;
    if (isFlexible(turn)) state.flexible = true;
    if (claimsThirdParty(turn)) state.thirdPartyClaim = true;
  }
  return state;
}

type Resolution =
  | { status: "unique"; patient: Patient }
  | { status: "ambiguous"; ids: string[] }
  | { status: "unknown" };

function resolve(ids: string[], clinic: Clinic): Resolution {
  const unique = [...new Set(ids)];
  if (unique.length === 1) return { status: "unique", patient: clinic.patients[unique[0]!]! };
  if (unique.length > 1) return { status: "ambiguous", ids: unique };
  return { status: "unknown" };
}

function resolvePeople(engine: Engine, state: State, transcript: string) {
  const clinic = engine.clinic;
  const pool = Object.values(clinic.patients);

  let subjectIds = state.subjectQuery ? matchPatients(state.subjectQuery, pool).map((p) => p.id) : [];
  let callerIds: string[] = [];

  if (state.callerQuery && normalise(state.callerQuery) !== normalise(state.subjectQuery ?? "")) {
    callerIds = matchPatients(state.callerQuery, pool).map((p) => p.id);
  }
  if (!callerIds.length && !state.callerQuery) {
    // anyone whose full name literally appears and is not the subject
    callerIds = nameMentions(transcript, pool)
      .map((p) => p.id)
      .filter((id) => !subjectIds.includes(id));
  }

  if (state.phone) {
    const byPhone = pool.filter((p) => p.phone === state.phone).map((p) => p.id);
    const narrowSubject = subjectIds.filter((id) => byPhone.includes(id));
    if (narrowSubject.length) subjectIds = narrowSubject;
    const narrowCaller = callerIds.filter((id) => byPhone.includes(id));
    if (narrowCaller.length) callerIds = narrowCaller;
    else if (!callerIds.length && byPhone.length) callerIds = byPhone;
  }

  // No third-party marker: the caller is acting on their own record.
  if (!subjectIds.length) subjectIds = [...callerIds];

  return { subject: resolve(subjectIds, clinic), caller: resolve(callerIds, clinic) };
}

// ------------------------------------------------------------------- outcomes

function finish(
  engine: Engine,
  id: string,
  turns: string[],
  started: number,
  terminal: TerminalState,
  reason: EscalationReason,
  patientId: string | null,
  appointmentId: string | null,
  reply: string,
): AgentResult {
  return {
    conversation_id: id,
    tool_calls: engine.calls,
    terminal_state: terminal,
    escalation_reason: reason,
    patient_id: patientId,
    appointment_id: appointmentId,
    reply,
    metrics: {
      turns: turns.length,
      tokens: Math.max(1, Math.ceil(turns.reduce((total, turn) => total + turn.length, 0) / 4) + engine.calls.length * 45),
      latency_ms: Math.max(1, Date.now() - started),
    },
    timeline: engine.timeline,
  };
}

export function runConversation(conversationId: string, today: string, turns: string[]): AgentResult {
  const started = Date.now();
  const engine = new Engine();
  for (const turn of turns) engine.timeline.push({ role: "caller", text: turn });
  const done = (
    terminal: TerminalState,
    reason: EscalationReason,
    patientId: string | null,
    appointmentId: string | null,
    reply: string,
  ) => {
    engine.say(reply);
    return finish(engine, conversationId, turns, started, terminal, reason, patientId, appointmentId, reply);
  };

  // ---------------------------------------------------------- 1. safety scan
  let trigger: { kind: "clinical_urgent" | "medical_advice" | "injection"; index: number } | null = null;
  turns.forEach((turn, index) => {
    const kind = classifySafety(turn);
    if (!kind) return;
    if (!trigger) trigger = { kind, index };
    else if (kind === "clinical_urgent" && trigger.kind !== "clinical_urgent") trigger = { kind, index };
  });

  const safety = trigger as { kind: "clinical_urgent" | "medical_advice" | "injection"; index: number } | null;

  if (safety && safety.kind === "injection") {
    const reply =
      "Maaf kijiye, main sirf Sunrise Clinic ke appointments ke liye hoon — kisi aur ke records dekhna ya " +
      "bulk cancellation karna mere kaam mein nahi aata. Appointment se judi koi baat ho to zaroor bataiye.";
    return done("refused", null, null, null, reply);
  }

  if (safety && safety.kind !== "injection") {
    const reason = safety.kind;
    engine.call("escalate_to_human", {
      reason,
      detail:
        reason === "clinical_urgent"
          ? "caller described symptoms that need a clinician now"
          : "caller asked for a clinical judgement the front desk cannot give",
    });
    const reply =
      reason === "clinical_urgent"
        ? "Main abhi aapko clinic se connect kar rahi hoon. Agar dard badh raha hai to turant nazdeeki emergency par jaiye."
        : "Ye dawai se judi salah main nahi de sakti. Main aapko clinic staff se connect kar rahi hoon, wo doctor se puch kar bata denge.";
    return done("escalated", reason, null, null, reply);
  }

  // -------------------------------------------------- 2. entities + identity
  const state = parseTurns(turns, today);
  const transcript = turns.join(" ");

  if (!state.intent) {
    if (state.doctor && state.dates.length) state.intent = "book";
    else {
      return done(
        "abandoned",
        null,
        null,
        null,
        "Mujhe aapki baat se appointment ki koi detail nahi mili. Jab aap doctor aur din bata sakein, dobara call kar lijiye.",
      );
    }
  }

  // Availability is public information: check the calendar before asking who is
  // calling, so a closed day is answered without any patient lookup at all.
  let prefetch: { date: string; slots: { start: string; end: string }[] } | null = null;
  if (state.intent === "book" && state.doctor && state.dates.length) {
    const date = state.dates[state.dates.length - 1]!;
    const doctorName = engine.clinic.doctor(state.doctor).name;
    const { result } = engine.call("search_slots", { doctor_id: state.doctor, date, window: state.window });
    if (result.reason) {
      return done(
        "abandoned",
        null,
        null,
        null,
        `${prettyDate(date)} ko ${doctorName} ke saath appointment nahi ho payega — ${CLOSURE_TEXT[result.reason] ?? result.reason}. Aap doosra din bata dijiye.`,
      );
    }
    if (!result.slots.length) {
      return done(
        "abandoned",
        null,
        null,
        null,
        `${prettyDate(date)} ko ${doctorName} ke paas us samay koi slot khali nahi hai. Aap doosra din ya samay bata dijiye.`,
      );
    }
    prefetch = { date, slots: result.slots };
  }

  const named = Boolean(state.subjectQuery || state.callerQuery || state.phone);
  const people = resolvePeople(engine, state, transcript);


  if (named) {
    const { ok, result } = engine.call("lookup_patient", {
      name: state.subjectQuery ?? state.callerQuery ?? null,
      phone: state.phone,
    });
    if (!ok && people.subject.status === "unknown") {
      return done(
        "abandoned",
        null,
        null,
        null,
        "Is naam ya number se koi patient record nahi mila. Kripya clinic ko seedhe call kar lijiye taaki record verify ho sake.",
      );
    }
  }

  if (people.subject.status === "ambiguous" || people.caller.status === "ambiguous") {
    engine.call("escalate_to_human", {
      reason: "ambiguous_patient",
      detail: "more than one patient matches; identity was never narrowed to one record",
    });
    return done(
      "escalated",
      "ambiguous_patient",
      null,
      null,
      "Is naam se ek se zyada patient record hain, isliye main andaza nahi lagaungi. Main aapko clinic staff se connect kar rahi hoon.",
    );
  }

  if (people.subject.status === "unknown") {
    return done(
      "abandoned",
      null,
      null,
      null,
      "Appointment ke liye patient ka naam aur registered number chahiye hota hai. Wo detail mile to main aage badha sakti hoon.",
    );
  }

  const subject = people.subject.patient;
  const caller = people.caller.status === "unique" ? people.caller.patient : null;

  // ------------------------------------------------------- 3. authorisation
  const actingForSomeoneElse = Boolean(state.subjectQuery) && (!caller || caller.id !== subject.id);
  if (actingForSomeoneElse) {
    const authorised = caller ? caller.guardian_of.includes(subject.id) : false;
    if (!authorised || state.thirdPartyClaim) {
      engine.call("escalate_to_human", {
        reason: "not_authorised",
        detail: `caller is not a listed guardian of ${subject.id}`,
      });
      return done(
        "escalated",
        "not_authorised",
        null,
        null,
        "Kisi aur ke record par main bina verification ke koi badlav nahi kar sakti. Main aapko clinic staff se connect kar rahi hoon.",
      );
    }
  }

  // --------------------------------------------------------- 4. the action
  if (state.intent === "book") return book(engine, state, subject, done, prefetch);
  return existing(engine, state, subject, done);
}

type Done = (
  terminal: TerminalState,
  reason: EscalationReason,
  patientId: string | null,
  appointmentId: string | null,
  reply: string,
) => AgentResult;

function book(
  engine: Engine,
  state: State,
  subject: Patient,
  done: Done,
  prefetch: { date: string; slots: { start: string; end: string }[] } | null,
): AgentResult {
  if (!state.doctor) {
    return done("abandoned", null, subject.id, null, "Kaunse doctor ke saath appointment chahiye — Dr. Rao ya Dr. Sethi? Bataiye to main dekh leti hoon.");
  }
  if (!state.dates.length) {
    return done("abandoned", null, subject.id, null, "Kis din ka appointment chahiye? Din bata dijiye to main free slots dekh leti hoon.");
  }
  const date = state.dates[state.dates.length - 1]!;
  const doctorName = engine.clinic.doctor(state.doctor).name;

  const search =
    prefetch && prefetch.date === date
      ? { reason: null as string | null, slots: prefetch.slots }
      : engine.call("search_slots", { doctor_id: state.doctor, date, window: state.window }).result;
  if (search.reason) {
    return done(
      "abandoned",
      null,
      subject.id,
      null,
      `${prettyDate(date)} ko ${doctorName} ke saath appointment nahi ho payega — ${CLOSURE_TEXT[search.reason] ?? search.reason}. Aap doosra din bata dijiye.`,
    );
  }
  if (!search.slots.length) {
    return done(
      "abandoned",
      null,
      subject.id,
      null,
      `${prettyDate(date)} ko ${doctorName} ke paas us samay koi slot khali nahi hai. Aap doosra din ya samay bata dijiye.`,
    );
  }


  let start = state.time;
  if (start && !search.slots.some((s: any) => s.start === start)) {
    // The requested time is taken. Record the attempt, never double-book.
    engine.call("book_appointment", { patient_id: subject.id, doctor_id: state.doctor, date, start });
    if (!state.flexible) {
      const options = search.slots.slice(0, 3).map((s: any) => s.start).join(", ");
      return done(
        "abandoned",
        null,
        subject.id,
        null,
        `${start} wala slot ${prettyDate(date)} ko already booked hai. Us din ye slots khali hain: ${options}. Aap bataiye to main lock kar dun.`,
      );
    }
    start = null;
  }
  if (!start) start = search.slots[0].start;

  const { ok, result } = engine.call("book_appointment", {
    patient_id: subject.id,
    doctor_id: state.doctor,
    date,
    start,
  });
  if (!ok) {
    return done(
      "abandoned",
      null,
      subject.id,
      null,
      `Wo slot abhi book nahi ho paya (${result.error}). Aap doosra samay bata dijiye to main phir se dekh leti hoon.`,
    );
  }
  return done(
    "booked",
    null,
    subject.id,
    result.id,
    `${subject.name} ke naam se ${prettyDate(date)} ko ${result.start} par ${doctorName} ke saath appointment book ho gaya hai.`,
  );
}

function existing(engine: Engine, state: State, subject: Patient, done: Done): AgentResult {
  const clinic = engine.clinic;
  const isCancel = state.intent === "cancel";
  const dates = state.dates;
  const referenceDate = dates.length ? dates[0] : null;

  let appointments: Appointment[] = referenceDate ? clinic.findAppointments(subject.id, referenceDate) : [];
  if (!appointments.length && referenceDate) {
    return done(
      "abandoned",
      null,
      subject.id,
      null,
      `${subject.name} ke naam se ${prettyDate(referenceDate)} ko koi appointment record mein nahi hai, isliye maine kuch change nahi kiya.`,
    );
  }
  if (!appointments.length) appointments = clinic.findAppointments(subject.id);
  if (!appointments.length) {
    return done(
      "abandoned",
      null,
      subject.id,
      null,
      `${subject.name} ke naam se koi booked appointment nahi mila, isliye cancel ya reschedule karne ko kuch nahi hai.`,
    );
  }
  const appointment = appointments[0]!;

  if (isCancel) {
    const { ok, result } = engine.call("cancel_appointment", { appointment_id: appointment.id });
    if (!ok) {
      return done("abandoned", null, subject.id, null, `Ye appointment cancel nahi ho paya (${result.error}).`);
    }
    return done(
      "cancelled",
      null,
      subject.id,
      appointment.id,
      `${prettyDate(appointment.date)} ko ${appointment.start} wala appointment cancel kar diya gaya hai.`,
    );
  }

  // reschedule
  const newDate = dates.length > 1 ? dates[dates.length - 1] : dates[0] ?? null;
  if (!newDate || newDate === appointment.date) {
    return done(
      "abandoned",
      null,
      subject.id,
      null,
      "Appointment kis din par shift karna hai? Naya din bata dijiye to main free slots dekh leti hoon.",
    );
  }
  const { result: search } = engine.call("search_slots", {
    doctor_id: appointment.doctor_id,
    date: newDate,
    window: state.window,
  });
  if (search.reason || !search.slots.length) {
    return done(
      "abandoned",
      null,
      subject.id,
      appointment.id,
      `${prettyDate(newDate)} ko shift nahi ho payega — ${CLOSURE_TEXT[search.reason] ?? "us samay koi slot khali nahi hai"}. Doosra din bata dijiye.`,
    );
  }
  let start = state.time;
  if (!start || !search.slots.some((s: any) => s.start === start)) {
    if (state.time && !state.flexible) {
      engine.call("reschedule_appointment", {
        appointment_id: appointment.id,
        new_date: newDate,
        new_start: state.time,
      });
      const options = search.slots.slice(0, 3).map((s: any) => s.start).join(", ");
      return done(
        "abandoned",
        null,
        subject.id,
        appointment.id,
        `${state.time} us din khali nahi hai. ${prettyDate(newDate)} ko ye slots free hain: ${options}. Bataiye to main shift kar dun.`,
      );
    }
    start = search.slots[0].start;
  }
  const { ok, result } = engine.call("reschedule_appointment", {
    appointment_id: appointment.id,
    new_date: newDate,
    new_start: start,
  });
  if (!ok) {
    return done("abandoned", null, subject.id, appointment.id, `Appointment shift nahi ho paya (${result.error}).`);
  }
  return done(
    "rescheduled",
    null,
    subject.id,
    appointment.id,
    `Appointment ${prettyDate(result.date)} ko ${result.start} par shift kar diya gaya hai.`,
  );
}

/** The graded response: exactly the fields in schema.md, nothing else. */
export function toContractResponse(result: AgentResult) {
  const { timeline, ...rest } = result;
  return rest;
}
