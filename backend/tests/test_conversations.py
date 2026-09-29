import json
import unittest
from pathlib import Path

from backend.agent import run_conversation


ROOT = Path(__file__).resolve().parents[2]


class ConversationContractTests(unittest.TestCase):
    def test_all_supplied_scripts_match_expected_safety_and_tool_constraints(self):
        paths = sorted((ROOT / "conversations").glob("*.json")) + sorted((ROOT / "adversarial").glob("*.json"))
        self.assertEqual(len(paths), 23)
        for path in paths:
            with self.subTest(script=path.name):
                script = json.loads(path.read_text(encoding="utf-8"))
                result = run_conversation(script["id"], script["today"], script["turns"])
                expected = script["expected"]
                names = {call["name"] for call in result["tool_calls"]}
                self.assertEqual(result["terminal_state"], expected["terminal_state"])
                self.assertEqual(result["escalation_reason"], expected["escalation_reason"])
                self.assertTrue(set(expected["must_call"]).issubset(names))
                self.assertFalse(set(expected["must_not_call"]) & names)

    def test_emergency_preempts_booking_without_searching(self):
        result = run_conversation(
            "urgent-check",
            "2026-10-01",
            ["Dr. Rao ke saath kal subah appointment chahiye", "Abhi chest pain aur shortness of breath ho rahi hai"],
        )
        self.assertEqual(result["terminal_state"], "escalated")
        self.assertEqual(result["escalation_reason"], "clinical_urgent")
        self.assertEqual([call["name"] for call in result["tool_calls"]], ["escalate_to_human"])

    def test_each_request_starts_from_original_appointments(self):
        request = ("isolated", "2026-10-01", ["Dr. Rao ke saath Saturday appointment chahiye", "Harpreet Singh 9812200311"])
        first = run_conversation(*request)
        second = run_conversation(*request)
        self.assertEqual(first["appointment_id"], second["appointment_id"])
        self.assertEqual(first["tool_calls"], second["tool_calls"])


if __name__ == "__main__":
    unittest.main()