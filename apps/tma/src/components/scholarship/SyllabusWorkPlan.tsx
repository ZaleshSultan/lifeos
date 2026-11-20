import { useEffect, useState } from "react";
import type {
  calculateSyllabusWorkPlan,
  scholarshipSyllabusEvidence,
} from "../../../../../packages/core/src/scholarship.js";
import {
  readSessionDraft,
  useDraftStorageKey,
  writeSessionDraft,
} from "../../lib/session-draft";
import { parseStudyScore, studyScoreLabel as format } from "../study/model";

type ForecastInputs = Record<string, string>;
type Evidence = NonNullable<ReturnType<typeof scholarshipSyllabusEvidence>>;
type WorkPlan = ReturnType<typeof calculateSyllabusWorkPlan>;

function isForecastDraft(value: unknown): value is ForecastInputs {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === "string" && v.length <= 12)
  );
}

export function useWorkForecasts(
  courseId: string,
  values?: Record<string, number | null>,
) {
  const key = useDraftStorageKey("work-forecasts", courseId);
  const [inputs, setInputs] = useState<ForecastInputs>(
    () => readSessionDraft(key, isForecastDraft) ?? {},
  );

  // A published or newly entered grade replaces any earlier forecast for that work.
  useEffect(() => {
    if (!values) return;
    setInputs((current) => {
      const remaining = Object.entries(current).filter(
        ([id]) => Object.hasOwn(values, id) && values[id] === null,
      );
      return remaining.length === Object.keys(current).length
        ? current
        : Object.fromEntries(remaining);
    });
  }, [values]);
  useEffect(() => {
    writeSessionDraft(key, Object.keys(inputs).length ? inputs : undefined);
  }, [key, inputs]);

  const scores: Record<string, number> = {};
  let invalid = false;
  for (const [id, text] of Object.entries(inputs)) {
    if (!values || !Object.hasOwn(values, id) || values[id] !== null) continue;
    const parsed = parseStudyScore(text);
    if (parsed === "invalid") invalid = true;
    else if (parsed !== null) scores[id] = parsed;
  }
  function change(id: string, text: string) {
    setInputs((current) => {
      const next = { ...current };
      if (text.trim()) next[id] = text;
      else delete next[id];
      return next;
    });
  }
  return { inputs, scores, invalid, change, reset: () => setInputs({}) };
}

export function WorkPlanCard({
  evidence,
  plan,
  forecasts,
  invalidGrades,
  onOpenGrades,
}: {
  evidence: Evidence;
  plan: WorkPlan;
  forecasts: ReturnType<typeof useWorkForecasts>;
  invalidGrades: boolean;
  onOpenGrades: () => void;
}) {
  const fields = new Map(evidence.rows.map((row) => [row.id, row]));
  const invalid = invalidGrades || forecasts.invalid;
  const hasInput = Object.keys(forecasts.inputs).length > 0;
  return (
    <section className="syllabus-card work-plan" aria-label="План по работам">
      <h2>План по работам</h2>
      {plan.rows.length ? (
        <>
          <p className="syllabus-caption">
            Введи ожидаемый балл в «Прогноз». Остальные баллы подберутся вместе
            с учётом весов и порогов аттестаций.
          </p>
          {invalid ? (
            <p role="status" className="syllabus-warning">
              Проверь введённые баллы.
            </p>
          ) : (
            !plan.possible && (
              <p role="status" className="syllabus-warning">
                {hasInput
                  ? "С таким прогнозом цель недостижима. Измени прогноз или цель."
                  : "С текущими оценками цель недостижима."}
              </p>
            )
          )}
          <table>
            <thead>
              <tr>
                <th scope="col">Работа</th>
                <th scope="col">План</th>
                <th scope="col">Прогноз</th>
              </tr>
            </thead>
            <tbody>
              {plan.rows.map((row) => {
                const field = fields.get(row.id)!;
                const input = forecasts.inputs[row.id] ?? "";
                const bad = parseStudyScore(input) === "invalid";
                const target =
                  row.forecast ?? (invalid ? null : row.recommended);
                return (
                  <tr key={row.id}>
                    <th scope="row">
                      {field.label}
                      <small>{format(field.weightInFinal)}% итога</small>
                    </th>
                    <td>
                      <strong
                        data-testid={`work-target-${row.id}`}
                        className={
                          row.forecast !== null ? "work-plan-pinned" : undefined
                        }
                      >
                        {format(bad ? null : target)}
                      </strong>
                    </td>
                    <td>
                      <input
                        type="text"
                        inputMode="decimal"
                        maxLength={12}
                        placeholder="—"
                        value={input}
                        aria-label={`Прогноз: ${field.label}`}
                        aria-invalid={bad}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.preventDefault();
                        }}
                        onChange={(event) =>
                          forecasts.change(row.id, event.target.value)
                        }
                      />
                      {bad && <small className="syllabus-warning">0–100</small>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ) : (
        <p className="syllabus-caption">По всем работам уже есть оценки.</p>
      )}
      <div className="work-plan-actions">
        <button type="button" onClick={onOpenGrades}>
          К полученным оценкам
        </button>
        {hasInput && (
          <button type="button" onClick={forecasts.reset}>
            Сбросить прогнозы
          </button>
        )}
      </div>
    </section>
  );
}
