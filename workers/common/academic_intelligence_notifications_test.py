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
                return [{"user_id": OWNER}] if table == "academic_intelligence_preferences" else [{"key": "grade:synthetic", "fingerprint": "a" * 64}]
        def failed(_): raise ValueError("unavailable")
        self.assertEqual(plan_intelligence_notifications(Store(), renderer=failed)["failed"], 1)
        self.assertNotIn("rpc/prepare_academic_intelligence_notification", calls)

    def test_one_render_or_prepare_failure_does_not_hide_later_groups_and_retries_resume(self):
        for failure in ("render", "prepare"):
            with self.subTest(failure=failure):
                class Store:
                    def __init__(self): self.bound = set(); self.fail = True
                    def request(self, method, table, query=None, body=None):
                        if table == "academic_intelligence_preferences": return [{"user_id": OWNER}]
                        if table == "rpc/academic_intelligence_planning_candidates":
                            return [{"key": key, "fingerprint": "a" * 64} for key in ("grade:first", "grade:second") if key not in self.bound]
                        if table == "rpc/prepare_academic_intelligence_notification":
                            if failure == "prepare" and self.fail and body["p_key"] == "grade:first": raise TimeoutError("synthetic uncertain acknowledgement")
                            self.bound.add(body["p_key"]); return True
                        raise AssertionError("unexpected operation")
                store = Store()
                def render(candidate):
                    if failure == "render" and store.fail and candidate["key"] == "grade:first": raise ValueError("synthetic renderer failure")
                    return {"message": "Synthetic", "links": []}
                self.assertEqual(plan_intelligence_notifications(store, renderer=render), {"queued": 1, "cancelled": 0, "failed": 1})
                self.assertEqual(store.bound, {"grade:second"})
                store.fail = False
                self.assertEqual(plan_intelligence_notifications(store, renderer=render), {"queued": 1, "cancelled": 0, "failed": 0})
                self.assertEqual(store.bound, {"grade:first", "grade:second"})
                self.assertEqual(plan_intelligence_notifications(store, renderer=render)["queued"], 0)

    def test_owner_pagination_and_bounded_group_failures_keep_owner_scope(self):
        owners = [f"f6000000-0000-4000-8000-{i:012d}" for i in range(1, 103)]
        seen = []
        pages = []
        class Store:
            def request(self, method, table, query=None, body=None):
                if table == "academic_intelligence_preferences":
                    after = (query.get("user_id") or "gt.")[3:]
                    rows = [owner for owner in owners if owner > after][:int(query["limit"])]
                    pages.append((after, len(rows)))
                    return [{"user_id": owner} for owner in rows]
                if table == "rpc/academic_intelligence_planning_candidates":
                    seen.append(body["p_user_id"])
                    return []
                raise AssertionError("unexpected write")
        self.assertEqual(plan_intelligence_notifications(Store(), owner_limit=102), {"queued": 0, "cancelled": 0, "failed": 0})
        self.assertEqual(seen, owners)
        self.assertEqual(pages, [("", 100), (owners[99], 2)])

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
