import { useEffect, useState } from "react";
import type { CourseGradeTarget } from "../../../../../packages/core/src/grade-target.js";
import { studyScoreLabel } from "./model";

/** Transport-free: shared by TMA and authenticated web surfaces. */
export function CourseGradeTargetCard({
  title,
  result,
  sourceRef,
  onAnalyze,
  onReview,
  reviewing = false,
  reviewError,
  reviewKey,
  reviewedAt,
}: {
  title: string;
  result: CourseGradeTarget;
  sourceRef?: string;
  onAnalyze?: () => void;
  onReview?: (sourceRef: string) => void;
  reviewing?: boolean;
  reviewError?: string | null;
  reviewKey?: string;
  reviewedAt?: string;
}) {
  const [source, setSource] = useState(sourceRef ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  const consentKey = JSON.stringify([reviewKey ?? "", source]);
  const consentValid = confirmed && confirmedFor === consentKey;
  useEffect(() => {
    setConfirmed(false);
  }, [reviewKey]);
  const plan = result.plan;
  return (
    <section
      className="min-w-0 space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4"
      aria-label={`План до цели: ${title}`}
    >
      <h3 className="break-words font-semibold text-white">{title}</h3>
      {sourceRef ? (
        <p className="break-words text-xs text-zinc-400">
          Основание: {sourceRef}
          {reviewedAt ? ` · проверено владельцем ${reviewedAt}` : ""}
        </p>
      ) : null}
      <p className="text-xs text-cyan-200">
        {result.status === "confirmed"
          ? "Политика и сопоставления проверены владельцем"
          : result.status === "unsupported"
            ? "Правило пока не поддерживается"
            : "Условный план · требуется проверка курса и силабуса"}
      </p>
      {plan ? (
        <>
          <p className="text-sm text-zinc-300">
            Цель: <strong>{studyScoreLabel(plan.target)}+</strong> · модель
            30/30/40
          </p>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            {[
              [
                "Учтено по наблюдениям",
                `${studyScoreLabel(plan.earnedFinalPoints)} / 100`,
              ],
              ["Оценённый вес", `${studyScoreLabel(result.completedWeight)}%`],
              [
                "Среднее по оценённому",
                studyScoreLabel(result.assessedAverage),
              ],
              [
                "Оставшийся вес",
                `${studyScoreLabel(plan.remainingFinalWeight)}%`,
              ],
              [
                "Диапазон итога по модели",
                `${studyScoreLabel(plan.minimumFinal)}–${studyScoreLabel(plan.maximumFinal)}`,
              ],
              [
                "Нужно в среднем дальше",
                plan.requiredAverage === null
                  ? "Работ не осталось"
                  : `${studyScoreLabel(plan.requiredAverage)} / 100`,
              ],
            ].map(([label, value]) => (
              <div
                key={label}
                className="min-w-0 rounded-lg bg-white/[0.03] p-3"
              >
                <dt className="text-zinc-400">{label}</dt>
                <dd className="mt-1 break-words text-base font-semibold tabular-nums text-white">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <p
            className={
              plan.targetPossible
                ? "text-sm text-zinc-300"
                : "text-sm text-amber-200"
            }
          >
            {plan.targetPossible
              ? "Цель математически достижима при этих весах и соблюдении условий допуска."
              : "При этих весах цель недостижима даже при 100 за всё оставшееся."}
          </p>
          <details className="border-t border-white/[0.08] pt-2">
            <summary className="min-h-11 cursor-pointer py-3 text-sm text-white">
              Фактическая база и сравнение сценариев
            </summary>
            <ul className="divide-y divide-white/[0.06]">
              {result.observations.map((row) => (
                <li
                  key={row.fieldId}
                  className="break-words py-2 text-xs text-zinc-300"
                >
                  {row.label}:{" "}
                  <strong>
                    {row.score === null
                      ? "Неизвестно"
                      : `${studyScoreLabel(row.score)} / 100`}
                  </strong>
                  {row.observedAt ? (
                    <span className="mt-1 block text-zinc-500">
                      Наблюдение:{" "}
                      {row.observedAt
                        .replace("T", " ")
                        .replace(".000Z", " UTC")}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-zinc-400">
              Если все оставшиеся работы будут на указанный балл; это гипотезы,
              оценки Moodle сохраняются отдельно.
            </p>
            <table className="mt-2 w-full text-left text-xs text-zinc-300">
              <thead>
                <tr>
                  <th className="py-2">Дальше /100</th>
                  <th>Итог по модели</th>
                </tr>
              </thead>
              <tbody>
                {result.scenarios.map((row) => (
                  <tr key={row.remainingScore}>
                    <td className="py-2">{row.remainingScore}</td>
                    <td>
                      {studyScoreLabel(row.final)}
                      {row.attestationWarning ? " · проверь допуск" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          {plan.attestationWarnings.map((warning) => (
            <p key={warning} className="text-xs text-amber-200">
              {warning}
            </p>
          ))}
        </>
      ) : null}
      {result.warnings.map((warning) => (
        <p key={warning} className="text-xs leading-relaxed text-amber-200">
          {warning}
        </p>
      ))}
      <p className="text-[11px] leading-relaxed text-zinc-500">
        {(result.actualState?.definition.attestationThreshold ?? 0) > 0
          ? `В выбранном источнике порог аттестаций: ${result.actualState!.definition.attestationThreshold}. Дополнительные условия допуска уточни у преподавателя.`
          : "Порог допуска в источнике не указан; уточни правила у преподавателя."}{" "}
        Дата наблюдения не доказывает свежесть всей выгрузки. Неизвестные оценки
        не равны нулю. Официальную оценку и допуск определяет университет.
      </p>
      {onAnalyze ? (
        <button
          type="button"
          onClick={onAnalyze}
          className="min-h-11 w-full rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-3 text-sm font-semibold text-cyan-200"
        >
          Открыть симулятор и сопоставления
        </button>
      ) : null}
      {onReview && plan && result.status !== "confirmed" ? (
        <details>
          <summary className="min-h-11 cursor-pointer py-3 text-sm text-white">
            Проверить политику текущего курса
          </summary>
          <label className="block text-xs text-zinc-300">
            Силабус, версия и страница
            <input
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setConfirmed(false);
              }}
              maxLength={500}
              className="mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-graphite-950 px-3 text-base text-white"
            />
          </label>
          <label className="mt-3 flex min-h-11 items-start gap-3 text-xs leading-relaxed text-zinc-300">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 shrink-0"
              checked={consentValid}
              onChange={(e) => {
                setConfirmed(e.target.checked);
                setConfirmedFor(consentKey);
              }}
            />
            Я проверил(а) текущий курс и семестр, веса 30/30/40, пороги
            аттестаций и все сопоставления. Нет бонусов, исключаемых работ,
            нелинейных правил или дополнительных минимальных баллов экзамена.
            Совпадение названия само по себе не подтверждает политику.
          </label>
          <button
            type="button"
            disabled={!consentValid || !source.trim() || reviewing}
            onClick={() => {
              setConfirmed(false);
              onReview(source.trim());
            }}
            className="mt-3 min-h-11 w-full rounded-lg bg-cyan-300 px-3 text-sm font-semibold text-graphite-950 disabled:opacity-50"
          >
            {reviewing
              ? "Сохраняем проверку…"
              : "Подтвердить точную политику и сопоставления"}
          </button>
          {reviewError ? (
            <p role="alert" className="mt-2 text-xs text-rose-200">
              {reviewError}
            </p>
          ) : null}
        </details>
      ) : null}
    </section>
  );
}
