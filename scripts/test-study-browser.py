#!/usr/bin/env python3
"""Mobile UI checks against isolated built TMA with intercepted test accounts.

Usage: python scripts/test-study-browser.py http://127.0.0.1:55492/tma/
Requires playwright + Chromium. API/RLS are independently tested by TS/SQL.
"""
import copy
import hashlib
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import unquote, urlsplit

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
COURSE = "11111111-1111-4111-8111-111111111111"
ASSIGNMENT = "22222222-2222-4222-8222-222222222222"
SCHEME = "33333333-3333-4333-8333-333333333333"
DOCUMENT = "44444444-4444-4444-8444-444444444444"
LEGACY_DOCUMENT = "55555555-5555-4555-8555-555555555555"
STORAGE_DOCUMENT = "66666666-6666-4666-8666-666666666666"
def fixture_pdf(label):
    """A valid one-page PDF so Chromium can exercise its actual PDF viewer."""
    stream = b"q Q\n%" + label.encode("ascii") + b"\n"
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>",
               b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
               b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R >>",
               b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"endstream"]
    result = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
    offsets = []
    for number, obj in enumerate(objects, 1):
        offsets.append(len(result))
        result += f"{number} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(result)
    result += b"xref\n0 5\n0000000000 65535 f \n"
    result += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets)
    return result + f"trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()


PDF_BYTES = fixture_pdf("legacy original fixture")
STORAGE_PDF_BYTES = fixture_pdf("private storage fixture")
UPLOAD_PDF_BYTES = fixture_pdf("new version fixture")
now = datetime.now(timezone.utc)
iso = now.isoformat()
due = (now + timedelta(days=1)).isoformat()
overdue = (now - timedelta(days=1)).isoformat()
manual_due_local = (now + timedelta(days=2, hours=5)).strftime("%Y-%m-%dT%H:%M")
weekday = (now + timedelta(hours=5)).strftime("%A").lower()
definition = json.loads((ROOT / "docs/syllabi/grading-seeds.json").read_text())[0]["definition"]


def workspace(account):
    return {
        "timezone": "Asia/Almaty", "records": [],
        "courses": [{"id": COURSE, "code": "DMS52-EN", "title": f"Database · Account {account}",
            "startsOn": None, "endsOn": None, "externalCourseKey": "moodle:fixture", "instructorName": "Преподаватель",
            "calculator": {"definition": copy.deepcopy(definition), "values": {}, "target": 70}, "actualValues": {},
            "documents": ([
                {"id": LEGACY_DOCUMENT, "fileName": "legacy-original.pdf", "version": 1,
                 "sha256": hashlib.sha256(PDF_BYTES).hexdigest(), "extractionStatus": "verified",
                 "sourcePages": [2], "uploadedAt": iso, "available": True,
                 "notes": ["Fixture: ранее сохранённый оригинал"]},
                {"id": STORAGE_DOCUMENT, "fileName": "storage-original.pdf", "version": 2,
                 "sha256": hashlib.sha256(STORAGE_PDF_BYTES).hexdigest(), "extractionStatus": "verified",
                 "sourcePages": [7, 8], "uploadedAt": iso, "available": True,
                 "notes": ["Fixture: оригинал в приватном хранилище"]},
            ] if account == "A" else []), "gradingSchemes": [],
            "schedules": [{"id": "online", "dayOfWeek": weekday, "startTime": "08:00", "endTime": "08:50", "room": "Online", "sessionType": "lecture", "instructorName": None},
                          {"id": "campus", "dayOfWeek": weekday, "startTime": "10:00", "endTime": "10:50", "room": "C1.2.223", "sessionType": "lab", "instructorName": "Преподаватель"}]}],
        "assignments": [],
        "deadlines": ([
            {"id": "fixture-upcoming", "title": "Moodle upcoming deadline", "courseTitle": f"Database · Account {account}",
             "dueAt": due, "status": "pending", "source": "university", "sourceUrl": "https://moodle.example.test/mod/assign/view.php?id=1"},
            {"id": "fixture-overdue", "title": "Moodle overdue deadline", "courseTitle": f"Database · Account {account}",
             "dueAt": overdue, "status": "pending", "source": "university", "sourceUrl": None},
        ] if account == "A" else []), "sources": [],
        "sync": {"updatedAt": iso, "status": "connected", "message": "Проверочный снимок источника"},
    }


def main(url, test_tabs=True):
    if urlsplit(url).hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError("Browser fixture may only target loopback, never production")
    states = {"fixture-A": workspace("A"), "fixture-B": workspace("B")}
    mutations = []
    downloads = []
    errors = []
    fail_next = {"upload": False, "download": False}
    with sync_playwright() as p:
        # The default headless shell cannot display PDFs; the Chromium channel
        # uses the full browser and its PDF viewer in modern headless mode.
        browser = p.chromium.launch(headless=True, channel="chromium")
        context = browser.new_context(viewport={"width": 390, "height": 844}, reduced_motion="reduce")
        # The bundled Telegram SDK replaces WebApp at startup. Intercept that
        # assignment so the real SDK runs, while loopback-only fixtures control
        # its identity and can exercise an in-place account change.
        context.add_init_script("""
            window.__studyFixtureIdentity = 'fixture-A';
            window.Telegram = {};
            let webApp;
            Object.defineProperty(window.Telegram, 'WebApp', {
                configurable: true,
                get() { return webApp; },
                set(native) {
                    webApp = new Proxy(native, {
                        get(target, key) {
                            return key === 'initData'
                                ? window.__studyFixtureIdentity
                                : Reflect.get(target, key);
                        }
                    });
                }
            });
        """)
        expect.set_options(timeout=15000)
        page = context.new_page()
        page.set_default_timeout(60000)
        page.on("pageerror", lambda error: errors.append(str(error)))
        # Avoid depending on the external map server during isolated tests.
        context.route("https://yuujiso.github.io/**", lambda route: route.fulfill(status=200, content_type="text/html", body="<p>Map fixture</p>"))

        def api(route):
            request = route.request
            owner = request.headers.get("x-telegram-init-data", "")
            if owner not in states:
                route.fulfill(status=401, json={"error": "invalid_telegram_init_data"})
                return
            data = states[owner]
            path = urlsplit(request.url).path
            is_pdf = request.headers.get("content-type", "").split(";")[0] == "application/pdf"
            if is_pdf:
                raw_pdf = request.post_data_buffer
                assert raw_pdf == UPLOAD_PDF_BYTES, "Raw upload bytes changed in transport"
                body = {"fileName": unquote(request.headers.get("x-study-file-name", "")),
                        "sha256": hashlib.sha256(raw_pdf).hexdigest()}
            else:
                body = request.post_data_json if request.post_data else {}
            result = None
            if path == "/api/tma/session":
                result = {"state": "active", "telegramUserId": 901 if owner.endswith("A") else 902,
                    "profile": {"status": "active", "role": "user"}, "displayName": owner,
                    "integrations": {"telegram": {"connected": True}, "obsidian": {"connected": False}, "google": {"connected": False}, "health": {"connected": False}}}
            elif path == "/api/tma/study" and request.method == "GET":
                result = data
            elif re.fullmatch(r"/api/tma/study/documents/[^/]+/download", path) and request.method == "GET":
                if fail_next["download"]:
                    fail_next["download"] = False
                    route.fulfill(status=400, json={"error": "study_pdf_download_failed"})
                    return
                document_id = path.split("/")[-2]
                document = next((item for item in data["courses"][0]["documents"] if item["id"] == document_id), None)
                if document is None:
                    route.fulfill(status=404, json={"error": "study_document_not_found"})
                    return
                downloads.append((owner, document_id))
                pdf_bytes = PDF_BYTES if document_id == LEGACY_DOCUMENT else STORAGE_PDF_BYTES if document_id == STORAGE_DOCUMENT else UPLOAD_PDF_BYTES
                route.fulfill(status=200, content_type="application/pdf", body=pdf_bytes,
                              headers={"cache-control": "private, no-store", "content-disposition": f'attachment; filename="{document["fileName"]}"'})
                return
            elif path.endswith("/calculator"):
                data["courses"][0]["calculator"].update(body)
                result = data["courses"][0]["calculator"]
            elif path.endswith("/grade-override"):
                item = next(item for item in data["assignments"] if item["id"] == path.split("/")[-2])
                item["override"] = None if body.get("earned") is None else copy.deepcopy(body)
                result = {"saved": True}
            elif path == "/api/tma/study/assignments" or path.endswith(ASSIGNMENT):
                item = {"id": ASSIGNMENT, "studyCourseId": COURSE, "courseTitle": data["courses"][0]["title"],
                    "courseCode": "DMS52-EN", "title": body["title"], "assessmentType": body.get("assessmentType"),
                    "actualScore": None, "maxScore": body.get("maxScore"), "effectiveScore": None, "effectiveMax": body.get("maxScore"),
                    "source": "manual", "editable": True, "externalId": None, "sourceUrl": body.get("sourceUrl"),
                    "dueAt": body.get("dueAt"), "status": body.get("status", "pending"), "notes": body.get("notes"), "updatedAt": iso}
                data["assignments"] = [item]
                data["deadlines"] = [entry for entry in data["deadlines"] if entry.get("assessmentId") != ASSIGNMENT]
                if item["dueAt"]:
                    data["deadlines"].append({"id": f"assessment:{ASSIGNMENT}", "title": item["title"],
                                             "courseTitle": item["courseTitle"], "courseId": COURSE, "dueAt": item["dueAt"],
                                             "status": item["status"], "source": "manual", "assessmentId": ASSIGNMENT})
                result = item
            elif path.endswith("/documents"):
                if fail_next["upload"]:
                    fail_next["upload"] = False
                    route.fulfill(status=400, json={"error": "study_pdf_upload_create_failed"})
                    return
                documents = data["courses"][0]["documents"]
                result = next((item for item in documents if item.get("sha256") == body.get("sha256")), None)
                if result is None:
                    result = {"id": DOCUMENT, "fileName": body["fileName"], "version": max((item["version"] for item in documents), default=0) + 1,
                              "sha256": body["sha256"], "extractionStatus": "needs_review", "sourcePages": [], "uploadedAt": iso, "available": True}
                    documents.append(result)
            elif path.endswith("/schemes"):
                result = {"id": SCHEME, "version": 1, "definition": body["definition"], "verification": "needs_review", "isActive": False, "documentId": body.get("documentId"), "createdAt": iso}
                data["courses"][0]["gradingSchemes"].append(result)
            elif path.endswith("/activate"):
                result = data["courses"][0]["gradingSchemes"][0]
                result.update({"isActive": True, "verification": "user_confirmed"})
                data["courses"][0]["calculator"]["definition"] = result["definition"]
            else:
                route.fulfill(status=404, json={"error": "fixture_unknown_route"})
                return
            if request.method != "GET":
                mutations.append((path, body))
            route.fulfill(status=200, json={"data": copy.deepcopy(result)})

        context.route("**/api/tma/**", api)
        for width in ((320, 390) if test_tabs else ()):
            page.set_viewport_size({"width": width, "height": 844})
            for tab in ("today", "courses", "assignments", "deadlines", "schedule", "grades", "calculator", "syllabi", "map"):
                page.goto(f"{url}?screen=study&studyTab={tab}")
                expect(page.get_by_role("heading", name="Учёба", exact=True)).to_be_visible()
                expect(page.locator(f"#study-tab-{tab}")).to_have_attribute("aria-selected", "true")
                page.reload()
                expect(page.locator(f"#study-tab-{tab}")).to_have_attribute("aria-selected", "true")
                assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), f"Overflow {width}/{tab}"
                page.goto(f"{url}?tgWebAppStartParam=study_{tab}")
                expect(page.locator(f"#study-tab-{tab}")).to_have_attribute("aria-selected", "true")
                page.reload()
                expect(page.locator(f"#study-tab-{tab}")).to_have_attribute("aria-selected", "true")
            print(f"OK {width}px: nine direct/Telegram links and reload, no horizontal overflow", flush=True)

        page.goto(f"{url}?screen=study&studyTab=today")
        expect(page.get_by_text("08:00 · Database · Account A", exact=True)).to_be_visible()
        expect(page.get_by_text("10:00 · Database · Account A", exact=True)).to_be_visible()
        expect(page.get_by_text("Moodle upcoming deadline", exact=True)).to_be_visible()
        page.screenshot(path="/tmp/lifeos-study-today.png", full_page=True)
        page.get_by_role("tab", name="Расписание", exact=True).click()
        expect(page.get_by_text("08:00–08:50", exact=True)).to_be_visible()
        expect(page.get_by_text("10:00–10:50", exact=True)).to_be_visible()
        expect(page.get_by_text("Аудитория C1.2.223", exact=True)).to_be_visible()
        expect(page.get_by_text("Преподаватель", exact=True)).to_be_visible()
        page.get_by_role("tab", name="Дедлайны", exact=True).click()
        expect(page.get_by_text("Moodle upcoming deadline", exact=True)).to_be_visible()
        expect(page.get_by_text("Moodle overdue deadline", exact=True)).to_be_visible()
        page.get_by_role("button", name="Просрочено", exact=True).click()
        expect(page.get_by_text("Moodle overdue deadline", exact=True)).to_be_visible()
        expect(page.get_by_text("Moodle upcoming deadline", exact=True)).to_have_count(0)
        page.get_by_role("button", name="Неделя", exact=True).click()
        expect(page.get_by_text("Moodle upcoming deadline", exact=True)).to_be_visible()
        expect(page.get_by_text("Moodle overdue deadline", exact=True)).to_have_count(0)
        print("OK personal schedule, first online/physical pairs, upcoming/overdue deadline filters", flush=True)
        page.get_by_role("tab", name="Задания", exact=True).click()
        page.get_by_role("button", name="Создать задание").click()
        page.get_by_label("Название", exact=True).fill("Browser assignment")
        page.get_by_label("Максимум баллов", exact=True).fill("30")
        page.get_by_label("Срок (Asia/Almaty)", exact=True).fill(manual_due_local)
        page.get_by_role("button", name="Сохранить", exact=True).click()
        expect(page.get_by_text("Browser assignment", exact=True)).to_be_visible()
        page.get_by_text("Browser assignment", exact=True).click()
        page.get_by_role("button", name="Редактировать", exact=True).click()
        page.get_by_label("Название", exact=True).fill("Browser edited")
        page.get_by_role("button", name="Сохранить", exact=True).click()
        page.reload()
        expect(page.get_by_text("Browser edited", exact=True)).to_be_visible()
        page.get_by_role("tab", name="Дедлайны", exact=True).click()
        expect(page.get_by_text("Browser edited", exact=True)).to_be_visible()
        assert states["fixture-A"]["assignments"][0]["dueAt"].endswith("Z"), "Manual deadline must persist as UTC"
        print("OK manual assignment create/edit persisted after reload", flush=True)

        page.get_by_role("tab", name="Оценки", exact=True).click()
        grade = page.locator("details").filter(has_text="Browser edited")
        grade.locator("summary").click()
        expect(grade.get_by_text("Синхронизировано: Ещё не оценено", exact=True)).to_be_visible()
        grade.get_by_label("Browser edited: ручной балл", exact=True).fill("17")
        grade.get_by_label("Browser edited: ручной максимум", exact=True).fill("30")
        grade.get_by_role("button", name="Сохранить override", exact=True).click()
        expect(grade.locator("summary")).to_contain_text("17 / 30")
        page.reload()
        expect(grade.locator("summary")).to_contain_text("17 / 30")
        grade.locator("summary").click()
        expect(grade.get_by_label("Browser edited: ручной балл", exact=True)).to_have_value("17")
        assert states["fixture-A"]["assignments"][0]["actualScore"] is None, "Override must preserve the original source grade"
        grade.get_by_role("button", name="Использовать оценку источника", exact=True).click()
        expect(grade.locator("summary")).to_contain_text("Ещё не оценено")
        page.reload()
        expect(grade.locator("summary")).to_contain_text("Ещё не оценено")
        assert states["fixture-A"]["assignments"][0]["override"] is None
        print("OK grade override save/reload/remove preserves the source grade", flush=True)

        page.get_by_role("tab", name="Цель 70+", exact=True).click()
        for field in definition["fields"]:
            if field["period"] != "exam":
                group = page.get_by_role("group", name="Аттестация 1" if field["period"] == "att1" else "Аттестация 2", exact=True)
                group.get_by_label(f"{field['label']}: набрано", exact=True).fill("60" if field["period"] == "att1" else "80")
        page.get_by_label("Посещаемость, % (если известна)", exact=True).fill("100")
        expect(page.get_by_text("Нужно на экзамене:", exact=False)).to_contain_text("70 / 100")
        exam = next(field for field in definition["fields"] if field["period"] == "exam")
        page.get_by_label(f"{exam['label']}: максимум", exact=True).fill("30")
        page.get_by_label("Один выбранный компонент").select_option(exam["id"])
        page.get_by_role("checkbox", name=exam["label"], exact=True).check()
        page.get_by_label("Максимум, %", exact=True).fill("80")
        page.get_by_role("checkbox", name=exam["label"], exact=True).uncheck()
        expect(page.get_by_role("heading", name="Твой сценарий · цель 70")).to_be_visible()
        page.get_by_role("button", name="Сохранить сценарий", exact=True).click()
        page.reload()
        expect(page.get_by_text("Нужно на экзамене:", exact=False)).to_contain_text("70 / 100")
        expect(page.get_by_label(f"{exam['label']}: максимум", exact=True)).to_have_value("30")
        page.get_by_label("Один выбранный компонент").select_option(exam["id"])
        expect(page.get_by_text("21 / 30", exact=False)).to_be_visible()
        print("OK calculator instant 60/80 => Final70 (21/30), range toggle and save/reload", flush=True)
        page.screenshot(path="/tmp/lifeos-study-calculator.png", full_page=True)

        page.get_by_role("tab", name="Силлабусы", exact=True).click()
        fail_next["download"] = True
        with page.expect_response(lambda response: "/download" in response.url and response.status == 400):
            page.get_by_role("button", name="Скачать PDF", exact=True).first.click()
        expect(page.get_by_text("PDF недоступен. Проверь подключение и повтори.", exact=True)).to_be_visible()
        for document_id, file_name, expected_bytes in [(LEGACY_DOCUMENT, "legacy-original.pdf", PDF_BYTES), (STORAGE_DOCUMENT, "storage-original.pdf", STORAGE_PDF_BYTES)]:
            document_card = page.get_by_text(f"{file_name} · версия {1 if document_id == LEGACY_DOCUMENT else 2}", exact=True).locator("..")
            with page.expect_download() as download_event:
                document_card.get_by_role("button", name="Скачать PDF", exact=True).click()
            downloaded = download_event.value
            assert downloaded.suggested_filename == file_name
            assert Path(downloaded.path()).read_bytes() == expected_bytes
            with context.expect_page() as opened_event:
                document_card.get_by_role("button", name="Открыть PDF", exact=True).click()
            opened = opened_event.value
            expect(opened).to_have_url(re.compile(r"^blob:"))
            opened.close()
            assert downloads.count(("fixture-A", document_id)) == 2
        print("OK authenticated Open/Download original bytes for legacy and Storage documents", flush=True)
        fail_next["upload"] = True
        with page.expect_response(lambda response: response.url.endswith("/documents") and response.status == 400):
            page.locator('input[type="file"]').set_input_files({"name": "browser-русский.pdf", "mimeType": "application/pdf", "buffer": UPLOAD_PDF_BYTES})
        expect(page.get_by_text("Не удалось загрузить PDF. Проверь формат и подключение.", exact=True)).to_be_visible()
        expect(page.locator('input[type="file"]')).to_be_enabled()
        assert len(states["fixture-A"]["courses"][0]["documents"]) == 2, "A failed upload must not register a document"
        with page.expect_response(lambda response: response.url.endswith("/documents") and response.request.method == "POST"):
            page.locator('input[type="file"]').set_input_files({"name": "browser-русский.pdf", "mimeType": "application/pdf", "buffer": UPLOAD_PDF_BYTES})
        expect(page.get_by_text("browser-русский.pdf · версия 3", exact=True)).to_be_visible()
        expect(page.locator('input[type="file"]')).to_be_enabled()
        with page.expect_response(lambda response: response.url.endswith("/documents") and response.request.method == "POST"):
            page.locator('input[type="file"]').set_input_files({"name": "browser-русский.pdf", "mimeType": "application/pdf", "buffer": UPLOAD_PDF_BYTES})
        expect(page.get_by_text("browser-русский.pdf · версия 3", exact=True)).to_have_count(1)
        assert len(states["fixture-A"]["courses"][0]["documents"]) == 3
        page.get_by_role("button", name="Создать новую версию", exact=True).click()
        expect(page.get_by_text(re.compile("Версия 1:"))).to_be_visible()
        page.get_by_role("checkbox", name=re.compile("Я сверил" )).check()
        page.get_by_role("button", name="Подтвердить и активировать", exact=True).click()
        expect(page.get_by_text("Активная", exact=False)).to_be_visible()
        print("OK binary PDF upload/download HTTP400 recovery, repeated upload, new scheme and explicit activation", flush=True)

        page.get_by_role("tab", name="Карта", exact=True).click()
        expect(page.get_by_role("link", name="Открыть карту отдельно")).to_have_attribute("href", "https://yuujiso.github.io/aitumap/")
        page.get_by_role("tab", name="Предметы", exact=True).click()
        expect(page.get_by_text("Database · Account A", exact=True)).to_be_visible()
        page.evaluate("window.__studyFixtureIdentity='fixture-B'")
        expect(page.get_by_text("Database · Account B", exact=True)).to_be_visible(timeout=10000)
        expect(page.get_by_text("Database · Account A", exact=True)).to_have_count(0)
        page.get_by_role("tab", name="Задания", exact=True).click()
        expect(page.get_by_text("Browser edited", exact=True)).to_have_count(0)
        page.get_by_role("tab", name="Дедлайны", exact=True).click()
        expect(page.get_by_text("Moodle upcoming deadline", exact=True)).to_have_count(0)
        page.get_by_role("tab", name="Силлабусы", exact=True).click()
        expect(page.get_by_text("legacy-original.pdf · версия 1", exact=True)).to_have_count(0)
        expect(page.get_by_text("storage-original.pdf · версия 2", exact=True)).to_have_count(0)
        foreign_status = page.evaluate("""async (documentId) => {
            const response = await fetch(`/api/tma/study/documents/${documentId}/download`, {
                headers: { 'x-telegram-init-data': window.__studyFixtureIdentity }
            });
            return response.status;
        }""", LEGACY_DOCUMENT)
        assert foreign_status == 404, "A's document must not be downloadable in B's session"
        print("OK map external link and live account cache isolation A => B", flush=True)
        assert not errors, errors
        assert len(mutations) >= 6, mutations
        browser.close()
    print("PASS mobile UI fixtures; separate TS/SQL suites verify real authorization and persistence")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:55492/tma/", "--flows-only" not in sys.argv)
