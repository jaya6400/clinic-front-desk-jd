"""Deterministic clinic tools backed by the repository's synthetic clinic data."""

from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path
from threading import RLock
from typing import Any


CLINIC_FILE = Path(__file__).resolve().parents[1] / "clinic.json"
WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
WINDOWS = {
    "morning": (0, 12 * 60),
    "afternoon": (12 * 60, 16 * 60),
    "evening": (16 * 60, 24 * 60),
}
STOPWORDS = {
    "dr", "doctor", "mr", "mrs", "ms", "shri", "smt", "ji", "mera", "meri",
    "mere", "main", "hoon", "hu", "naam", "hai", "ka", "ke", "ki", "liye",
    "saath", "se", "beta", "bete", "beti", "bachche", "bachcha", "husband",
    "wife", "patient",
}


class ToolError(ValueError):
    """An invalid or unavailable tool operation with a stable machine code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def normalise(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9\s]", " ", value.lower())).strip()


def _date(value: Any) -> date:
    if not isinstance(value, str):
        raise ToolError("invalid_date", "date must be a YYYY-MM-DD string")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as error:
        raise ToolError("invalid_date", f"date must be a real YYYY-MM-DD date: {value!r}") from error
    if parsed.isoformat() != value:
        raise ToolError("invalid_date", f"date must use YYYY-MM-DD format: {value!r}")
    return parsed


def _minutes(value: Any) -> int:
    if not isinstance(value, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
        raise ToolError("invalid_time", "time must be a valid HH:MM value")
    hour, minute = map(int, value.split(":"))
    return hour * 60 + minute


def _clock(value: int) -> str:
    return f"{value // 60:02d}:{value % 60:02d}"


class Clinic:
    """One isolated clinic state. A new instance is made for each API request."""

    def __init__(self, clinic_file: Path = CLINIC_FILE) -> None:
        with clinic_file.open(encoding="utf-8") as handle:
            data = json.load(handle)
        self.meta = data["clinic"]
        self.doctors = {doctor["id"]: doctor for doctor in data["doctors"]}
        self.patients = {patient["id"]: patient for patient in data["patients"]}
        self.appointments = data["appointments"]
        self.holidays = set(data["holidays"])
        self._lock = RLock()

    def doctor(self, doctor_id: Any) -> dict[str, Any]:
        if not isinstance(doctor_id, str) or doctor_id not in self.doctors:
            raise ToolError("unknown_doctor", f"doctor_id {doctor_id!r} is not in the clinic directory")
        return self.doctors[doctor_id]

    def closure_reason(self, doctor_id: str, target: date) -> str | None:
        doctor = self.doctor(doctor_id)
        iso = target.isoformat()
        if iso in self.holidays:
            return "clinic_holiday"
        if iso in doctor["leave_dates"]:
            return "doctor_on_leave"
        weekday = WEEKDAYS[target.weekday()]
        if weekday == "Sun":
            return "sunday_closed"
        if not any(window["day"] == weekday for window in doctor["windows"]):
            return "doctor_not_working"
        return None

    def search_slots(self, arguments: dict[str, Any]) -> dict[str, Any]:
        doctor_id = arguments.get("doctor_id")
        doctor = self.doctor(doctor_id)
        target = _date(arguments.get("date"))
        band_name = arguments.get("window")
        if band_name is not None and band_name not in WINDOWS:
            raise ToolError("invalid_window", "window must be morning, afternoon, evening, or null")
        reason = self.closure_reason(doctor_id, target)
        if reason:
            return {"doctor_id": doctor_id, "date": target.isoformat(), "slots": [], "reason": reason}

        step = self.meta["slot_minutes"]
        booked = [
            (_minutes(appointment["start"]), _minutes(appointment["end"]))
            for appointment in self.appointments
            if appointment["doctor_id"] == doctor_id
            and appointment["date"] == target.isoformat()
            and appointment["status"] == "booked"
        ]
        band = WINDOWS.get(band_name) if band_name else None
        slots: dict[str, dict[str, str]] = {}
        weekday = WEEKDAYS[target.weekday()]
        for window in doctor["windows"]:
            if window["day"] != weekday:
                continue
            start_minute = _minutes(window["start"])
            end_minute = _minutes(window["end"])
            for start in range(start_minute, end_minute - step + 1, step):
                end = start + step
                if band and not band[0] <= start < band[1]:
                    continue
                if any(start < booked_end and end > booked_start for booked_start, booked_end in booked):
                    continue
                start_text = _clock(start)
                slots[start_text] = {"start": start_text, "end": _clock(end)}
        return {
            "doctor_id": doctor_id,
            "date": target.isoformat(),
            "slots": [slots[key] for key in sorted(slots)],
            "reason": None,
        }

    def book_appointment(self, arguments: dict[str, Any]) -> dict[str, Any]:
        patient_id = arguments.get("patient_id")
        if not isinstance(patient_id, str) or patient_id not in self.patients:
            raise ToolError("unknown_patient", f"patient_id {patient_id!r} is not in the patient directory")
        doctor_id = arguments.get("doctor_id")
        target = _date(arguments.get("date"))
        start = arguments.get("start")
        _minutes(start)
        with self._lock:
            available = self.search_slots({"doctor_id": doctor_id, "date": target.isoformat()})
            if available["reason"]:
                raise ToolError(available["reason"], f"{doctor_id} cannot be booked on {target.isoformat()}: {available['reason']}")
            slot = next((item for item in available["slots"] if item["start"] == start), None)
            if slot is None:
                raise ToolError("slot_unavailable", f"{start} on {target.isoformat()} is not a free slot for {doctor_id}")
            next_id = max((int(item["id"].removeprefix("ap_")) for item in self.appointments), default=0) + 1
            appointment = {
                "id": f"ap_{next_id:04d}",
                "patient_id": patient_id,
                "doctor_id": doctor_id,
                "date": target.isoformat(),
                "start": slot["start"],
                "end": slot["end"],
                "status": "booked",
            }
            self.appointments.append(appointment)
            return appointment

    def appointment(self, appointment_id: Any) -> dict[str, Any]:
        for appointment in self.appointments:
            if appointment["id"] == appointment_id:
                return appointment
        raise ToolError("unknown_appointment", f"appointment_id {appointment_id!r} was not found")

    def reschedule_appointment(self, arguments: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            appointment = self.appointment(arguments.get("appointment_id"))
            if appointment["status"] != "booked":
                raise ToolError("not_reschedulable", f"appointment {appointment['id']} is {appointment['status']}")
            target = _date(arguments.get("new_date"))
            start = arguments.get("new_start")
            _minutes(start)
            available = self.search_slots({"doctor_id": appointment["doctor_id"], "date": target.isoformat()})
            if available["reason"]:
                raise ToolError(available["reason"], f"doctor is unavailable on {target.isoformat()}: {available['reason']}")
            slot = next((item for item in available["slots"] if item["start"] == start), None)
            if slot is None:
                raise ToolError("slot_unavailable", f"{start} on {target.isoformat()} is not a free slot")
            appointment.update(date=target.isoformat(), start=slot["start"], end=slot["end"])
            return appointment

    def cancel_appointment(self, arguments: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            appointment = self.appointment(arguments.get("appointment_id"))
            if appointment["status"] != "booked":
                raise ToolError("not_cancellable", f"appointment {appointment['id']} is already {appointment['status']}")
            appointment["status"] = "cancelled"
            return appointment

    def lookup_patient(self, arguments: dict[str, Any]) -> dict[str, Any]:
        name = arguments.get("name") or ""
        phone = arguments.get("phone") or ""
        if not isinstance(name, str) or not isinstance(phone, str):
            raise ToolError("invalid_argument", "name and phone must be strings or null")
        if not name.strip() and not phone.strip():
            raise ToolError("missing_argument", "lookup_patient requires a name, a phone, or both")
        pool = list(self.patients.values())
        if phone:
            pool = [patient for patient in pool if patient["phone"] == phone.strip()]
        if name.strip():
            pool = self._match_patients(name, pool)
        if not pool:
            raise ToolError("patient_not_found", f"no patient matches {name.strip() or phone.strip()}")
        candidates = [
            {key: patient[key] for key in ("id", "name", "phone", "dob")}
            for patient in pool
        ]
        return {"status": "unique" if len(candidates) == 1 else "candidates", "candidates": candidates}

    def escalate_to_human(self, arguments: dict[str, Any]) -> dict[str, Any]:
        allowed = {"clinical_urgent", "medical_advice", "not_authorised", "ambiguous_patient", "out_of_scope"}
        reason = arguments.get("reason")
        if reason not in allowed:
            raise ToolError("invalid_reason", f"reason must be one of {', '.join(sorted(allowed))}")
        detail = arguments.get("detail")
        if detail is not None and not isinstance(detail, str):
            raise ToolError("invalid_argument", "detail must be a string or null")
        return {"handed_off": True, "reason": reason, "detail": detail}

    def find_appointments(self, patient_id: str, target_date: str | None = None) -> list[dict[str, Any]]:
        return sorted(
            (
                appointment
                for appointment in self.appointments
                if appointment["patient_id"] == patient_id
                and appointment["status"] == "booked"
                and (target_date is None or appointment["date"] == target_date)
            ),
            key=lambda appointment: (appointment["date"], appointment["start"]),
        )

    @staticmethod
    def _match_patients(query: str, pool: list[dict[str, Any]]) -> list[dict[str, Any]]:
        normalized = normalise(query)
        exact = [patient for patient in pool if normalise(patient["name"]) == normalized]
        if exact:
            return exact
        tokens = [token for token in normalized.split() if len(token) > 2 and token not in STOPWORDS]
        if not tokens:
            return []
        scored = []
        for patient in pool:
            name_tokens = set(normalise(patient["name"]).split())
            hits = sum(token in name_tokens for token in tokens)
            if hits:
                scored.append((patient, hits))
        if not scored:
            return []
        best = max(score for _, score in scored)
        return [patient for patient, score in scored if score == best]
