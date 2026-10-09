import { ExternalLink, MapPinned } from "lucide-react";

const AITU_MAP_URL = "https://yuujiso.github.io/aitumap/";
const AITU_MAP_REPO_URL = "https://github.com/Yuujiso/aitumap";

export function StudyCampusMap() {
  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
        <h2 className="flex items-center gap-2 font-semibold text-white">
          <MapPinned className="h-5 w-5 text-cyan-400" aria-hidden="true" />
          Карта главного корпуса AITU
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-300">
          Интерактивная карта аудиторий и этажей. Если встроенная версия не
          откроется внутри Telegram, используй кнопку ниже.
        </p>
        <a
          href={AITU_MAP_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 px-4 py-3 text-sm font-semibold text-graphite-950 active:scale-[0.98]"
        >
          Открыть карту отдельно
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.03]">
        <iframe
          title="Интерактивная карта главного корпуса AITU"
          src={AITU_MAP_URL}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-[64vh] min-h-[520px] w-full border-0 bg-white"
        />
      </div>

      <p className="px-1 text-xs leading-relaxed text-zinc-500">
        Карта: Yuujiso/aitumap. Используется с указанием автора согласно README
        проекта.{" "}
        <a
          href={AITU_MAP_REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="text-cyan-300 underline underline-offset-2"
        >
          Исходный проект
        </a>
        .
      </p>
    </section>
  );
}
