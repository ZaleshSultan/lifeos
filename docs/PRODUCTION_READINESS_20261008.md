# LifeOS: подготовка production после восстановления 2026-10-08

Обновление 2026-10-09: все четыре study-миграции уже применены, повторять00300/00400 нельзя. Последующий TUS400 имеет установленную причину: обычный JWT endpoint вместо signed endpoint; исправление и текущие результаты — [STUDY_READINESS_20261009.md](STUDY_READINESS_20261009.md). Историческая диагностика ниже относится к более раннему Base64 импорту, до ошибки signed TUS.

Работа выполнена в текущей ветке `/home/zalewko/lifeos`. Production-база, Storage, env, сервисы и live `apps/tma/dist` не изменены. Не выполнялись migration push/repair/reset, импорт `--apply`, отправки Telegram или production-деплой. Production-диагностика ограничена чтением журналов и security advisors. SQL-тесты запускают собственный временный PostgreSQL через Unix socket; браузерные проверки разрешают только loopback.

## Что установлено о сбое Russian C1

**Точную историческую первопричину по сохранившимся данным установить нельзя. Перегрузка/OOM не доказаны.** Подтверждены следующие факты:

| Наблюдение               | Доказательство и значение                                                                                                                                                                                                                                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Размер оригинала         | 43 859 568 байт; SHA-256 `3b202a5738adc26ace86c94806b2e81dbc866bf8370b61f0ba740d0a3af8f812` совпадает с каталогом и оригиналом.                                                                                                                                                                                                          |
| Base64                   | 58 479 424 символа. Старый CHECK разрешает 83 886 080 символов; конкретный PDF укладывался в ограничение. Это исключает объяснение «превышен CHECK размера», но не устанавливает причину отказа инфраструктуры.                                                                                                                          |
| Четыре предыдущие записи | Edge logs содержат успешные PATCH HTTP204 в06:59:01,06:59:08,06:59:17,06:59:27 UTC. Тела запросов около8.66/5.98/9.91/17.65MB.                                                                                                                                                                                                           |
| Начало русского импорта  | Последний GET metadata для SHA русского оригинала —06:59:42 UTC. Завершённого PATCH и конкретного HTTP/SQL отказа этого PDF в исследованном окне06:55–07:30 UTC нет. Отсутствие события не доказывает причину сбоя.                                                                                                                      |
| PostgreSQL               | В07:26:40 UTC зарегистрирован аварийный startup: `database system was interrupted`; last-known-up06:56:58 UTC. За восстановлением следуют connection refused/recovery errors. Это доказывает прерывание БД, но не причину её прерывания и не причинную связь с PDF.                                                                      |
| OOM/kill/размер HTTP     | В доступных журналах нет подтверждения OOM, signal9, disk exhaustion или HTTP413 русского запроса. PostgREST timeout-сообщения после восстановления относятся к recovery-периоду; их нельзя уверенно приписать исходной загрузке.                                                                                                        |
| Старый importer          | Финальный catch и ошибки persistence скрывали исходный код/status общим сообщением. Сохранившаяся локальная история не восстановила конкретную ошибку исходного запроса. Для окончательной причины нужны исходные stderr/HTTP response и infrastructure/kernel metrics интервала сбоя. Повтор опасного production-запроса не выполнялся. |

Время выше — UTC; для `Asia/Qyzylorda` добавляется5 часов: импорт11:59, восстановление12:26. Новое хранение устраняет отправку огромного Base64 JSON в PostgreSQL независимо от недоказанной инфраструктурной причины. Ошибки теперь сохраняют безопасные phase/code/HTTP status, без ключей, Storage URL или исходных сообщений сервера.

Recovery backup `/home/zalewko/lifeos-backups/recovery-20261008-122920`: `schema.sql`, `data.sql`, `roles.sql` прошли `sha256sum -c SHA256SUMS`. Четыре Base64 PDF из data dump декодированы и сверены с сохранённым SHA и файлами `docs/syllabi/`; все совпали. Русский документ существует с отсутствующими байтами; его схема уже существует.

## PDF: результат реализации

- Новый приватный bucket `lifeos-study-syllabi`; максимум60MiB, MIME `application/pdf`. Immutable путь содержит владельца, курс и SHA-256. Нет public URLs и upsert.
- Новые PDF хранятся бинарно; файлы больше6MiB передаются через TUS блоками6MiB. HEAD сверяет offset после потерянного ответа, expired upload начинает новый сеанс. Операторский checkpoint переживает перезапуск и имеет права0700/0600; signed token не записывается и не выводится.
- SHA-256 оригинала проверяется до загрузки; готовый объект скачивается и сверяется по длине/SHA до регистрации metadata. Готовый объект после частичного сбоя используется только после проверки.
- Регистрация сериализована по курсу, уникальность owner/course/SHA сохраняется. Metadata-only Russian документ заполняется с тем же ID/версией; старая схема, grades, overrides, mappings и пользовательский калькулятор не перезаписываются.
- Четыре legacy Base64 PDF продолжают читаться и проверяться, без переноса или удаления. Версии сохраняются.
- API принимает raw `application/pdf` с URL-encoded Unicode filename; старый JSON/Base64 upload совместим. Ранний Content-Length и потоковый лимит возвращают413 при превышении лимита.
- TMA имеет «Открыть PDF» и «Скачать PDF»: запрос подписан текущим Telegram initData, ответ `private, no-store`; при смене аккаунта байты не выдаются UI. Preview открывается только после получения авторизованных байтов; проигравший авторизацию пустой preview закрывается.
- Backend проверяет владельца документа и курса; Storage pointer должен быть каноническим. RLS ограничивает владельца/курс. Restrictive policies защищают новый bucket даже при существующих широких Storage policies; они не меняют разрешения других buckets. RPC регистрации/верификации доступны только service_role.

Контракт TUS,6MiB chunks и signed-upload header проверены по [документации Supabase](https://supabase.com/docs/guides/storage/uploads/resumable-uploads); доступ к объектам — по [Storage access control](https://supabase.com/docs/guides/storage/security/access-control).

## Worker: доказанная причина и исправление

Старый `claim_delivery` каждую минуту делал повторный INSERT и перехватывал HTTP409 как штатный отказ. PostgreSQL при этом уже регистрировал23505. Такой polling объясняет повторяющиеся ошибки из пользовательской суточной статистики.

Теперь service-only RPC выполняет `INSERT ... ON CONFLICT DO NOTHING` и атомарный conditional UPDATE для допустимого retry/истёкшей подготовки. UUID token защищает от устаревшего worker; аренда подготовки5 минут. Перед внешней отправкой атомарно фиксируется outbound phase. Явный отказ Telegram допускает retry; timeout/неопределённый исход либо сбой БД после принятия сообщения сохраняют `sending`/`uncertain`, без автоматической повторной отправки. Успешная доставка хранит message ID; подтверждение идемпотентно. Старые sent/sending записи сохранены.

06:00 в персональном часовом поясе, персональная погода, первая онлайн и первая очная пара, дела/дедлайны сохранены. Default окно повторной проверки12 часов позволяет догнать пропущенное утро после рестарта. Автоматически восстанавливается подготовка; внешняя доставка через независимые Telegram/PostgreSQL транзакции не может одновременно гарантировать отсутствие дубля и доставку при неопределённом ответе. Такие записи требуют сверки с чатом. Подробности: [worker README](../workers/daily-digest-worker/README.md).

## Проверки

| Проверка                | Результат                                                                                                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript              | `corepack pnpm typecheck`: PASS, bot/core/db/TMA/web.                                                                                                                                                                                                       |
| TypeScript tests        | 447 тестов в39 файлах: PASS. Включают auth/IDOR,70+, реальный Russian43.86MB в7 бинарных chunks, SHA, resume, legacy чтение и PDF session changes.                                                                                                          |
| Python workers          | 169 тестов: PASS. Включают30 daily digest проверок, Moodle, источники, reminders и Obsidian. Внешние отправки/синхронизация заменены fixtures.                                                                                                              |
| PostgreSQL15            | Новые миграции применены дважды только в disposable cluster; workspace/Storage/digest SQL: PASS. A/B/anon, сохранность legacy/grades/override/custom scheme, partial hydration, permissions,1440 claims без23505.                                           |
| Конкурентный PostgreSQL | 48 независимых транзакций, ровно один владелец: PASS.                                                                                                                                                                                                       |
| TMA production build    | PASS; `/tmp/lifeos-study-tma-build`, `/tma/assets/`, mock data отключены. Предупреждение Vite: JS512.61kB, gzip139.94kB.                                                                                                                                    |
| HTTP smoke              | PASS: root redirect, девять links, HTML/assets, закрытый API в изолированном backend.                                                                                                                                                                       |
| Mobile browser          | PASS: девять tabs + reload в320/390px, без overflow; пары/teacher/room, upcoming/overdue/week filters, CRUD заданий,70+ save/reload, PDF open/download exact bytes, version3 + duplicate upload, explicit activation, A→B cache isolation и foreign PDF404. |
| Harness checks          | Bash syntax, Python compile, `git diff --check`: PASS.                                                                                                                                                                                                      |

Первоначальный browser harness использовал headless shell и не смог показать PDF. Исправлен harness: полноценный Chromium channel и валидные одностраничные PDF fixtures. После этого PDF/учебные flows полностью прошли. Это соответствует [различию режимов Playwright Chromium](https://playwright.dev/docs/browsers). Backend auth/persistence отдельно проверены TypeScript/SQL; browser использует API fixtures.

Production PostgreSQL17.6/настоящий Supabase Storage, реальный Telegram WebView, proxy upload и доставка в06:00 требуют согласованного rollout и live приёмки. Изолированные тесты не объявляются live проверкой.

## Миграции и deployment boundary

На 2026-10-09 Supabase `list_migrations` подтверждает `20261008000100`, `00200`, `00300`, `00400`. Эти существующие миграции включаются в репозиторий без изменения SQL и без повторного production применения. Bucket и RPC уже существуют. Следующие live шаги — отдельно подтверждённый импорт Russian C1, корректировка env и deployment, затем Telegram-приёмка. [Актуальный runbook](STUDY_REFACTOR_DEPLOY_DEBIAN.md).

Read-only Supabase security advisors показали существующие замечания вне этих двух миграций: два `SECURITY DEFINER` views (`safe_user_oauth_connections`, `safe_user_lms_settings`), две finance reference tables без RLS и доступные anon/authenticated старые SECURITY DEFINER RPC. Это baseline, а не последствия нового PDF/claim кода; production не изменялся для их устранения. Перед объявлением всего проекта прошедшим security audit нужен отдельный разбор фактических grants. [Views advisory](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view), [RLS advisory](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public), [RPC advisory](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable). RLS без пользовательских policies у worker-only deliveries/nonces ожидаемо закрывает клиентские роли.

## Файлы этого этапа

- `apps/bot/src/server.ts`, `study-routes.ts`, `study-routes.test.ts`.
- `apps/tma/src/api/study.ts`, `study-document.test.ts`, `components/study/StudySyllabi.tsx`.
- `packages/db/src/study-document-storage.ts`, `study-document-storage.test.ts`, `study-errors.ts`, `study-records.ts`, `study-workspace.ts`, `lifeos-store.ts`, `types.ts`, `index.ts`.
- `scripts/import-study-syllabi.ts`, `test-study-postgres.sh`, `test-study-browser.py`, `test-digest-concurrency.py`.
- Две новые миграции00300/00400; `supabase/tests/study_pdf_storage.sql`, `daily_digest_claims.sql`.
- `workers/daily-digest-worker/daily_digest_worker.py`, `daily_digest_worker_test.py`, `README.md`.
- Этот отчёт, `STUDY_REFACTOR_DEPLOY_DEBIAN.md`, актуализация `STUDY_REFACTOR_REPORT.md`.

Полный список ранее выполненного раздела «Учёба» сохранён в [STUDY_REFACTOR_REPORT.md](STUDY_REFACTOR_REPORT.md). Существующие пользовательские изменения web auth/login и другие dirty файлы не сброшены и не включены в результат этого этапа.
