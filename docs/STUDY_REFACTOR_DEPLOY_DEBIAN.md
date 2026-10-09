# Учёба: безопасное развёртывание на Debian после восстановления 2026-10-08

Актуально на 2026-10-09: read-only проверка Supabase подтвердила все четыре миграции `20261008000100`–`20261008000400`. Они добавлены в Git для воспроизводимости существующей схемы; повторно применять их нельзя. Bucket `lifeos-study-syllabi` приватный, лимит 62 914 560 байт, MIME `application/pdf`. Russian C1 имеет одну metadata-запись без байтов. Существующая recovery-копия не перезаписывается. Текущие результаты проверок: [STUDY_READINESS_20261009.md](STUDY_READINESS_20261009.md).

**Production SQL, импорт с `--apply`, изменения env и перезапуски ниже разрешены только после отдельного подтверждения пользователя. Агент их не выполнял.** Результаты проверки и границы диагностики: [PRODUCTION_READINESS_20261008.md](PRODUCTION_READINESS_20261008.md).

## Доказанная причина старого `not_found`

На момент диагностики bot и daily-digest-worker имели `TMA_URL=https://lifeos.zalewko.me` без пути. Публичный HTTPS запрос с браузерным User-Agent к `/?screen=study` и такой же запрос к `127.0.0.1:3000` вернули **404 application/json `{"error":"not_found"}`**. Локальный `/tma/` вернул **200 text/html**, сборка содержала `/tma/assets/`. Таким образом, frontend существовал; кнопки открывали корень HTTP backend, где отсутствовал маршрут UI. Публичный запрос с стандартным Python User-Agent дополнительно блокировался Cloudflare (403/1010); это отдельный фильтр, а не причина подтверждённого JSON 404.

Исправление: при настроенном self-hosted frontend корневой GET/HEAD перенаправляется **308** на `/tma/` в том же origin с сохранением query. Это сохраняет старые сообщения даже после исправления env. `/tma` также перенаправляется на `/tma/`; SPA маршруты получают index.html, отсутствующий JS/CSS получает настоящий 404. API не попадает под HTML fallback. Некорректная/отсутствующая сборка сообщает 503. Auth не отключается. Telegram initData проходит HMAC, проверку срока и корректного ID; повторное использование initData внутри одной WebApp сессии допустимо для нескольких API запросов, одноразовое потребление query_id здесь не применяется. См. [официальный контракт Telegram](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).

Необходимые production действия ниже **не выполнялись агентом**. Текущие env, Supabase, запущенные сервисы и `apps/tma/dist` сохранены. Локальные проверки используют временные каталоги и отдельные порты.

## Предварительные условия

Node 22+, Corepack/pnpm, Python 3.11+, PostgreSQL client и Supabase CLI. Для SQL тестов нужен также PostgreSQL server (`initdb`, `pg_ctl`); тестовый кластер не использует DATABASE_URL. Для browser проверки нужен Playwright Chromium. При обслуживании через существующий Cloudflare Tunnel новый nginx не требуется: backend сам отдаёт `/tma/`. Если nginx уже используется, направляйте `/tma/` **без удаления префикса** на backend; TLS сертификат должен быть действительным. Для PDF до 60 MiB разрешите тело HTTP до 80 MiB только на upload маршруте (nginx `client_max_body_size 80m`); проверьте лимит вашего внешнего proxy.

Если Supabase CLI отсутствует, можно запускать его через pnpm без глобальной установки. Определите функцию в том же терминале перед следующими командами:

```bash
supabase() { corepack pnpm dlx supabase@2.120.0 "$@"; }
supabase --version
```

SQL harness запускайте обычным пользователем, не root. Если `pg_config` отсутствует или выбирает другой server version, задайте путь явно: `LIFEOS_TEST_PG_BIN=/usr/lib/postgresql/15/bin bash scripts/test-study-postgres.sh` (замените15 на установленную версию). Если серверные бинарники отсутствуют, harness использует отдельный Docker-контейнер PostgreSQL без сети и TCP-портов. Production DATABASE_URL не используется.

Пять предоставленных оригинальных PDF сейчас не отслеживаются Git. Перед проверками/первоначальным импортом убедитесь, что они присутствуют в `docs/syllabi/` в развёртываемом checkout; переносите их через обычный защищённый канал вместе с кодом. SHA-256 перечислены в [STUDY_SYLLABI_SOURCES.md](STUDY_SYLLABI_SOURCES.md). После импорта runtime использует PostgreSQL metadata и приватный Storage; четыре старых Base64 документа читаются из PostgreSQL без переноса.

## Локальные проверки

```bash
cd /home/zalewko/lifeos
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm run test --maxWorkers=1 --no-file-parallelism
python3 -m venv /tmp/lifeos-study-checks-venv
/tmp/lifeos-study-checks-venv/bin/pip install \
  -r workers/university-sync/requirements.txt \
  -r workers/ics-sync/requirements.txt \
  -r workers/google-sync/requirements.txt \
  -r workers/reminder-worker/requirements.txt \
  -r workers/obsidian-mirror/requirements.txt
PATH=/tmp/lifeos-study-checks-venv/bin:$PATH corepack pnpm test:workers
bash scripts/test-study-postgres.sh
TMA_BUILD_DIR=/tmp/lifeos-study-tma-build bash scripts/build-tma-selfhost.sh
git diff --check
```

Browser smoke с отдельным backend без Supabase credentials (терминал1):

```bash
cd /home/zalewko/lifeos
corepack pnpm exec tsx -e 'import {createBotServer} from "./apps/bot/src/server.ts"; createBotServer({config:{tmaStaticDir:"/tmp/lifeos-study-tma-build",tmaUrl:"http://127.0.0.1:55493/tma/"}}).listen(55493,"127.0.0.1");'
```

Терминал2:

```bash
/tmp/lifeos-study-checks-venv/bin/pip install playwright
/tmp/lifeos-study-checks-venv/bin/playwright install chromium
python3 scripts/smoke-tma.py http://127.0.0.1:55493/
/tmp/lifeos-study-checks-venv/bin/python scripts/test-study-browser.py http://127.0.0.1:55493/tma/
```

API в browser тесте перехватывается fixtures A/B; реальные auth и сохранение независимо проверяются TypeScript/SQL. Остановите только этот отдельный backend через Ctrl+C после теста. При недостающих системных библиотеках Chromium установите зависимости Playwright по его диагностике.

Обычная разработка: `corepack pnpm --filter @lifeos/bot dev` и `corepack pnpm --filter @lifeos/tma dev`. Для production `ALLOW_UNSAFE_TMA_DEV_AUTH=false`, `VITE_ALLOW_MOCK_DATA=false`. Проверяйте авторизацию через реальный запуск из Telegram; plain browser не получает доступ к данным автоматически.

## Проверка backup и pending миграций: только чтение

Существующую recovery-копию не перезаписывайте и не восстанавливайте поверх рабочей базы. `DATABASE_URL` должен быть задан в защищённой среде оператора; не включайте `set -x` и не печатайте значение. CLI закреплён на проверенной версии; не требуется новая ссылка проекта или сброс базы.

```bash
cd /home/zalewko/lifeos
supabase() { corepack pnpm dlx supabase@2.120.0 "$@"; }
(cd /home/zalewko/lifeos-backups/recovery-20261008-122920 && sha256sum -c SHA256SUMS)
supabase migration list --db-url "$DATABASE_URL"
supabase db push --db-url "$DATABASE_URL" --skip-vault --dry-run
```

Ожидается отсутствие pending study-миграций: `00100`, `00200`, `00300` и `00400` уже присутствуют в production history. Файлы должны попасть в Git с теми же версиями. Не выполняйте повторный SQL, `migration repair`, `db reset` или `--include-all`. Если история расходится, сначала выясните причину. Изолированный SQL harness повторяет миграции только в собственном disposable cluster.

## Уже применённая схема

`00300` создаёт приватный bucket `lifeos-study-syllabi`, добавляет Storage pointers и service-only RPC. Четыре старых Base64 поля, версии и metadata остаются на месте. `has_content` сохраняет значения и начинает учитывать оба формата. Новые PDF загружаются бинарно, крупные — TUS блоками 6 MiB, без upsert, по неизменяемому SHA-пути. Перед записью metadata скачанная копия проверяется по длине и SHA-256. [Протокол Supabase Storage](https://supabase.com/docs/guides/storage/uploads/resumable-uploads). Signed TUS использует `/storage/v1/upload/resumable/sign` и `x-signature` на POST/HEAD/PATCH; signed token и opaque API key не передаются как JWT Bearer.

`00400` добавляет claim token, аренду подготовки и message ID; регистрация использует `ON CONFLICT DO NOTHING`. Старые `sent` и `sending` не удаляются и не отправляются повторно. Успешная подготовка восстанавливается после истечения аренды; неопределённый исход Telegram остаётся `sending`/`uncertain` для ручной сверки с чатом.

Проверьте глобальный лимит Storage: он должен допускать оригинал **43 859 568 байт**; bucket разрешает до60MiB. Если лимит проекта меньше, изменять его следует только в согласованном deployment окне. Backend/proxy upload должен пропускать бинарный PDF этого размера. Default import — только чтение; `--apply` отдельно разрешён в согласованном этапе:

```bash
cd /home/zalewko/lifeos
corepack pnpm exec tsx scripts/import-study-syllabi.ts --help
# Проверяет SHA всех совпавших оригиналов, показывает существующие/недостающие PDF.
corepack pnpm exec tsx scripts/import-study-syllabi.ts --env apps/bot/.env
# Заполняет только Russian C1; существующий документ/схема сохраняют ID/версии.
corepack pnpm exec tsx scripts/import-study-syllabi.ts \
  --env apps/bot/.env --course 'K(RUSSIAN)L51-RU' --apply
# Повтор для сверки: только чтение.
corepack pnpm exec tsx scripts/import-study-syllabi.ts --env apps/bot/.env
```

Уточните код Russian C1 по выводу dry-run: используйте ровно код показанного курса, если он отличается от `K(RUSSIAN)L51-RU`. При нескольких владельцах можно ограничить импорт `--user UUID`. Повторите **тот же** apply после частичного сбоя; уникальность owner/course/SHA и сериализация по курсу сохраняют документ и версию. Checkpoint TUS хранится в `~/.cache/lifeos-study-import` с правами0700/0600; URL не выводится, signed token не сохраняется. Просроченная загрузка начинается заново, готовый объект сверяется и используется без перезаписи. Оценки, overrides, mappings и пользовательские схемы не меняются; существующая схема русского курса возвращается без изменения.

## Настройки и перезапуск после подтверждения

Отредактируйте только необходимые переменные в защищённых env (не копируйте пример поверх действующего файла):

```dotenv
# apps/bot/.env
NODE_ENV=production
TMA_URL=https://lifeos.zalewko.me/tma/
TMA_APP_URL=https://lifeos.zalewko.me/tma/
TELEGRAM_WEBAPP_URL=https://lifeos.zalewko.me/tma/
TMA_STATIC_DIR=/home/zalewko/lifeos/apps/tma/dist
ALLOW_UNSAFE_TMA_DEV_AUTH=false

# workers/daily-digest-worker/.env
TMA_URL=https://lifeos.zalewko.me/tma/
DAILY_DIGEST_TIME=06:00
```

Сохраните все остальные параметры, включая Supabase, Moodle, персональную погоду, часовые пояса, OAuth и Telegram. `VITE_API_BASE_URL` можно оставить пустым при едином origin, чтобы сборка не содержала персональный домен. Service-role ключ разрешён только backend/worker.

```bash
cd /home/zalewko/lifeos
corepack pnpm typecheck
corepack pnpm run test --maxWorkers=1 --no-file-parallelism
TMA_URL=https://lifeos.zalewko.me/tma/ bash scripts/deploy-selfhost.sh
# Обновлённый worker запускается после00400, проверки импорта и DAILY_DIGEST_TIME=06:00:
sudo systemctl start lifeos-daily-digest.service
systemctl is-active lifeos-bot.service lifeos-daily-digest.service
python3 scripts/smoke-tma.py https://lifeos.zalewko.me/tma/
# Проверка старых кнопок:
python3 scripts/smoke-tma.py https://lifeos.zalewko.me/
```

При откате после00400 сохраняйте обновлённый worker: старый код снова создаст23505 и не понимает новые claim phases. Не возвращайте старую DB-схему и не сбрасывайте delivery rows. Для `sending`/`uncertain` сначала сверяйте реальный чат; автоматический retry запрещён по реализации.

Deploy script сначала собирает в отдельном каталоге, сохраняет предыдущий dist и перезапускает только bot. Он не меняет env/DB, не посылает kill-сигналы вместо sudo и не перезапускает Moodle, weather или другие workers. При ошибке сборки текущий frontend остаётся на месте. Для отката используйте сохранённый `dist.previous-TIMESTAMP` и предыдущую проверенную ревизию кода; новые таблицы оставляйте на месте, чтобы сохранить добавленные данные.

## Ручная приёмка в Telegram

1. Откройте старую кнопку «Открыть учёбу» и новую `/study`: должен появиться UI.
2. Проверьте девять вкладок, direct links и reload; карта всегда имеет внешнюю ссылку.
3. Войдите двумя активными аккаунтами: предметы/оценки/задания/погода отличаются, чужой ID возвращает 404 или запрет записи.
4. Создайте и отредактируйте ручное задание с дробными earned/max и локальным сроком; проверьте фильтры.
5. Сопоставьте Moodle assessment с компонентом по сохранённому ID; задайте override, выполните штатную синхронизацию и убедитесь, что override сохранился отдельно.
6. Сравните старую схему с подтверждённой PDF версией; переключите только после проверки. Проверьте загрузку нового PDF и сохранность прошлой версии.
7. Проверьте `90/100` DBMS Assignment1 → вклад `5.4`; `15/30` → `50%`; ATT1=60, ATT2=80 → Final≥70. Испытайте null и недостижимую цель.
8. Проверьте несколько оставшихся работ и диапазоны сценариев, ограничения допуска/посещаемости.
9. При онлайн в 08:00 и очной в 10:00 сводка должна показывать оба времени отдельно. Утром в 06:00 подтвердите одну доставку, персональную погоду и защиту от повторов.

Окончательная проверка живого Telegram WebView, proxy и расписания в 06:00 требует деплоя оператором и реальных аккаунтов. Локальные проверки не заменяют эту приёмку.
