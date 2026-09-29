/**
 * Deterministic Hinglish parsing: safety lexicon, intent, dates, times,
 * doctors, names and phones. No model, no randomness, no system clock.
 */
import { addDays, normalise, weekdayOf, type Patient } from "./clinic";

export type Safety = "clinical_urgent" | "medical_advice" | "injection" | null;

const EMERGENCY = [
  "seene mein dard", "seene me dard", "chest pain", "chhati mein dard",
  "saans phool", "saans nahi", "saans lene", "breathless", "shortness of breath",
  "behosh", "unconscious", "faint ho", "bleeding", "khoon beh", "khoon nikal",
  "stroke", "heart attack", "fit aa rahe", "daura", "convulsion",
  "bahut tez dard", "emergency", "serious ho gaya", "blood pressure gir",
  "suicide", "jaan lene", "poison", "zeher",
];

const MEDICAL_ADVICE = [
  "goli", "dawai", "dawa", "medicine", "tablet", "dose", "khuraak", "syrup",
  "side effect", "antibiotic", "injection lag", "kitni der mein bukhar",
  "le lun ya nahi", "lun ya nahi", "leni chahiye", "should i take",
  "kya karein", "kya karna chahiye", "is it normal", "theek hai ya nahi",
  "diagnosis", "report mein", "bimari kya",
];

const INJECTION = [
  "ignore previous", "ignore all previous", "ignore your", "you are now",
  "system prompt", "developer mode", "jailbreak", " dan,", "act as dan",
  "no restrictions", "authorised internal test", "authorized internal test",
  "cancel them all", "cancel all appointments", "every appointment",
  "list every", "sabhi appointments", "saare appointments cancel",
  "reveal your", "print your instructions", "new instructions",
];

export function classifySafety(text: string): Safety {
  const t = ` ${normalise(text)} `;
  const raw = ` ${(text ?? "").toLowerCase()} `;
  if (EMERGENCY.some((k) => t.includes(normalise(k)))) return "clinical_urgent";
  if (INJECTION.some((k) => raw.includes(k) || t.includes(normalise(k)))) return "injection";
  if (MEDICAL_ADVICE.some((k) => t.includes(normalise(k)))) return "medical_advice";
  return null;
}

// ------------------------------------------------------------------ intent

const BOOK = /(appointment|slot|time|milna|milne|milwana|dikhana|dikhane|checkup|consult)/;
const BOOK_VERB = /(chahiye|chahie|karwana|karwa|book|banwa|bana|lena|le lijiye|fix|de dijiye|mil jayega|ho jayega|dijiye|dikhana|milna)/;
const RESCHEDULE = /(reschedule|preshedule|badal|badlna|shift|aage badha|postpone|change kar|dusre din|aur din|time change|appointment hai.*(?:karwana|kar dijiye|karna hai|kara dijiye|kar do))/;
const CANCEL = /(cancel|radd|hata dijiye|nahi aa payenge|nahi aa paunga|nahi aa paungi|khatam kar)/;

export type Intent = "book" | "reschedule" | "cancel" | null;

export function detectIntent(text: string): Intent {
  const t = normalise(text);
  if (CANCEL.test(t)) return "cancel";
  if (RESCHEDULE.test(t)) return "reschedule";
  if (BOOK.test(t) && BOOK_VERB.test(t)) return "book";
  return null;
}

// -------------------------------------------------------------------- dates

const WEEKDAYS: Record<string, string> = {
  somwar: "Mon", somvar: "Mon", monday: "Mon",
  mangalwar: "Tue", mangalvar: "Tue", tuesday: "Tue",
  budhwar: "Wed", budhvar: "Wed", buddhwar: "Wed", wednesday: "Wed",
  guruwar: "Thu", brihaspativar: "Thu", thursday: "Thu",
  shukrawar: "Fri", shukrvar: "Fri", friday: "Fri",
  shaniwar: "Sat", shanivar: "Sat", saturday: "Sat",
  raviwar: "Sun", itwar: "Sun", sunday: "Sun",
};

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11,
  december: 12, dec: 12,
};

function nextWeekday(today: string, target: string): string {
  for (let i = 1; i <= 7; i += 1) {
    const candidate = addDays(today, i);
    if (weekdayOf(candidate) === target) return candidate;
  }
  return today;
}

function dayOfMonthOnOrAfter(today: string, day: number): string {
  const [y = 0, m = 1] = today.split("-").map(Number);
  const iso = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const thisMonth = iso(y, m);
  if (day <= 31 && thisMonth >= today) return thisMonth;
  const nm = m === 12 ? 1 : m + 1;
  const ny = m === 12 ? y + 1 : y;
  return iso(ny, nm);
}

/** Every date mentioned in a turn, in order of appearance. */
export function extractDates(text: string, today: string): string[] {
  const found: { at: number; date: string }[] = [];
  const raw = (text ?? "").toLowerCase();
  const push = (at: number, date: string) => found.push({ at, date });

  for (const m of raw.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)) push(m.index ?? 0, m[1]!);
  for (const m of raw.matchAll(/\b(aaj|today)\b/g)) push(m.index ?? 0, today);
  for (const m of raw.matchAll(/\b(kal|tomorrow)\b/g)) push(m.index ?? 0, addDays(today, 1));
  for (const m of raw.matchAll(/\b(parso|parason|day after tomorrow)\b/g)) push(m.index ?? 0, addDays(today, 2));
  for (const m of raw.matchAll(/\b(narso)\b/g)) push(m.index ?? 0, addDays(today, 3));
  for (const [word, day] of Object.entries(WEEKDAYS)) {
    for (const m of raw.matchAll(new RegExp(`\\b${word}\\b`, "g"))) push(m.index ?? 0, nextWeekday(today, day));
  }
  for (const m of raw.matchAll(/\b(\d{1,2})\s*(?:tareekh|tarikh|tarik|taarikh)\b/g)) {
    push(m.index ?? 0, dayOfMonthOnOrAfter(today, Number(m[1])));
  }
  for (const m of raw.matchAll(/\b(\d{1,2})\s+([a-z]+)\b/g)) {
    const month = MONTHS[m[2]!];
    if (month) {
      const y = Number(today.slice(0, 4));
      push(m.index ?? 0, `${y}-${String(month).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`);
    }
  }
  for (const m of raw.matchAll(/\b([a-z]+)\s+(\d{1,2})\b/g)) {
    const month = MONTHS[m[1]!];
    if (month) {
      const y = Number(today.slice(0, 4));
      push(m.index ?? 0, `${y}-${String(month).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`);
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.date);
}

// -------------------------------------------------------------------- times

const NUMBERS: Record<string, number> = {
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, che: 6,
  cheh: 6, saat: 7, aath: 8, nau: 9, no: 9, das: 10, dus: 10, gyarah: 11,
  gyara: 11, barah: 12, bara: 12,
};

export type TimeWindow = "morning" | "afternoon" | "evening" | null;

export function extractWindow(text: string): TimeWindow {
  const t = normalise(text);
  if (/\b(subah|savere|sawere|morning)\b/.test(t)) return "morning";
  if (/\b(dopahar|dopeher|afternoon)\b/.test(t)) return "afternoon";
  if (/\b(shaam|sham|evening|raat|night)\b/.test(t)) return "evening";
  return null;
}

function toClock(hour: number, minute: number, window: TimeWindow): string | null {
  let h = hour;
  if (h > 23) return null;
  if (window === "evening" && h < 12) h += 12;
  else if (window === "afternoon" && h < 12 && h !== 12) h += 12;
  else if (!window && h >= 1 && h <= 7) h += 12;
  if (h > 23) return null;
  return `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Every clock time mentioned in a turn, in order of appearance. */
export function extractTimes(text: string, window: TimeWindow): string[] {
  // Keep ":" and "." so "9:30" survives; normalise() would strip them.
  const raw = (text ?? "").toLowerCase().replace(/[^a-z0-9:.\s]/g, " ").replace(/\s+/g, " ").trim();
  const found: { at: number; time: string }[] = [];
  const push = (at: number, time: string | null) => {
    if (time) found.push({ at, time });
  };

  for (const m of raw.matchAll(/\b(\d{1,2})[:.](\d{2})\b/g)) {
    push(m.index ?? 0, toClock(Number(m[1]), Number(m[2]), window));
  }
  const words = Object.keys(NUMBERS).join("|");
  for (const m of raw.matchAll(new RegExp(`\\bsaadhe\\s+(${words}|\\d{1,2})\\b`, "g"))) {
    push(m.index ?? 0, toClock(NUMBERS[m[1]!] ?? Number(m[1]), 30, window));
  }
  for (const m of raw.matchAll(new RegExp(`\\bsava\\s+(${words}|\\d{1,2})\\b`, "g"))) {
    push(m.index ?? 0, toClock(NUMBERS[m[1]!] ?? Number(m[1]), 15, window));
  }
  for (const m of raw.matchAll(new RegExp(`\\bpaune\\s+(${words}|\\d{1,2})\\b`, "g"))) {
    const n = (NUMBERS[m[1]!] ?? Number(m[1])) - 1;
    push(m.index ?? 0, toClock(n, 45, window));
  }
  for (const m of raw.matchAll(new RegExp(`\\b(${words}|\\d{1,2})\\s*baje\\b`, "g"))) {
    push(m.index ?? 0, toClock(NUMBERS[m[1]!] ?? Number(m[1]), 0, window));
  }
  for (const m of raw.matchAll(/\b(\d{1,2})\s*(am|pm)\b/g)) {
    let h = Number(m[1]);
    if (m[2] === "pm" && h < 12) h += 12;
    push(m.index ?? 0, `${String(h).padStart(2, "0")}:00`);
  }
  // "saadhe nau" already handled; avoid double counting "9:30" inside "9 baje"
  return found.sort((a, b) => a.at - b.at).map((f) => f.time);
}

// ------------------------------------------------------------ doctors, people

export function extractDoctor(text: string): string | null {
  const t = normalise(text);
  if (/\brao\b|anjali/.test(t)) return "dr_rao";
  if (/\bsethi\b|vikram/.test(t)) return "dr_sethi";
  return null;
}

export function extractPhone(text: string): string | null {
  const m = (text ?? "").replace(/[^0-9]/g, " ").match(/\b([6-9]\d{9})\b/);
  return m?.[1] ?? null;
}

const FLEXIBLE = /(koi bhi|jo bhi|jab bhi|kuch bhi|jo mil jaye|jo mile|chalega|jaldi mil)/;

export function isFlexible(text: string): boolean {
  return FLEXIBLE.test(normalise(text));
}

/**
 * Who the caller says they are, and who the appointment is for.
 * Names are only read where the caller writes them as names (capitalised),
 * so "main baad mein call karta hoon" never becomes a patient query.
 */
const NAME = "((?:[A-Z][A-Za-z.]*)(?:\\s+[A-Z][A-Za-z.]*){0,3})";

function cleanName(value: string): string | null {
  const name = value.replace(/\s+/g, " ").trim().replace(/^(?:Dr\.?|Doctor)\s+/i, "");
  if (!name || name.length < 3) return null;
  if (/^(rao|sethi|anjali|vikram|namaste|hello|haan|accha|theek|main|mera|meri)$/i.test(name)) return null;
  return name;
}

export function extractPeople(text: string): { subject?: string; caller?: string } {
  const raw = (text ?? "").replace(/\s+/g, " ").trim();
  const isDoctor = /^(?:dr\.?|doctor)\s/i.test(raw);
  const out: { subject?: string; caller?: string } = {};

  const callerPatterns = [
    new RegExp(`\\b[Mm]ain\\s+${NAME}\\s+(?:hoon|hun|hu|bol|baat)`),
    new RegExp(`\\b[Mm]ain\\s+${NAME}\\s*[,.]`),
    new RegExp(`\\b(?:[Mm]era|[Mm]eri)\\s+naam\\s+${NAME}\\b`),
    new RegExp(`\\b${NAME}\\s+(?:bol|baat kar)`),
    new RegExp(`\\bthis is\\s+${NAME}\\b`),
  ];
  for (const pattern of callerPatterns) {
    const m = raw.match(pattern);
    const name = m ? cleanName(m[1] ?? "") : null;
    if (name) {
      out.caller = name;
      break;
    }
  }

  const relations =
    "bete|beti|beta|bachche|bachcha|patni|pati|maa|mata|pita|papa|bhai|behen|colleague|padosi|dost|friend|husband|wife|saas|sasur";
  const subjectPatterns = [
    new RegExp(`\\b(?:mere|meri|mera)\\s+(?:${relations})\\s+${NAME}\\b`, "i"),
    new RegExp(`\\b${NAME}(?:\\s+ji)?\\s+(?:ke liye|ke naam)`),
    new RegExp(`\\b${NAME}(?:\\s+ji)?\\s+(?:ka|ki|ke|ko)\\b(?=[^?.!]*\\bappointment\\b)`),
    new RegExp(`\\bfor my\\s+(?:son|daughter|wife|husband|mother|father|colleague|neighbour|friend)\\s+${NAME}\\b`, "i"),
  ];
  for (const pattern of subjectPatterns) {
    const m = raw.match(pattern);
    const name = m ? cleanName(m[1] ?? "") : null;
    if (name && !(isDoctor && raw.indexOf(m![1]!) === 0)) {
      out.subject = name;
      break;
    }
  }
  if (out.subject && out.caller && out.subject === out.caller) delete out.subject;
  return out;
}


/** Full patient names that literally appear in the transcript. */
export function nameMentions(text: string, patients: Patient[]): Patient[] {
  const t = ` ${normalise(text)} `;
  return patients.filter((p) => t.includes(` ${normalise(p.name)} `));
}

/** True when the caller claims a relationship that is not a listed guardianship. */
export function claimsThirdParty(text: string): boolean {
  return /(colleague|padosi|neighbour|neighbor|dost|friend|boss|relative|rishtedar|jija|devar|bhabhi)/i.test(text ?? "");
}
