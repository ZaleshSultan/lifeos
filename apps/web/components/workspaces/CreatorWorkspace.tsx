"use client";
import { useState } from "react";
import Link from "next/link";
import {
  draftSponsorshipQuestions,
  type CreatorCapabilities,
} from "../../../../packages/core/src/creator.js";
import type { IdealHumanDay } from "../../../../packages/core/src/ideal-human.js";
import { SectionPanel } from "@/components/SectionPanel";
import {
  Notice,
  buttonClass,
  inputClass,
  rowClass,
} from "@/components/WorkspaceUI";
export function CreatorWorkspace({
  capabilities,
  days,
}: {
  capabilities: CreatorCapabilities | null;
  days: IdealHumanDay[] | null;
}) {
  const [company, setCompany] = useState("");
  const [questions, setQuestions] = useState("");
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      <Notice>
        Канал YouTube и почтовый ящик для спонсорских предложений не подключены.
        Данных аналитики и доступа к письмам здесь нет. Подключение требует
        отдельного разрешения выбранного creator-аккаунта.
      </Notice>
      {capabilities === null ? (
        <Notice>
          Состояние внешних интеграций пока не подтверждено. Подготовка планов
          доступна без них.
        </Notice>
      ) : null}
      <SectionPanel title="Сохранённый материал и структура">
        <div className="space-y-3">
          {days?.some((day) => day.storyboard || day.footage?.length) ? (
            days
              .filter((day) => day.storyboard || day.footage?.length)
              .map((day) => (
                <article key={day.date} className={rowClass}>
                  <h3 className="text-sm font-semibold text-white">
                    {day.date}
                  </h3>
                  {day.storyboard ? (
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-300">
                      {day.storyboard}
                    </p>
                  ) : null}
                  {day.footage?.map((clip) => (
                    <p
                      key={clip.id}
                      className="mt-2 break-words text-xs text-zinc-400"
                    >
                      {clip.label} · {clip.kind} · монтаж: {clip.editingStatus}{" "}
                      · копия:{" "}
                      {clip.backupStatus === "user_confirmed"
                        ? "подтверждена тобой"
                        : "не подтверждена"}
                    </p>
                  ))}
                </article>
              ))
          ) : (
            <p className="text-sm text-zinc-400">
              Каталог кадров и структура пока не сохранены. Добавь реальные
              материалы в документальный раздел Ideal Human.
            </p>
          )}
        </div>
        <Link href="/ideal-human" className={`${buttonClass} mt-4`}>
          Открыть каталог и план фильма
        </Link>
        <p className="mt-3 text-xs text-zinc-400">
          Файлы остаются у тебя. Имена и статусы — личные записи; LifeOS не
          подтверждает существование или копирование файлов автоматически.
        </p>
      </SectionPanel>
      <SectionPanel title="Черновик вопросов для обсуждения">
        <p className="mb-4 text-sm leading-relaxed text-zinc-300">
          Можно подготовить текст для ручного просмотра без доступа к почте и
          без AI-запроса. Ничего не отправляется и условия не принимаются.
        </p>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              setDraft(draftSponsorshipQuestions({ company, questions }));
              setError(null);
            } catch {
              setError("Проверь длину названия и вопросов.");
            }
          }}
        >
          <label className="block text-sm text-zinc-300">
            Компания, если известна
            <input
              className={inputClass}
              maxLength={120}
              value={company}
              onChange={(event) => setCompany(event.target.value)}
            />
          </label>
          <label className="block text-sm text-zinc-300">
            Что нужно уточнить
            <textarea
              className={inputClass}
              maxLength={2000}
              rows={4}
              value={questions}
              onChange={(event) => setQuestions(event.target.value)}
            />
          </label>
          <button type="submit" className={buttonClass}>
            Подготовить черновик для просмотра
          </button>
        </form>
        {error ? (
          <div className="mt-3">
            <Notice error>{error}</Notice>
          </div>
        ) : null}
        {draft ? (
          <div className="mt-4 space-y-3">
            <label className="block text-sm text-zinc-300">
              Тема черновика
              <input
                className={inputClass}
                value={draft.subject}
                onChange={(event) =>
                  setDraft({ ...draft, subject: event.target.value })
                }
              />
            </label>
            <label className="block text-sm text-zinc-300">
              Редактируемый текст
              <textarea
                className={inputClass}
                rows={12}
                value={draft.body}
                onChange={(event) =>
                  setDraft({ ...draft, body: event.target.value })
                }
              />
            </label>
            <p className="text-xs text-zinc-400">
              Текст существует только на этом экране. Скопируй его после
              проверки; кнопки отправки и подключения почты нет.
            </p>
          </div>
        ) : null}
      </SectionPanel>
    </div>
  );
}
