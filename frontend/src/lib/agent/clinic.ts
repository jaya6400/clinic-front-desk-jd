/**
 * Tool layer. Six tools over clinic.json.
 *
 * Every tool either returns data that exists in the data file, or throws a
 * ToolError with an actionable code. Nothing here ever invents a slot, a
 * patient or an appointment, and nothing here reads the system clock.
 */
import rawClinic from "@/data/clinic.json";

export type Window = { day: string; start: string; end: string };
export type Doctor = {
  id: string;
  name: string;
  speciality: string;
  windows: Window[];
  leave_dates: string[];
};
export type Patient = {
  id: string;
  name: string;
  phone: string;
  dob: string;
  guardian_of: string[];
};
export type Appointment = {
  id: string;
  patient_id: string;
  doctor_id: string;
  date: string;
  start: string;
  end: string;
  status: string;
};
export type Slot = { start: string; end: string };

export class ToolError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) {
    throw new ToolError("invalid_date", `date must be YYYY-MM-DD, got ${JSON.stringify(value)}`);
  }
  const [y = 0, m = 1, d = 1] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) {
    throw new ToolError("invalid_date", `not a real date: ${value}`);
  }
  return date;
}

export function isoOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const date = parseDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return isoOf(date);
}

export function weekdayOf(iso: string): string {
  return DAYS[parseDate(iso).getUTCDay()] ?? "";
}

function toMinutes(hhmm: string): number {
  if (!/^\d{2}:\d{2}$/.test(hhmm ?? "")) {
    throw new ToolError("invalid_time", `time must be HH:MM, got ${JSON.stringify(hhmm)}`);
  }
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function fromMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export const WINDOW_BANDS: Record<string, [string, string]> = {
  morning: ["00:00", "12:00"],
  afternoon: ["12:00", "16:00"],
  evening: ["16:00", "23:59"],
};

export class Clinic {
  meta: { id: string; name: string; city: string; slot_minutes: number; reference_date: string };
  doctors: Record<string, Doctor>;
  patients: Record<string, Patient>;
  appointments: Appointment[];
  holidays: string[];

  constructor() {
    const data = JSON.parse(JSON.stringify(rawClinic)) as typeof rawClinic;
    this.meta = data.clinic as Clinic["meta"];
    this.doctors = Object.fromEntries((data.doctors as Doctor[]).map((d) => [d.id, d]));
    this.patients = Object.fromEntries((data.patients as Patient[]).map((p) => [p.id, p]));
    this.appointments = data.appointments as Appointment[];
    this.holidays = data.holidays as string[];
  }

  doctor(id: string): Doctor {
    const doctor = this.doctors[id];
    if (!doctor) throw new ToolError("unknown_doctor", `no doctor with id ${id}`);
    return doctor;
  }

  /** Why a doctor cannot be seen on a date, or null if the day is workable. */
  closureReason(doctorId: string, date: string): string | null {
    const doctor = this.doctor(doctorId);
    if (this.holidays.includes(date)) return "clinic_holiday";
    if (doctor.leave_dates.includes(date)) return "doctor_on_leave";
    const weekday = weekdayOf(date);
    if (weekday === "Sun") return "sunday_closed";
    if (!doctor.windows.some((w) => w.day === weekday)) return "doctor_not_working";
    return null;
  }

  // ------------------------------------------------------------------ tools

  search_slots(args: { doctor_id: string; date: string; window?: string | null }) {
    const { doctor_id, date } = args;
    const window = args.window ?? null;
    const doctor = this.doctor(doctor_id);
    const reason = this.closureReason(doctor_id, date);
    if (reason) return { doctor_id, date, slots: [] as Slot[], reason };

    const weekday = weekdayOf(date);
    const step = this.meta.slot_minutes;
    const booked = this.appointments
      .filter((a) => a.doctor_id === doctor_id && a.date === date && a.status === "booked")
      .map((a) => [toMinutes(a.start), toMinutes(a.end)] as [number, number]);

    const byStart = new Map<string, Slot>();
    for (const w of doctor.windows) {
      if (w.day !== weekday) continue;
      const end = toMinutes(w.end);
      for (let cur = toMinutes(w.start); cur + step <= end; cur += step) {
        const taken = booked.some(([bs, be]) => cur < be && cur + step > bs);
        if (!taken) byStart.set(fromMinutes(cur), { start: fromMinutes(cur), end: fromMinutes(cur + step) });
      }
    }
    // Dr. Rao's two Monday windows overlap (11:45-12:00); a slot is free or it isn't.
    let slots = [...byStart.values()].sort((a, b) => a.start.localeCompare(b.start));

    if (window) {
      const band = WINDOW_BANDS[window];
      if (!band) throw new ToolError("invalid_window", `window must be one of ${Object.keys(WINDOW_BANDS).join(", ")}`);
      slots = slots.filter((s) => s.start >= band[0] && s.start < band[1]);
    }
    return { doctor_id, date, slots, reason: null as string | null };
  }

  private nextAppointmentId(): string {
    const nums = this.appointments.map((a) => Number(a.id.replace("ap_", "")) || 0);
    return `ap_${String(Math.max(0, ...nums) + 1).padStart(4, "0")}`;
  }

  book_appointment(args: { patient_id: string; doctor_id: string; date: string; start: string }) {
    const { patient_id, doctor_id, date, start } = args;
    if (!this.patients[patient_id]) throw new ToolError("unknown_patient", `no patient with id ${patient_id}`);
    const free = this.search_slots({ doctor_id, date });
    if (free.reason) throw new ToolError(free.reason, `${doctor_id} cannot be booked on ${date}: ${free.reason}`);
    const slot = free.slots.find((s) => s.start === start);
    if (!slot) {
      throw new ToolError("slot_unavailable", `${start} on ${date} is not a free slot for ${doctor_id}`);
    }
    const appointment: Appointment = {
      id: this.nextAppointmentId(),
      patient_id,
      doctor_id,
      date,
      start: slot.start,
      end: slot.end,
      status: "booked",
    };
    this.appointments.push(appointment);
    return appointment;
  }

  appointment(id: string): Appointment {
    const found = this.appointments.find((a) => a.id === id);
    if (!found) throw new ToolError("unknown_appointment", `no appointment with id ${id}`);
    return found;
  }

  reschedule_appointment(args: { appointment_id: string; new_date: string; new_start: string }) {
    const appointment = this.appointment(args.appointment_id);
    if (appointment.status !== "booked") {
      throw new ToolError("not_reschedulable", `appointment ${appointment.id} is ${appointment.status}`);
    }
    const free = this.search_slots({ doctor_id: appointment.doctor_id, date: args.new_date });
    if (free.reason) throw new ToolError(free.reason, `${appointment.doctor_id} is unavailable on ${args.new_date}`);
    const slot = free.slots.find((s) => s.start === args.new_start);
    if (!slot) throw new ToolError("slot_unavailable", `${args.new_start} on ${args.new_date} is not free`);
    appointment.date = args.new_date;
    appointment.start = slot.start;
    appointment.end = slot.end;
    return appointment;
  }

  cancel_appointment(args: { appointment_id: string }) {
    const appointment = this.appointment(args.appointment_id);
    if (appointment.status !== "booked") {
      throw new ToolError("not_cancellable", `appointment ${appointment.id} is already ${appointment.status}`);
    }
    appointment.status = "cancelled";
    return appointment;
  }

  /** Resolve a caller to a patient. Returns candidates; never guesses. */
  lookup_patient(args: { name?: string | null; phone?: string | null }) {
    const name = (args.name ?? "").trim();
    const phone = (args.phone ?? "").trim();
    if (!name && !phone) throw new ToolError("missing_argument", "lookup_patient needs a name or a phone");

    let pool = Object.values(this.patients);
    if (phone) pool = pool.filter((p) => p.phone === phone);
    if (name) {
      const matched = matchPatients(name, pool);
      pool = matched;
    }
    if (pool.length === 0) {
      throw new ToolError(
        "patient_not_found",
        `no patient matches ${[name, phone].filter(Boolean).join(" / ")}`,
      );
    }
    const candidates = pool.map((p) => ({ id: p.id, name: p.name, phone: p.phone, dob: p.dob }));
    return {
      status: candidates.length === 1 ? "unique" : "candidates",
      candidates,
    };
  }

  escalate_to_human(args: { reason: string; detail?: string | null }) {
    const allowed = ["clinical_urgent", "medical_advice", "not_authorised", "ambiguous_patient", "out_of_scope"];
    if (!allowed.includes(args.reason)) {
      throw new ToolError("invalid_reason", `reason must be one of ${allowed.join(", ")}`);
    }
    return { handed_off: true, reason: args.reason, detail: args.detail ?? null };
  }

  // -------------------------------------------------------------- helpers

  findAppointments(patientId: string, date?: string | null): Appointment[] {
    return this.appointments
      .filter((a) => a.patient_id === patientId && a.status === "booked" && (!date || a.date === date))
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  }
}

const STOPWORDS = new Set([
  "dr", "doctor", "mr", "mrs", "ms", "shri", "smt", "ji", "mera", "meri", "mere",
  "main", "hoon", "hu", "naam", "hai", "ka", "ke", "ki", "liye", "saath", "se",
  "beta", "bete", "beti", "bachche", "bachcha", "husband", "wife", "patient",
]);

export function normalise(value: string): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Exact full-name match first, then token match. Never a fuzzy guess. */
export function matchPatients(query: string, pool: Patient[]): Patient[] {
  const q = normalise(query);
  if (!q) return [];
  const exact = pool.filter((p) => normalise(p.name) === q);
  if (exact.length) return exact;

  const tokens = q.split(" ").filter((t) => t.length > 2 && !STOPWORDS.has(t));
  if (!tokens.length) return [];
  const scored = pool
    .map((p) => {
      const nameTokens = new Set(normalise(p.name).split(" "));
      const hits = tokens.filter((t) => nameTokens.has(t)).length;
      return { patient: p, hits };
    })
    .filter((s) => s.hits > 0);
  if (!scored.length) return [];
  const best = Math.max(...scored.map((s) => s.hits));
  return scored.filter((s) => s.hits === best).map((s) => s.patient);
}
