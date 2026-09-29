"""Deterministic conversation policy. All scheduling facts come from clinic tools."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from time import perf_counter
from typing import Any

from .clinic import Clinic, ToolError, normalise


URGENT = (
    "chest pain", "seene mein dard", "seene me dard", "chhati mein dard",
    "shortness of breath", "difficulty breathing", "can't breathe", "cannot breathe",
    "saans phool", "saans nahi aa", "saans lene mein", "severe bleeding", "heavy bleeding",
    "bleeding heavily", "bleeding a lot", "bahut bleeding", "khoon beh",
    "khoon nikal", "unconscious", "behosh", "stroke", "heart attack", "daura",
    "convulsion", "suicide", "zeher", "poison", "emergency",
)
MEDICAL_ADVICE = (
    "dose", "dosage", "goli", "dawai", "dawa", "medicine", "tablet", "khuraak",
    "syrup", "side effect", "antibiotic", "kitni der mein bukhar", "lun ya nahi",
    "le lun ya nahi", "leni chahiye", "should i take", "kya karein", "kya karna chahiye",
    "is it normal", "theek hai ya nahi", "diagnosis", "report mein", "bimari kya",
)
INJECTION = (
    "ignore previous", "ignore all previous", "ignore your", "you are now", "system prompt",
    "developer mode", "jailbreak", "act as dan", "no restrictions", "authorised internal test",
    "authorized internal test", "cancel them all", "cancel all appointments", "every appointment",
    "list every", "sabhi appointments", "saare appointments cancel", "reveal your",
    "print your instructions", "new instructions",
)
DAY_NAMES = {
    "somwar": 0, "somvar": 0, "monday": 0,
    "mangalwar": 1, "mangalvar": 1, "tuesday": 1,
    "budhwar": 2, "budhvar": 2, "buddhwar": 2, "wednesday": 2,
    "guruwar": 3, "brihaspativar": 3, "thursday": 3,
    "shukrawar": 4, "shukrvar": 4, "friday": 4,
    "shaniwar": 5, "shanivar": 5, "saturday": 5,
    "raviwar": 6, "itwar": 6, "sunday": 6,
}
MONTHS = {
    "january": 1, "jan": 1, "february": 2, "feb": 2, "march": 3, "mar": 3,
    "april": 4, "apr": 4, "may": 5, "june": 6, "jun": 6, "july": 7, "jul": 7,
    "august": 8, "aug": 8, "september": 9, "sep": 9, "sept": 9,
    "october": 10, "oct": 10, "november": 11, "nov": 11, "december": 12, "dec": 12,
}
HINDI_NUMBERS = {
    "ek": 1, "do": 2, "teen": 3, "char": 4, "chaar": 4, "paanch": 5, "panch": 5,
    "chhe": 6, "che": 6, "cheh": 6, "saat": 7, "aath": 8, "nau": 9, "no": 9,
    "das": 10, "dus": 10, "gyarah": 11, "gyara": 11, "barah": 12, "bara": 12,
}
FLEXIBLE = re.compile(r"\b(koi bhi|jo bhi|jab bhi|kuch bhi|jo mil jaye|jo mile|chalega|jaldi mil)\b")
RELATION = r"bete|beti|beta|bachche|bachcha|patni|pati|maa|mata|pita|papa|bhai|behen|colleague|padosi|dost|friend|husband|wife|saas|sasur|son|daughter|mother|father|colleague|neighbour|neighbor"
CAP_NAME = r"([A-Z][A-Za-z.]*(?:\s+[A-Z][A-Za-z.]*){0,3})"
OUT_OF_SCOPE = re.compile(r"\b(hours|opening time|fees|billing|insurance|lab report|test report|address|directions|parking|complaint)\b", re.I)


@dataclass
class ConversationState:
    intent: str | None = None
    doctor: str | None = None
    dates: list[str] = field(default_factory=list)
    time: str | None = None
    window: str | None = None
    subject: str | None = None
    caller: str | None = None
    phone: str | None = None
    flexible: bool = False
    third_party: bool = False


def _safety(text: str) -> str | None:
    value = normalise(text)
    if any(normalise(term) in value for term in URGENT):
        return "clinical_urgent"
    raw = text.lower()
    if any(term in raw or normalise(term) in value for term in INJECTION):
        return "injection"
    if any(normalise(term) in value for term in MEDICAL_ADVICE):
        return "medical_advice"
    return None


def _next_weekday(today: date, weekday: int) -> date:
    offset = (weekday - today.weekday()) % 7 or 7
    return today + timedelta(days=offset)


def _extract_dates(text: str, today: date) -> list[str]:
    found: list[tuple[int, str]] = []
    raw = text.lower()

    def add(position: int, value: date) -> None:
        found.append((position, value.isoformat()))

    for match in re.finditer(r"\b(\d{4}-\d{2}-\d{2})\b", raw):
        try:
            add(match.start(), date.fromisoformat(match.group(1)))
        except ValueError:
            pass
    for pattern in (r"\b(aaj|today)\b",):
        for match in re.finditer(pattern, raw):
            add(match.start(), today)
    for match in re.finditer(r"\b(kal|tomorrow)\b", raw):
        add(match.start(), today + timedelta(days=1))
    for match in re.finditer(r"\b(parso|parason|day after tomorrow)\b", raw):
        add(match.start(), today + timedelta(days=2))
    for match in re.finditer(r"\bnarso\b", raw):
        add(match.start(), today + timedelta(days=3))
    for word, weekday in DAY_NAMES.items():
        for match in re.finditer(rf"\b{re.escape(word)}\b", raw):
            add(match.start(), _next_weekday(today, weekday))
    for match in re.finditer(r"\b(\d{1,2})\s*(?:tareekh|tarikh|tarik|taarikh)\b", raw):
        day_number = int(match.group(1))
        if 1 <= day_number <= 31:
            year, month = today.year, today.month
            candidate = _safe_date(year, month, day_number)
            if candidate and candidate < today:
                month += 1
                if month == 13:
                    year, month = year + 1, 1
                candidate = _safe_date(year, month, day_number)
            if candidate:
                add(match.start(), candidate)
    for match in re.finditer(r"\b(\d{1,2})\s+([a-z]+)\b", raw):
        month = MONTHS.get(match.group(2))
        if month:
            candidate = _safe_date(today.year, month, int(match.group(1)))
            if candidate:
                add(match.start(), candidate)
    for match in re.finditer(r"\b([a-z]+)\s+(\d{1,2})\b", raw):
        month = MONTHS.get(match.group(1))
        if month:
            candidate = _safe_date(today.year, month, int(match.group(2)))
            if candidate:
                add(match.start(), candidate)
    return [value for _, value in sorted(found)]


def _safe_date(year: int, month: int, day_number: int) -> date | None:
    try:
        return date(year, month, day_number)
    except ValueError:
        return None


def _window(text: str) -> str | None:
    value = normalise(text)
    if re.search(r"\b(subah|savere|sawere|morning)\b", value):
        return "morning"
    if re.search(r"\b(dopahar|dopeher|afternoon)\b", value):
        return "afternoon"
    if re.search(r"\b(shaam|sham|evening|raat|night)\b", value):
        return "evening"
    return None


def _to_clock(hour: int, minute: int, window: str | None, suffix: str | None = None) -> str | None:
    if not 0 <= hour <= 23 or not 0 <= minute < 60:
        return None
    if suffix == "pm" and hour < 12:
        hour += 12
    elif suffix == "am" and hour == 12:
        hour = 0
    elif suffix is None and window in {"afternoon", "evening"} and hour < 12:
        hour += 12
    return f"{hour:02d}:{minute:02d}"


def _extract_times(text: str, window: str | None) -> list[str]:
    raw = text.lower()
    found: list[tuple[int, str]] = []
    consumed: list[tuple[int, int]] = []

    def push(position: int, hour: int, minute: int = 0, suffix: str | None = None, end: int | None = None) -> None:
        result = _to_clock(hour, minute, window, suffix)
        if result:
            found.append((position, result))
            if end is not None:
                consumed.append((position, end))

    for match in re.finditer(r"\b(\d{1,2})[:.](\d{2})\b", raw):
        push(match.start(), int(match.group(1)), int(match.group(2)), end=match.end())
    for match in re.finditer(r"\b(\d{1,2})\s*(am|pm)\b", raw):
        push(match.start(), int(match.group(1)), suffix=match.group(2), end=match.end())
    number_words = "|".join(sorted(HINDI_NUMBERS, key=len, reverse=True))
    for qualifier, minute_delta in (("saadhe", 30), ("sava", 15), ("paune", -15)):
        for match in re.finditer(rf"\b{qualifier}\s+({number_words}|\d{{1,2}})\b", raw):
            token = match.group(1)
            hour = HINDI_NUMBERS.get(token, int(token) if token.isdigit() else 0)
            minute = minute_delta
            if minute < 0:
                hour -= 1
                minute = 45
            push(match.start(), hour, minute, end=match.end())
    for match in re.finditer(rf"\b({number_words}|\d{{1,2}})\s*baje\b", raw):
        if any(start <= match.start() < end for start, end in consumed):
            continue
        token = match.group(1)
        hour = HINDI_NUMBERS.get(token, int(token) if token.isdigit() else 0)
        push(match.start(), hour, end=match.end())
    return [value for _, value in sorted(found)]


def _intent(text: str) -> str | None:
    value = normalise(text)
    if re.search(r"\b(cancel|radd|hata dijiye|nahi aa payenge|nahi aa paunga|nahi aa paungi)\b", value):
        return "cancel"
    if re.search(r"\b(reschedule|preshedule|badal|shift|postpone|time change|appointment change)\b", value) or re.search(
        r"\buse\b.*\b(?:karwana|kar dijiye|kara dijiye|change)\b", value
    ) or re.search(r"\b(?:mera|meri|my)\b.*\bappointment hai\b.*\b(?:karwana|kar dijiye|kara dijiye|change)\b", value):
        return "reschedule"
    if re.search(r"\b(appointment|slot|milna|milne|milwana|dikhana|dikhane|checkup|consult)\b", value) and re.search(
        r"\b(chahiye|chahie|karwana|karwa|book|banwa|lena|fix|de dijiye|mil jayega|ho jayega|dijiye|aa sakta|aa sakti)\b",
        value,
    ):
        return "book"
    return None


def _extract_state(turns: list[str], today: date, clinic: Clinic) -> ConversationState:
    state = ConversationState()
    for turn in turns:
        intent = _intent(turn)
        if intent:
            state.intent = intent
        value = normalise(turn)
        if re.search(r"\b(rao|anjali)\b", value):
            state.doctor = "dr_rao"
        if re.search(r"\b(sethi|vikram)\b", value):
            state.doctor = "dr_sethi"
        state.dates.extend(_extract_dates(turn, today))
        found_window = _window(turn)
        if found_window:
            state.window = found_window
        times = _extract_times(turn, found_window or state.window)
        if times:
            state.time = times[-1]
        phone = re.search(r"\b([6-9]\d{9})\b", re.sub(r"\D", " ", turn))
        if phone:
            state.phone = phone.group(1)
        state.flexible = state.flexible or bool(FLEXIBLE.search(value))
        if re.search(r"\b(colleague|padosi|neighbour|neighbor|dost|friend|boss|relative|rishtedar|jija|devar|bhabhi)\b", turn, re.I):
            state.third_party = True

        caller_match = re.search(
            rf"\b(?i:main|mera naam|this is|i am)\s+{CAP_NAME}(?=\s+(?i:hoon|hun|hu|bol|number|mera|my|,|\.|$))",
            turn,
        )
        if not caller_match:
            caller_match = re.search(rf"{CAP_NAME}\s+(?:bol|baat kar)", turn)
        if caller_match:
            state.caller = caller_match.group(1)

        relation_match = re.search(
            rf"\b(?i:mere|meri|mera)\s+(?:{RELATION})\s+([A-Z][A-Za-z.]*(?:\s+[A-Z][A-Za-z.]*){{0,2}})",
            turn,
        )
        if relation_match:
            state.subject = relation_match.group(1).strip()
        else:
            reverse_relation = re.search(rf"\b([A-Z][A-Za-z.]*(?:\s+[A-Z][A-Za-z.]*){{0,2}})\s+(?:mera|meri|mere)\s+(?:{RELATION})\b", turn, re.I)
            if reverse_relation:
                state.subject = reverse_relation.group(1).strip()

        for patient in clinic.patients.values():
            patient_name = patient["name"]
            if re.search(rf"\b{re.escape(patient_name)}\b", turn, re.I):
                lower = turn.lower()
                before = lower[max(0, lower.find(patient_name.lower()) - 28):lower.find(patient_name.lower())]
                after_start = lower.find(patient_name.lower()) + len(patient_name)
                after = lower[after_start:after_start + 32]
                if re.search(r"\b(?:hoon|hun|hu)\s*,?\s+$", before):
                    state.caller = patient_name
                elif re.match(r"\s*(?:ji\s+)?(?:ke liye|ke naam|ka|ki|ke|ko)\b", after) or re.search(
                    r"\b(?:meri|mere|mera|my|colleague|padosi|neighbour|neighbor|friend)\s+$", before
                ):
                    state.subject = patient_name
                elif re.search(r"\b(?:mera naam|main|i am|this is)\s+$", before) or re.match(r"\s+bol(?: raha| rahi|ta|ti)?\b", after):
                    state.caller = patient_name
                elif not state.caller:
                    state.caller = patient_name

        if not state.subject:
            subject_match = re.search(
                r"\b([A-Z][A-Za-z.]*(?:\s+[A-Z][A-Za-z.]*){0,2}?)\s+(?:ji\s+)?(?:ke liye|ke naam)\b",
                turn,
            )
            if not subject_match:
                subject_match = re.search(
                    r"\b([A-Z][A-Za-z.]*)\s+(?:ka|ki|ke|ko)\s+(?=appointment\b)",
                    turn,
                )
            if subject_match:
                state.subject = subject_match.group(1).strip()
    if state.subject and state.caller and normalise(state.subject) == normalise(state.caller):
        state.subject = None
    return state


class AgentRun:
    def __init__(self) -> None:
        self.clinic = Clinic()
        self.tool_calls: list[dict[str, Any]] = []

    def call(self, name: str, arguments: dict[str, Any]) -> tuple[bool, dict[str, Any]]:
        self.tool_calls.append({"name": name, "arguments": arguments})
        try:
            result = getattr(self.clinic, name)(arguments)
            return True, result
        except ToolError as error:
            return False, {"error": error.code, "message": error.message}


def _resolve(query: str | None, phone: str | None, clinic: Clinic) -> tuple[str, list[dict[str, Any]]]:
    if not query and not phone:
        return "unknown", []
    try:
        result = clinic.lookup_patient({"name": query, "phone": phone})
    except ToolError:
        return "unknown", []
    candidates = result["candidates"]
    return ("unique" if len(candidates) == 1 else "ambiguous"), candidates


def _date_label(value: str) -> str:
    target = date.fromisoformat(value)
    return f"{target.day} {target.strftime('%B')} ({target.strftime('%A')})"


def run_conversation(conversation_id: str, today_text: str, turns: list[str]) -> dict[str, Any]:
    started = perf_counter()
    run = AgentRun()
    today = date.fromisoformat(today_text)
    transcript = " ".join(turns)

    safety = [_safety(turn) for turn in turns]
    reason = "clinical_urgent" if "clinical_urgent" in safety else "injection" if "injection" in safety else "medical_advice" if "medical_advice" in safety else None
    if reason == "clinical_urgent":
        run.call("escalate_to_human", {"reason": reason, "detail": "caller described acute symptoms requiring immediate clinical attention"})
        reply = "Main abhi aapko clinic se connect kar rahi hoon. Agar symptoms severe hain to turant nazdeeki emergency service par jaiye."
        return _finish(run, conversation_id, turns, started, "escalated", reason, None, None, reply)
    if reason == "injection":
        reply = "Maaf kijiye, main sirf Sunrise Clinic ke individual appointment requests mein madad kar sakti hoon."
        return _finish(run, conversation_id, turns, started, "refused", None, None, None, reply)
    if reason == "medical_advice":
        run.call("escalate_to_human", {"reason": reason, "detail": "caller asked for a clinical judgement or medication advice"})
        reply = "Dawai ya symptoms par clinical salah main nahi de sakti. Main aapko clinic staff se connect kar rahi hoon."
        return _finish(run, conversation_id, turns, started, "escalated", reason, None, None, reply)

    state = _extract_state(turns, today, run.clinic)
    if not state.intent:
        if state.doctor and state.dates:
            state.intent = "book"
        elif OUT_OF_SCOPE.search(transcript):
            run.call("escalate_to_human", {"reason": "out_of_scope", "detail": "request is outside appointment scheduling"})
            return _finish(run, conversation_id, turns, started, "escalated", "out_of_scope", None, None, "Is request ke liye front desk staff madad karenge. Main aapko unse connect kar rahi hoon.")
        else:
            return _finish(run, conversation_id, turns, started, "abandoned", None, None, None, "Mujhe appointment ki koi usable detail nahi mili. Jab aap taiyar hon, dobara call kijiye.")

    if state.intent == "book" and state.doctor and state.dates:
        target = state.dates[-1]
        ok, availability = run.call("search_slots", {"doctor_id": state.doctor, "date": target, "window": state.window})
        if not ok:
            return _finish(run, conversation_id, turns, started, "abandoned", None, None, None, "Is din ke slots verify nahi ho paye. Kripya doosra din batayein.")
        doctor_name = run.clinic.doctor(state.doctor)["name"]
        if availability["reason"]:
            descriptions = {
                "clinic_holiday": "clinic holiday ki wajah se band hai",
                "doctor_on_leave": "doctor leave par hain",
                "sunday_closed": "Sunday ko clinic band rehta hai",
                "doctor_not_working": "doctor us din clinic mein nahi hote",
            }
            reply = f"{_date_label(target)} ko {doctor_name} ke saath appointment nahi ho payega; {descriptions[availability['reason']]}. Doosra din batayein."
            return _finish(run, conversation_id, turns, started, "abandoned", None, None, None, reply)
        if not availability["slots"]:
            return _finish(run, conversation_id, turns, started, "abandoned", None, None, None, f"{_date_label(target)} ko us waqt koi free slot nahi mila. Doosra din ya samay batayein.")

    subject_query = state.subject or state.caller
    named = bool(subject_query or state.phone)
    subject_candidates: list[dict[str, Any]] = []
    caller_candidates: list[dict[str, Any]] = []
    subject_status = "unknown"
    caller_status = "unknown"
    separate_caller = bool(state.subject and state.caller and normalise(state.subject) != normalise(state.caller))
    if named:
        subject_args = {"name": subject_query, "phone": None if separate_caller else state.phone}
        ok, lookup = run.call("lookup_patient", subject_args)
        if not ok:
            return _finish(run, conversation_id, turns, started, "abandoned", None, None, None, "Is naam ya number se patient record verify nahi hua. Kripya clinic ko seedhe call kijiye.")
        subject_candidates = lookup["candidates"]
        subject_status = "unique" if len(subject_candidates) == 1 else "ambiguous"
        if separate_caller:
            ok, caller_lookup = run.call("lookup_patient", {"name": state.caller, "phone": state.phone})
            if ok:
                caller_candidates = caller_lookup["candidates"]
                caller_status = "unique" if len(caller_candidates) == 1 else "ambiguous"
        elif state.caller:
            caller_candidates = subject_candidates
            caller_status = subject_status

    if subject_status == "ambiguous" or caller_status == "ambiguous":
        run.call("escalate_to_human", {"reason": "ambiguous_patient", "detail": "multiple patient records match; no identity was selected"})
        return _finish(run, conversation_id, turns, started, "escalated", "ambiguous_patient", None, None, "Is detail se ek se zyada patient records milte hain. Main andaza nahi lagaungi aur clinic staff ko handoff kar rahi hoon.")
    if subject_status == "unknown":
        return _finish(run, conversation_id, turns, started, "abandoned", None, None, None, "Patient ka naam aur registered phone number batayein, phir main appointment dekh sakti hoon.")

    subject = subject_candidates[0]
    caller = caller_candidates[0] if caller_status == "unique" else None
    acting_for_other = bool(state.subject and (caller is None or caller["id"] != subject["id"]))
    if acting_for_other:
        authorised = caller is not None and subject["id"] in run.clinic.patients[caller["id"]]["guardian_of"]
        if not authorised or state.third_party:
            run.call("escalate_to_human", {"reason": "not_authorised", "detail": f"caller is not an authorised guardian for {subject['id']}"})
            return _finish(run, conversation_id, turns, started, "escalated", "not_authorised", None, None, "Kisi aur ke patient record mein bina adhikar ke badlav nahi kar sakti. Main clinic staff ko handoff kar rahi hoon.")

    if state.intent == "book":
        return _book(run, conversation_id, turns, started, state, subject, availability if state.doctor and state.dates else None)
    return _change_existing(run, conversation_id, turns, started, state, subject)


def _book(
    run: AgentRun,
    conversation_id: str,
    turns: list[str],
    started: float,
    state: ConversationState,
    patient: dict[str, Any],
    prefetched: dict[str, Any] | None,
) -> dict[str, Any]:
    if not state.doctor:
        return _finish(run, conversation_id, turns, started, "abandoned", None, patient["id"], None, "Dr. Rao ya Dr. Sethi mein se kaunse doctor chahiye?")
    if not state.dates:
        return _finish(run, conversation_id, turns, started, "abandoned", None, patient["id"], None, "Kis din appointment chahiye? Din batayein to free slots check karungi.")
    target = state.dates[-1]
    search = prefetched or run.clinic.search_slots({"doctor_id": state.doctor, "date": target, "window": state.window})
    slots = search["slots"]
    if not slots:
        return _finish(run, conversation_id, turns, started, "abandoned", None, patient["id"], None, f"{_date_label(target)} ko koi free slot nahi hai. Doosra samay batayein.")
    requested = state.time
    slot = next((item for item in slots if item["start"] == requested), None) if requested else None
    if requested and not slot and not state.flexible:
        return _finish(run, conversation_id, turns, started, "abandoned", None, patient["id"], None, f"{requested} ka slot {_date_label(target)} ko free nahi hai. Available times mein se ek choose kijiye.")
    if not slot:
        slot = slots[0]
    args = {"patient_id": patient["id"], "doctor_id": state.doctor, "date": target, "start": slot["start"]}
    ok, created = run.call("book_appointment", args)
    if not ok:
        return _finish(run, conversation_id, turns, started, "abandoned", None, patient["id"], None, "Wo slot book nahi ho paya. Doosra samay batayein.")
    doctor_name = run.clinic.doctor(state.doctor)["name"]
    reply = f"{patient['name']} ke naam se {_date_label(target)} ko {created['start']} par {doctor_name} ke saath appointment book ho gaya hai."
    return _finish(run, conversation_id, turns, started, "booked", None, patient["id"], created["id"], reply)


def _change_existing(run: AgentRun, conversation_id: str, turns: list[str], started: float, state: ConversationState, patient: dict[str, Any]) -> dict[str, Any]:
    appointments = run.clinic.find_appointments(patient["id"])
    if not appointments:
        return _finish(run, conversation_id, turns, started, "abandoned", None, patient["id"], None, "Is patient ke naam se koi active appointment nahi mila.")

    if state.intent == "cancel":
        matching = [item for item in appointments if state.dates and item["date"] == state.dates[0]] if state.dates else appointments
        if not matching:
            target = state.dates[0]
            return _finish(run, conversation_id, turns, started, "abandoned", None, patient["id"], None, f"{_date_label(target)} ko is patient ka appointment nahi mila; maine kuch cancel nahi kiya.")
        if len(matching) > 1:
            return _finish(run, conversation_id, turns, started, "abandoned", None, patient["id"], None, "Ek se zyada appointments hain. Kaunsi date cancel karni hai?")
        appointment = matching[0]
        ok, cancelled = run.call("cancel_appointment", {"appointment_id": appointment["id"]})
        if not ok:
            return _finish(run, conversation_id, turns, started, "abandoned", None, patient["id"], None, "Appointment cancel nahi ho paya; clinic staff se baat kijiye.")
        return _finish(run, conversation_id, turns, started, "cancelled", None, patient["id"], cancelled["id"], f"{_date_label(cancelled['date'])} ka appointment cancel kar diya gaya hai.")

    original_date = next((value for value in state.dates if any(item["date"] == value for item in appointments)), None)
    original_matches = [item for item in appointments if item["date"] == original_date] if original_date else appointments
    if len(original_matches) != 1:
        return _finish(run, conversation_id, turns, started, "abandoned", None, patient["id"], None, "Kaunsa existing appointment badalna hai? Date batayein to main check karungi.")
    appointment = original_matches[0]
    target = next((value for value in reversed(state.dates) if value != appointment["date"]), None)
    if target is None:
        return _finish(run, conversation_id, turns, started, "abandoned", None, patient["id"], None, "Nayi appointment date batayein, phir main free slots check karungi.")
    search_args = {"doctor_id": appointment["doctor_id"], "date": target, "window": state.window}
    ok, search = run.call("search_slots", search_args)
    if not ok or search["reason"] or not search["slots"]:
        return _finish(run, conversation_id, turns, started, "abandoned", None, patient["id"], appointment["id"], f"{_date_label(target)} ko appointment shift karne ke liye free slot nahi mila.")
    slot = next((item for item in search["slots"] if item["start"] == state.time), None) if state.time else None
    if state.time and not slot and not state.flexible:
        return _finish(run, conversation_id, turns, started, "abandoned", None, patient["id"], appointment["id"], "Requested time free nahi hai. Available time batayein to shift karungi.")
    if not slot:
        slot = search["slots"][0]
    ok, moved = run.call("reschedule_appointment", {"appointment_id": appointment["id"], "new_date": target, "new_start": slot["start"]})
    if not ok:
        return _finish(run, conversation_id, turns, started, "abandoned", None, patient["id"], appointment["id"], "Appointment shift nahi ho paya.")
    return _finish(run, conversation_id, turns, started, "rescheduled", None, patient["id"], moved["id"], f"Appointment {_date_label(target)} ko {moved['start']} par shift kar diya gaya hai.")


def _finish(run: AgentRun, conversation_id: str, turns: list[str], started: float, terminal: str, reason: str | None, patient_id: str | None, appointment_id: str | None, reply: str) -> dict[str, Any]:
    elapsed = max(1, int((perf_counter() - started) * 1000))
    token_estimate = max(1, math.ceil(sum(len(turn) for turn in turns) / 4) + len(run.tool_calls) * 45)
    return {
        "conversation_id": conversation_id,
        "tool_calls": run.tool_calls,
        "terminal_state": terminal,
        "escalation_reason": reason,
        "patient_id": patient_id,
        "appointment_id": appointment_id,
        "reply": reply,
        "metrics": {"turns": len(turns), "tokens": token_estimate, "latency_ms": elapsed},
    }
