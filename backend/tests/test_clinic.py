import unittest

from backend.clinic import Clinic, ToolError


class ClinicToolTests(unittest.TestCase):
    def test_booking_uses_free_slot_and_rejects_duplicate(self):
        clinic = Clinic()
        appointment = clinic.book_appointment(
            {"patient_id": "pt_0001", "doctor_id": "dr_rao", "date": "2026-10-03", "start": "09:00"}
        )
        self.assertEqual(appointment["id"], "ap_0026")
        with self.assertRaisesRegex(ToolError, "not a free slot"):
            clinic.book_appointment(
                {"patient_id": "pt_0002", "doctor_id": "dr_rao", "date": "2026-10-03", "start": "09:00"}
            )

    def test_lookup_returns_all_ambiguous_candidates(self):
        result = Clinic().lookup_patient({"name": "Sharma"})
        self.assertEqual(result["status"], "candidates")
        self.assertEqual({item["id"] for item in result["candidates"]}, {"pt_0001", "pt_0002", "pt_0003"})

    def test_malformed_date_has_actionable_code(self):
        with self.assertRaisesRegex(ToolError, "real YYYY-MM-DD") as context:
            Clinic().search_slots({"doctor_id": "dr_rao", "date": "2026-02-30"})
        self.assertEqual(context.exception.code, "invalid_date")


if __name__ == "__main__":
    unittest.main()