import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from common.academic_intelligence_notifications import plan_intelligence_notifications, render_candidate, validated_links

OWNER = "f6000000-0000-4000-8000-000000000001"


class IntelligencePreparationTests(unittest.TestCase):
    def test_prepares_only_through_owner_scoped_rpc_without_a_sender(self):
        calls = []
        class Store:
            def request(self, method, table, query=None, body=None):
                calls.append((method, table, query, body))
                if table == "academic_intelligence_preferences": return [{"user_id": OWNER}]
                if table == "rpc/academic_intelligence_planning_candidates":
                    self.assert_owner = body["p_user_id"]
                    return [{"key": "grade:synthetic", "fingerprint": "a" * 64}]
                if table == "rpc/prepare_academic_intelligence_notification": return True
                raise AssertionError("unexpected operation")
        result = plan_intelligence_notifications(Store(), renderer=lambda c: {"message": "Synthetic", "links": []})
        self.assertEqual(result, {"queued": 1, "cancelled": 0, "failed": 0})
        self.assertEqual(calls[-1][3]["p_user_id"], OWNER)
        self.assertFalse(any("send" in table for _, table, _, _ in calls))

    def test_render_failure_never_commits_a_prepared_job(self):
        calls = []
        class Store:
            def request(self, method, table, query=None, body=None):
                calls.append(table)
                return [{"user_id": OWNER}] if table == "academic_intelligence_preferences" else [{"key": "grade:synthetic"}]
        def failed(_): raise ValueError("unavailable")
        self.assertEqual(plan_intelligence_notifications(Store(), renderer=failed)["failed"], 1)
        self.assertNotIn("rpc/prepare_academic_intelligence_notification", calls)

    def test_closed_links_allow_only_actual_fixed_origins_and_supported_navigation(self):
        markup = validated_links([{"text": "Study", "url": "https://lifeos.zalewko.me/tma/?screen=study&courseId=f1000000-0000-4000-8000-000000000001&studyTab=grades"}])
        self.assertEqual(len(markup["inline_keyboard"]), 1)
        for url in ("https://evil.example/", "javascript:alert(1)", "https://lms.astanait.edu.kz/mod/quiz/view.php?id=1&redirect=evil"):
            with self.subTest(url=url), self.assertRaises(ValueError): validated_links([{"text": "Open", "url": url}])

    def test_node_bridge_uses_stdin_memory_timeout_and_no_secret_environment(self):
        candidate = {"kind": "grade", "events": [{"itemTitle": "$(must remain data)"}]}
        result = SimpleNamespace(returncode=0, stdout=json.dumps({"message": "Synthetic", "links": []}).encode())
        with patch("common.academic_intelligence_notifications.subprocess.run", return_value=result) as run:
            self.assertEqual(render_candidate(candidate), {"message": "Synthetic", "links": []})
        args, kwargs = run.call_args
        self.assertEqual(args[0][:4], ["/usr/bin/node", "--max-old-space-size=128", "--import", "tsx"])
        self.assertNotIn("$(must remain data)", repr(args[0]))
        self.assertIn(b"$(must remain data)", kwargs["input"])
        self.assertLessEqual(kwargs["timeout"], 15)
        self.assertEqual(set(kwargs["env"]), {"PATH", "LANG", "NODE_ENV"})
        self.assertNotIn("shell", kwargs)

    def test_invalid_owner_or_unbounded_owner_limit_fails_closed(self):
        for limit in (0, 1001, True):
            with self.subTest(limit=limit), self.assertRaises(ValueError): plan_intelligence_notifications(None, owner_limit=limit)
        class Store:
            def request(self, *args, **kwargs): return [{"user_id": "caller-controlled"}]
        with self.assertRaises(ValueError): plan_intelligence_notifications(Store())


if __name__ == "__main__":
    unittest.main()
