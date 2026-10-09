from __future__ import annotations

from copy import deepcopy
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest


SPEC = importlib.util.spec_from_file_location("import_study_dashboard", Path(__file__).with_name("import_study_dashboard.py"))
importer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(importer)


def fixture_html() -> str:
    """Structural fixture with invented labels, rooms and teachers; no user HTML."""
    field_sets = {
        "os": (["a1", "a2", "a3", "a4", "mid"], ["a5", "a6", "a7", "a8", "end"], [20, 20, 20, 20, 20]),
        "dms": (["a1", "a2", "a3", "q1", "mid"], ["a4", "a5", "a6", "q2", "end"], [20, 20, 20, 10, 30]),
        "krl": (["a1", "mid"], ["a2", "end"], [60, 40]),
        "cnc": (["p1", "mid"], ["p2", "end"], [60, 40]),
        "dld": (["p1", "mid"], ["p2", "end"], [60, 40]),
    }
    formulas = ["const finalScore = (att1 * 0.3) + (att2 * 0.3) + (exam * 0.4);", "if (att1 < 25 || att2 < 25) {}"]
    rows = []
    for prefix, (first, second, weights) in field_sets.items():
        for number, fields in ((1, first), (2, second)):
            terms = [f"(getVal('{prefix}-{suffix}') * {weight / 100:.2f})" for suffix, weight in zip(fields, weights)]
            formulas.append(f"const {prefix}Att{number} = " + " + ".join(terms) + ";")
            for suffix in fields:
                rows.append(f'<tr><td>Example {suffix}</td><td><input type="number" id="{prefix}-{suffix}"></td></tr>')
        rows.append(f'<tr><td>Example exam</td><td><input type="number" id="{prefix}-exam"></td></tr>')
    timetable_rows = []
    for index, (_prefix, (_code, display_code)) in enumerate(importer.COURSES.items()):
        for slot, (day, start) in enumerate((("Понедельник", "08:00"), ("Вторник", "08:00"), ("Среда", "08:00"), ("Четверг", "17:00"), ("Пятница", "14:00"))):
            timetable_rows.append(f'<tr class="day-header"><td colspan="6">{day}</td></tr>')
            timetable_rows.append(f'<tr><td></td><td>{start} – {start[:3]}50</td><td><span class="badge">{display_code}</span></td><td>Практика</td><td>Example Teacher {index}</td><td>Example Room {slot}</td></tr>')
    return "<html><table>" + "".join(timetable_rows) + "</table><table>" + "".join(rows) + "</table><script>" + "\n".join(formulas) + "</script></html>"


class FakeDB:
    def __init__(self, imported, with_schedules=True):
        self.settings = SimpleNamespace(user_id="user-a")
        self.calls = []
        self.courses = [{"id": f"course-{index}", "user_id": "user-a", "code": code,
                         "status": "active", "metadata": {"keep": "existing"}, "external_course_key": f"moodle:{index}"}
                        for index, code in enumerate(imported)]
        self.courses.append({"id": "other-user-course", "user_id": "user-b", "code": "OS52-EN", "status": "active", "metadata": {}})
        self.schemes = []
        self.schedules = []
        if with_schedules:
            for course in self.courses[:-1]:
                for index, slot in enumerate(imported[course["code"]]["schedules"]):
                    self.schedules.append({**deepcopy(slot), "id": f"{course['id']}-slot-{index}", "study_course_id": course["id"], "updated_at": "2026-01-01T00:00:00Z"})

    def request(self, method, table, query=None, body=None, prefer=None):
        query = query or {}
        self.calls.append((method, table, deepcopy(query), deepcopy(body)))
        rows = self.courses if table == "study_courses" else self.schemes if table == "grading_schemes" else self.schedules

        def matches(row):
            for key, expression in query.items():
                if key == "select":
                    continue
                if expression == "is.null":
                    if row.get(key) is not None:
                        return False
                elif expression.startswith("eq."):
                    expected = json.loads(expression[3:]) if key == "metadata" else expression[3:]
                    if row.get(key) != expected:
                        return False
                else:
                    raise AssertionError("Unexpected query")
            return True

        matching = [row for row in rows if matches(row)]
        if method == "GET":
            return deepcopy(matching)
        if method == "PATCH":
            for row in matching:
                row.update(deepcopy(body))
            return deepcopy(matching)
        if method == "POST":
            created = {"id": f"created-{len(rows)}", **deepcopy(body)}
            rows.append(created)
            return [deepcopy(created)]
        raise AssertionError("Importer must never delete timetable rows")


class StudyDashboardImportTest(unittest.TestCase):
    def setUp(self):
        self.html = fixture_html()
        self.imported = importer.parse_dashboard(self.html, "schedule.html")

    def test_all_five_profiles_and_25_slots(self):
        self.assertEqual(len(self.imported), 5)
        self.assertEqual(sum(len(item["schedules"]) for item in self.imported.values()), 25)
        expected = {"OS52-EN": [20, 20, 20, 20, 20], "DMS52-EN": [20, 20, 20, 10, 30],
                    "K(RUSSIAN)L51-RU": [60, 40], "CNC53-EN": [60, 40], "DLD52-EN": [60, 40]}
        for code, weights in expected.items():
            profile = self.imported[code]["definition"]
            self.assertEqual(profile["attestationThreshold"], 25)
            self.assertEqual(profile["verification"], "needs_review")
            self.assertTrue(all(field["verification"] == "needs_review" for field in profile["fields"]))
            for period in ("att1", "att2"):
                self.assertEqual([field["weightPercent"] for field in profile["fields"] if field["period"] == period], weights)
            self.assertEqual([field["weightPercent"] for field in profile["fields"] if field["period"] == "exam"], [100])

    def test_never_executes_script_and_rejects_unrecognized_formula(self):
        with self.assertRaises(importer.StudyImportError):
            importer.parse_dashboard(self.html.replace("getVal('os-a1')", "dangerousCall('os-a1')"), "schedule.html")

    def test_rejects_changed_final_formula_duplicate_inputs_and_incomplete_schedule(self):
        changes = [self.html.replace("exam * 0.4", "exam * 0.5"),
                   self.html.replace('id="os-a2"', 'id="os-a1"'),
                   self.html.replace("CNC 2305", "UNSUPPORTED COURSE")]
        for value in changes:
            with self.subTest(value=value[:50]), self.assertRaises(importer.StudyImportError):
                importer.parse_dashboard(value, "schedule.html")

    def test_dry_run_never_writes_and_only_reads_owned_courses(self):
        db = FakeDB(self.imported)
        plan = importer.build_plan(db, self.imported)
        self.assertEqual(len(plan), 5)
        self.assertTrue(all(call[0] == "GET" for call in db.calls))
        self.assertEqual(db.calls[0][2]["user_id"], "eq.user-a")
        self.assertTrue(all(call[2].get("study_course_id", "") != "eq.other-user-course" for call in db.calls))

    def test_insert_into_empty_timetable_then_rerun_is_idempotent(self):
        db = FakeDB(self.imported, with_schedules=False)
        plan = importer.build_plan(db, self.imported)
        importer.apply_plan(db, plan)
        self.assertEqual(len(db.schedules), 25)
        second = importer.build_plan(db, self.imported)
        self.assertTrue(all(not item["candidate_created"] and not item["profile_changed"] and not item["operations"] for item in second))
        call_count = len(db.calls)
        importer.apply_plan(db, second)
        self.assertEqual(len(db.calls), call_count)

    def test_does_not_implicitly_change_rooms_teachers_or_move_slots(self):
        for field, value in (("room", "Other Room"), ("instructor_name", "Other Teacher"), ("start_time", "21:00")):
            db = FakeDB(self.imported)
            db.schedules[0][field] = value
            with self.subTest(field=field), self.assertRaises(importer.StudyImportError):
                importer.build_plan(db, self.imported)
            self.assertTrue(all(call[0] == "GET" for call in db.calls))
        self.assertEqual(importer.KNOWN_MOVES, {})

    def test_only_explicit_exact_corrections_can_update_an_existing_slot(self):
        db = FakeDB(self.imported)
        course = db.courses[0]
        slot = db.schedules[0]
        desired = importer.normalized_schedule(slot)
        slot.update({"day_of_week": "saturday", "start_time": "18:00", "end_time": "18:50", "room": "Old Room", "instructor_name": "Old Teacher"})
        corrections = {course["code"]: [{"from": importer.normalized_schedule(slot), "to": desired}]}
        plan = importer.build_plan(db, self.imported, corrections)
        self.assertEqual(sum(len(item["operations"]) for item in plan), 1)
        slot_id = slot["id"]
        importer.apply_plan(db, plan)
        self.assertEqual(slot["id"], slot_id)
        self.assertEqual(importer.normalized_schedule(slot), desired)
        self.assertEqual(len(db.schedules), 25)

    def test_mismatched_correction_aborts_without_any_write(self):
        db = FakeDB(self.imported)
        slot = db.schedules[0]
        desired = importer.normalized_schedule(slot)
        slot["room"] = "Changed Room"
        corrections = {db.courses[0]["code"]: [{"from": {**importer.normalized_schedule(slot), "room": "Another Room"}, "to": desired}]}
        with self.assertRaises(importer.StudyImportError):
            importer.build_plan(db, self.imported, corrections)
        self.assertTrue(all(call[0] == "GET" for call in db.calls))

    def test_unexpected_extra_or_ambiguous_rows_abort_before_any_write(self):
        for duplicate in (False, True):
            db = FakeDB(self.imported)
            extra = deepcopy(db.schedules[-1])
            extra["id"] = "manual-slot"
            if not duplicate:
                extra["start_time"] = "21:00"
            db.schedules.append(extra)
            with self.assertRaises(importer.StudyImportError):
                importer.build_plan(db, self.imported)
            self.assertTrue(all(call[0] == "GET" for call in db.calls))
            self.assertIn(extra, db.schedules)

    def test_preserves_saved_zero_unknown_target_metadata_and_moodle_links(self):
        db = FakeDB(self.imported)
        course = db.courses[0]
        course["metadata"][importer.PROFILE_KEY] = {"definition": {}, "values": {"os-a1": 0, "os-a2": None}, "target": 85}
        importer.apply_plan(db, importer.build_plan(db, self.imported))
        profile = course["metadata"][importer.PROFILE_KEY]
        self.assertEqual(profile["values"], {"os-a1": 0, "os-a2": None})
        self.assertEqual(profile["target"], 85)
        self.assertEqual(course["metadata"]["keep"], "existing")
        self.assertEqual(course["external_course_key"], "moodle:0")
        self.assertNotIn(importer.PROFILE_KEY, db.courses[-1]["metadata"])
        self.assertEqual(profile["definition"], {})
        self.assertEqual(len(db.schemes), 5)
        self.assertTrue(all(row["is_active"] is False and row["verification"] == "needs_review" for row in db.schemes))

    def test_preserves_custom_unrecognized_and_raw_point_saved_values(self):
        db = FakeDB(self.imported)
        state = {"definition": {"custom": True}, "values": {"manual-score": 20, "custom-score": {"earned": 15, "max": 30, "kind": "actual", "source": "manual_confirmed"}}, "target": 70}
        db.courses[0]["metadata"][importer.PROFILE_KEY] = deepcopy(state)
        importer.apply_plan(db, importer.build_plan(db, self.imported))
        self.assertEqual(db.courses[0]["metadata"][importer.PROFILE_KEY], state)
        self.assertFalse(any(call[1] == "study_courses" and call[0] != "GET" for call in db.calls))

    def test_concurrent_user_metadata_is_untouched(self):
        db = FakeDB(self.imported)
        plan = importer.build_plan(db, self.imported)
        db.courses[0]["metadata"]["new-user-setting"] = "retain"
        importer.apply_plan(db, plan)
        self.assertEqual(db.courses[0]["metadata"]["new-user-setting"], "retain")
        self.assertNotIn(importer.PROFILE_KEY, db.courses[0]["metadata"])

    def test_refuses_cross_user_plans(self):
        db = FakeDB(self.imported)
        plan = importer.build_plan(db, self.imported)
        db.settings.user_id = "user-b"
        with self.assertRaises(importer.StudyImportError):
            importer.apply_plan(db, plan)
        self.assertTrue(all(call[0] == "GET" for call in db.calls))

    def test_missing_or_ambiguous_owned_course_aborts_whole_plan(self):
        for duplicate in (False, True):
            db = FakeDB(self.imported)
            if duplicate:
                copied = deepcopy(db.courses[0])
                copied["id"] = "ambiguous-owned-course"
                db.courses.append(copied)
            else:
                db.courses[4]["status"] = "archived"
            with self.assertRaises(importer.StudyImportError):
                importer.build_plan(db, self.imported)
            self.assertTrue(all(call[0] == "GET" for call in db.calls))

    def test_parses_a_generic_mapped_course_with_no_fixed_course_or_slot_count(self):
        html = """<table><tr class="day-header"><td>Понедельник</td></tr>
        <tr><td></td><td>09:00–09:50</td><td><span class="badge">EX101</span></td><td>Лекция</td><td>Example Teacher</td><td>Онлайн</td></tr></table>
        <table><tr><td>Essay</td><td><input type="number" id="abc-a"></td></tr>
        <tr><td>Project</td><td><input type="number" id="abc-b"></td></tr>
        <tr><td>Final</td><td><input type="number" id="abc-exam"></td></tr></table>
        <script>const abcAtt1=(getVal('abc-a') * 1); const abcAtt2=(getVal('abc-b') * 1);
        const finalScore=(att1 * 0.3) + (att2 * 0.3) + (exam * 0.4); if(att1 < 25 || att2 < 25) {}</script>"""
        parsed = importer.parse_dashboard(html, "generic.html", {"abc": ("EX-101", "EX101")})
        self.assertEqual(list(parsed), ["EX-101"])
        self.assertEqual(len(parsed["EX-101"]["schedules"]), 1)
        self.assertEqual(parsed["EX-101"]["definition"]["fields"][0]["label"], "Essay")
        self.assertEqual(parsed["EX-101"]["definition"]["verification"], "needs_review")

    def test_legacy_network_formula_is_never_active_or_applied_over_custom_scheme(self):
        db = FakeDB(self.imported)
        db.schemes.append({"id": "active-original", "user_id": "user-a", "study_course_id": db.courses[0]["id"], "definition": {"verified": True}, "version": 4, "is_active": True})
        importer.apply_plan(db, importer.build_plan(db, self.imported))
        self.assertEqual(db.schemes[0]["is_active"], True)
        candidates = [row for row in db.schemes if row["id"] != "active-original"]
        self.assertTrue(all(row["is_active"] is False and row["verification"] == "needs_review" for row in candidates))



if __name__ == "__main__":
    unittest.main()
