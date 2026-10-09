# LifeOS Study refactor — результат 2026-10-08

Текущий статус2026-10-09: [STUDY_READINESS_20261009.md](STUDY_READINESS_20261009.md). Все миграции00100–00400 уже применены; повторять их нельзя. Ниже сохранён исторический отчёт. Подготовка после восстановления production и ранняя диагностика PDF: [PRODUCTION_READINESS_20261008.md](PRODUCTION_READINESS_20261008.md). Ниже описан первоначальный refactor; миграции00100/00200 уже применены и повторно не требуются. Для rollout используйте обновлённый [Debian runbook](STUDY_REFACTOR_DEPLOY_DEBIAN.md).

## Причина и исправление Mini App

Подтверждено HTTP диагностикой: Telegram кнопки открывали корень публичного HTTP backend. В env был URL без `/tma/`, а static frontend обслуживался только под `/tma/`. Публичный и локальный запрос к корню возвращал `404 application/json {"error":"not_found"}`; локальный `/tma/` уже содержал рабочий index.html и assets. Nginx на хосте не используется: действующий Cloudflare Tunnel направляет запросы на Node backend.

Backend теперь сохраняет старые кнопки: корень и `/tma` возвращают same-origin 308 на `/tma/` с исходными параметрами. Девять deep links получают HTML; JS/CSS используют `/tma/assets/`; отсутствующие assets дают 404, отсутствующая сборка — 503. API остаётся отдельным и защищённым. Авторизация Telegram проверяет HMAC, срок, уникальность параметров и корректный ID; unsafe auth не включалась.

## Архитектура и данные

`Telegram → bot HTTP → /tma/ React → authenticated /api/tma/study/* → user-scoped Supabase`. Чистый `packages/core` рассчитывает результат без I/O. Bot и workers используют серверные credentials. Frontend получает только данные владельца и не содержит service-role ключей.

- Существующие `study_courses`, `course_schedules`, `assessment_items`, `academic_records`, `source_events`, `life_entities` сохранены. Таблица assignments не дублируется.
- Новые `syllabus_documents` хранят PDF, SHA-256, источник/страницы, версии и статус проверки. Legacy PDF читается из БД; новые оригиналы читаются из приватного Storage после миграции00300.
- `grading_schemes` содержит версионированное определение компонентов и весов; одна активная версия на курс. `assessment_component_mappings` связывает сохранённый assessment ID с компонентом конкретной версии.
- `assessment_grade_overrides` хранит ручной результат отдельно от синхронизированного. Moodle не записывает эту таблицу. Ввод реального результата в сценарий маркируется `manual_confirmed`; прогноз — `manual_scenario`.
- RLS, составные foreign keys, constraints и индексы защищают владельца, связи, баллы и структуру схем. Активация выполняется атомарно.
- `study_scheme_templates` содержит только проверенные общедоступные сведения из PDF. Seed сопоставляет активные курсы по явным aliases кодов/названий. Пользовательские калькуляторы и metadata сохраняются; конфликтующая версия предлагается для подтверждения.
- Источники Moodle без оценки видны как задания из `source_events`. Сроки объединяются по устойчивому source ID; одноимённые независимые ручные события не сливаются. Личные события календаря не попадают в учебные дедлайны.
- Старый HTML importer сохраняет формулы только как неактивные `needs_review` версии. Он больше не меняет пользовательский калькулятор, аудитории, преподавателя или расписание по скрытым предметным правилам.

## Реализованный интерфейс

Девять вкладок: Сегодня, Предметы, Задания, Дедлайны, Расписание, Оценки, Цель 70+, Силлабусы, Карта. Есть direct links, reload и навигация к выбранному предмету. На 320/390 px нет горизонтального переполнения.

Сегодня показывает отдельно первую онлайн и первую очную пару, полный день, ближайшие задания и актуальность источников. Задания поддерживают карточку, фильтры Сегодня/Просрочено/Неделя/Все, сортировку, ручное создание и редактирование. Оценки показывают earned/max, источник и обновление, явное сопоставление и отдельный override. Силлабусы поддерживают PDF download/upload, редактор компонентов, требования допуска и подтверждаемую новую версию. Карта имеет iframe и постоянную внешнюю ссылку `https://yuujiso.github.io/aitumap/`.

Калькулятор пересчитывается локально и сохраняет сценарий через API. Цель 0–100, по умолчанию 70; raw earned/max, actual/assumed, гарантированный вклад, прогноз, один неизвестный компонент, несколько неизвестных с диапазонами и достижимыми границами. Неоценённый результат остаётся null; выбранный максимум сохраняется отдельно. Минимальные raw points округляются вверх по допустимому шагу. Проверенные пороги и неизвестная посещаемость учитываются отдельно от арифметики.

Клиентский query cache очищается при смене Telegram контекста. Запоздалый ответ предыдущего аккаунта отклоняется. Ошибки авторизации предлагают открыть Mini App через Telegram.

## Первичные PDF

Все пять оригиналов проверены визуально, включая сканы OS и русского языка. Полные веса, policy pages, SHA-256 и неоднозначности: [STUDY_SYLLABI_SOURCES.md](STUDY_SYLLABI_SOURCES.md).

| Предмет    | Таблица оценивания | ATT1                                 | ATT2                                  |
| ---------- | ------------------ | ------------------------------------ | ------------------------------------- |
| DBMS       | PDF 2              | 3 assignments ×20, Quiz10, Midterm30 | 3 assignments ×20, Quiz10, Endterm30  |
| OS         | PDF 8              | 4 assignments ×20, Midterm20         | 4 assignments ×20, Endterm20          |
| DLD        | PDF 5              | 3 assignments ×20, Midterm40         | 3 assignments ×20, Endterm40          |
| Networks   | PDF 7              | 4 assignments ×20, Midterm20         | 4 assignments ×15, Cisco10, Endterm30 |
| Русский C1 | PDF 7–8            | Работа60, Midterm40                  | Презентация60, Endterm40              |

В каждой группе сумма100; итог всех пяти: ATT1×0.30 + ATT2×0.30 + Final×0.40. OS assignments имеют опубликованный максимум15, Networks20; вес внутри группы — отдельная величина. Проверены примеры DBMS90/100 → вклад5.4, Midterm15/30 →50%, ATT1=60/ATT2=80 →Final≥70%, а при Final max30 →21/30.

## Проверки

| Проверка                        | Команда                                                                                                       | Результат                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| TypeScript всех apps/packages   | `corepack pnpm typecheck`                                                                                     | PASS                                                                                                          |
| TypeScript regression suite     | `corepack pnpm run test --maxWorkers=2 --no-file-parallelism`                                                 | **429/429**, 37 файлов                                                                                        |
| Python workers/regression suite | `PATH=/tmp/lifeos-study-checks-venv/bin:$PATH corepack pnpm test:workers`                                     | **151/151**                                                                                                   |
| Legacy HTML importer отдельно   | `/tmp/lifeos-study-checks-venv/bin/python -m unittest scripts/import_study_dashboard_test.py`                 | **16/16**, входят в151                                                                                        |
| PostgreSQL15 migrations/RLS     | `LIFEOS_TEST_PG_BIN=/tmp/lifeos-study-postgres/usr/lib/postgresql/15/bin bash scripts/test-study-postgres.sh` | PASS, две итерации миграций + SQL assertions                                                                  |
| TMA production build в staging  | `TMA_BUILD_DIR=/tmp/lifeos-study-tma-build bash scripts/build-tma-selfhost.sh`                                | PASS, JS512.15kB/gzip139.82kB                                                                                 |
| HTTP HTML/assets/deep links     | `python3 scripts/smoke-tma.py http://127.0.0.1:55493/`                                                        | PASS, девять вкладок +2 assets; API503 без credentials                                                        |
| Mobile Chromium                 | `/tmp/lifeos-study-checks-venv/bin/python scripts/test-study-browser.py http://127.0.0.1:55493/tma/`          | **PASS**, девять вкладок/reload320/390px, assignment CRUD, калькулятор/save, PDF/активация, карта и смена A→B |
| Diff/syntax                     | `git diff --check`, `bash -n`, Python compile                                                                 | PASS                                                                                                          |

SQL проверен в отдельном PostgreSQL15: миграции применены дважды, A/B RLS и FK, невозможные баллы/компоненты, сохранение override после LMS update, сохранность custom metadata, идемпотентные seeds. Последние core regression tests проверяют невозможность допуска, когда неизвестные работы уже не могут поднять аттестацию до25, и достигнутый минимум при ещё не заполненной работе. TypeScript параллельность ограничена двумя workers для стабильного прогона на текущем хосте.

Python suite включает Moodle pipeline, личные источники, daily digest, weather-related briefing и legacy importer. Внешние запросы заменены проверочными fixtures; live Moodle не запускался.

Browser проверяет изолированную сборку с двумя тестовыми аккаунтами и API fixtures; реальные auth/API/RLS отдельно покрываются TypeScript/PostgreSQL. Проверка живого Telegram с реальной Supabase после деплоя остаётся ручной приёмкой.

## Что сохранено и ограничения

- Production env, действующий Supabase, сервисы и live `apps/tma/dist` не изменены. Работа выполнена в текущей ветке без commit/reset пользовательских изменений.
- Утренний worker сохраняет текущий `DAILY_DIGEST_TIME=06:00`, защиту от дублей и персональную погоду. Добавлены учебные кнопки и различение онлайн/очной первой пары. Moodle и weather integration код не заменялся; regression suite прошёл.
- Live delivery в06:00, реальный Telegram WebView и новая схема в рабочем Supabase требуют безопасного деплоя оператором. Эти внешние действия не заявляются как выполненные.
- Новые произвольные PDF не получают автоматическую «проверенную» формулу: пользователь редактирует/сверяет схему и подтверждает активацию. Upload до60MiB; внешний proxy может иметь собственный лимит.
- Русский PDF: текст на стр.3 говорит неделя3, таблица стр.7 — неделя4. Веса подтверждены, timing помечен для проверки. Календарная дата из номера недели не создаётся.
- Неизвестные raw maxima используют явно нормализованный100-point сценарий до получения LMS/teacher max. Посещаемость не выдумывается.
- Старый настроенный калькулятор сохраняется даже при несовпадении с PDF; пользователь должен подтвердить переход на проверенную версию.
- Vite предупреждает о JS chunk больше500kB; сборка проходит, gzip около140kB. Это предупреждение производительности.

## Развёртывание и приёмка

Точные команды Debian, backup, Supabase dry-run/push, импорт PDF, env, staged build, перезапуск и checklist9 шагов: [STUDY_REFACTOR_DEPLOY_DEBIAN.md](STUDY_REFACTOR_DEPLOY_DEBIAN.md).

## Изменённые файлы

Изменённые/созданные файлы этой задачи перечислены ниже. Уже существовавшие изменения `apps/bot/src/web-session.ts`, его теста и web login/API client не относятся к этой задаче и сохранены. В server, commands и daily digest объединены новые изменения и существовавшие пользовательские правки. Пять исходных PDF предоставлены пользователем; они не создавались агентом.

- `"docs/syllabi/\320\240\321\203\321\201\321\201\320\272\320\270\320\271 \320\257\320\267\321\213\320\272, \320\2411_4, 2026-2027(1).pdf"`
- `.gitignore`
- `README.md`
- `apps/bot/.env.selfhost.example`
- `apps/bot/src/server.test.ts`
- `apps/bot/src/server.ts`
- `apps/bot/src/study-routes.test.ts`
- `apps/bot/src/study-routes.ts`
- `apps/bot/src/telegram/commands.test.ts`
- `apps/bot/src/telegram/commands.ts`
- `apps/bot/src/tma-static.test.ts`
- `apps/tma/.env.example`
- `apps/tma/src/App.tsx`
- `apps/tma/src/api/client.test.ts`
- `apps/tma/src/api/client.ts`
- `apps/tma/src/api/study.ts`
- `apps/tma/src/components/study/StudyCalculator.tsx`
- `apps/tma/src/components/study/StudyCampusMap.tsx`
- `apps/tma/src/components/study/StudyGrades.tsx`
- `apps/tma/src/components/study/StudySchedule.tsx`
- `apps/tma/src/components/study/StudySyllabi.tsx`
- `apps/tma/src/components/study/StudyWorkspacePanels.tsx`
- `apps/tma/src/components/study/model.ts`
- `apps/tma/src/components/study/navigation.ts`
- `apps/tma/src/components/study/study.test.ts`
- `apps/tma/src/lib/session-cache.test.ts`
- `apps/tma/src/lib/session-cache.ts`
- `apps/tma/src/main.tsx`
- `apps/tma/src/screens/OnboardingStatusScreen.tsx`
- `apps/tma/src/screens/StudyScreen.tsx`
- `apps/tma/vite.config.ts`
- `docs/STUDY_REFACTOR_DEPLOY_DEBIAN.md`
- `docs/STUDY_REFACTOR_REPORT.md`
- `docs/STUDY_SYLLABI_SOURCES.md`
- `docs/syllabi/grading-seeds.json`
- `docs/syllabi/legacy-dashboard-import.json`
- `packages/core/src/study-syllabi.test.ts`
- `packages/core/src/study-syllabi.ts`
- `packages/core/src/study.test.ts`
- `packages/core/src/study.ts`
- `packages/db/src/index.ts`
- `packages/db/src/lifeos-store.ts`
- `packages/db/src/study-records.test.ts`
- `packages/db/src/study-records.ts`
- `packages/db/src/study-seeds.test.ts`
- `packages/db/src/study-workspace.test.ts`
- `packages/db/src/study-workspace.ts`
- `packages/db/src/types.ts`
- `scripts/build-tma-selfhost.sh`
- `scripts/deploy-selfhost.sh`
- `scripts/import-study-syllabi.ts`
- `scripts/import_study_dashboard.py`
- `scripts/import_study_dashboard_test.py`
- `scripts/smoke-tma.py`
- `scripts/status-selfhost.sh`
- `scripts/test-study-browser.py`
- `scripts/test-study-postgres.sh`
- `supabase/migrations/20261008000100_study_workspace.sql`
- `supabase/migrations/20261008000200_study_syllabus_seeds.sql`
- `supabase/tests/study_workspace.sql`
- `workers/daily-digest-worker/.env.example`
- `workers/daily-digest-worker/README.md`
- `workers/daily-digest-worker/daily_digest_worker.py`
- `workers/daily-digest-worker/daily_digest_worker_test.py`
