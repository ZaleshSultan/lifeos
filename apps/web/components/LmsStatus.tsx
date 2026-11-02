import { SectionPanel } from "@/components/SectionPanel";
import { dateTime } from "@/lib/dashboard-data";
import type { WebLmsConnection, WebLmsWork } from "@/lib/lms-contracts";
export function LmsStatus({
  connection,
  work,
}: {
  connection: WebLmsConnection | null;
  work: WebLmsWork | null;
}) {
  const labels: Record<string, string> = {
    not_configured: "Не подключено",
    legacy_configuration: "Старое подключение",
    connected: "Подключено",
    session_expired: "Сессия истекла",
    reauthentication_required: "Нужен повторный вход",
    syncing: "Синхронизируется",
    error: "Ошибка синхронизации",
  };
  return (
    <SectionPanel title="AITU LMS и актуальность">
      <p className="text-sm text-zinc-200">
        {connection
          ? (labels[connection.state] ?? "Состояние неизвестно")
          : "Не удалось получить состояние подключения"}
      </p>
      <p className="mt-2 text-xs text-zinc-400">
        Последняя успешная синхронизация:{" "}
        {dateTime(work?.lastSyncSuccessAt ?? connection?.lastSyncSuccessAt)}.
      </p>
      {work?.stale ? (
        <p className="mt-3 text-sm text-amber-100">
          Данные могут быть устаревшими. Сверь занятия, задания и оценки с AITU.
        </p>
      ) : null}
      {connection?.authorization ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs leading-relaxed text-zinc-300">
            Автоматическое подключение LifeOS пока требует поддерживаемого
            разрешения университета. Вход на официальном сайте сам по себе не
            передаёт доступ в LifeOS.
          </p>
          <a
            className="inline-flex min-h-11 items-center rounded-lg border border-white/15 px-3 text-sm text-cyan-200"
            href="https://lms.astanait.edu.kz/auth/oidc/?source=loginpage"
            target="_blank"
            rel="noopener noreferrer"
          >
            Открыть официальный вход AITU
          </a>
          <p className="text-xs text-zinc-400">
            Для существующего расширенного подключения открой Study → AITU LMS в
            Telegram. Пароли и cookies здесь не запрашиваются.
          </p>
        </div>
      ) : null}
    </SectionPanel>
  );
}
