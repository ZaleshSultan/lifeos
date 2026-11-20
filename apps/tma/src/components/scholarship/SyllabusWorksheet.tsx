import { useEffect, useMemo, useState } from "react";
import {
  calculateSyllabusMinimum,
  scholarshipConfigsMatch,
  scholarshipSyllabusEvidence,
} from "../../../../../packages/core/src/scholarship.js";
import {
  matchSyllabusProfile,
  resolveStudyCalculator,
  studySyllabusDefinitionMatches,
} from "../../../../../packages/core/src/study-syllabi.js";
import {
  useSaveScholarshipPlanMutation,
  type StudyWorkspaceCourse,
} from "../../api/study";
import type { AcademicRecord } from "../../api/types";
import {
  readSessionDraft,
  useDraftStorageKey,
  writeSessionDraft,
} from "../../lib/session-draft";
import { studyScoreLabel as format } from "../study/model";
import {
  isScholarshipDraft,
  reconcileScholarshipDraft,
  scholarshipDraftDirty,
} from "./model";
import { ScoreInput } from "./ScoreInput";
import "./syllabus-worksheet.css";

const periods = [
  ["att1", "Первая аттестация", 30],
  ["att2", "Вторая аттестация", 30],
  ["exam", "Финальный экзамен", 40],
] as const;

export function SyllabusWorksheet({
  course,
  records,
  onOpenCalculator,
  onRefresh,
}: {
  course: StudyWorkspaceCourse;
  records: AcademicRecord[];
  onOpenCalculator: () => void;
  onRefresh: () => void;
}) {
  const remote = course.scholarship ?? null;
  const defaultTarget = course.calculator?.target ?? 70;
  const key = useDraftStorageKey("scholarship", course.id);
  const [draft, setDraft] = useState(() =>
    reconcileScholarshipDraft(
      readSessionDraft(key, isScholarshipDraft),
      remote,
      defaultTarget,
    ),
  );
  const [invalid, setInvalid] = useState(false);
  const [saved, setSaved] = useState(false);
  const save = useSaveScholarshipPlanMutation();
  useEffect(
    () =>
      setDraft((prev) =>
        reconcileScholarshipDraft(prev, remote, defaultTarget),
      ),
    [remote, defaultTarget],
  );
  const dirty = scholarshipDraftDirty(draft);
  useEffect(
    () => writeSessionDraft(key, dirty ? draft : undefined),
    [key, dirty, draft],
  );
  const evidence = useMemo(
    () => scholarshipSyllabusEvidence(course, records),
    [course, records],
  );
  if (!evidence)
    return (
      <section className="syllabus-card">
        <h2>Нет схемы оценивания</h2>
        <p>Укажи работы и их веса из силабуса этого предмета.</p>
        <button type="button" onClick={onOpenCalculator}>
          Настроить веса
        </button>
      </section>
    );

  const config = draft.config;
  const result = calculateSyllabusMinimum(evidence, config);
  const profile = matchSyllabusProfile(course.title, course.code);
  const verifiedProfile =
    profile &&
    studySyllabusDefinitionMatches(
      resolveStudyCalculator(course)!.definition,
      profile.definition,
    );
  const changedRemotely = !scholarshipConfigsMatch(draft.base, remote);
  const conflict =
    changedRemotely ||
    (save.error && "status" in save.error && save.error.status === 409);
  const blocked = result.stageMinima.some((stage) => stage.blocked);
  const achieved = result.shortfall < 1e-8;
  const answer = invalid
    ? "—"
    : blocked
      ? "Порог аттестации недостижим"
      : achieved
        ? "Цель достигнута"
        : !result.targetPossible
          ? "Цель недостижима"
          : format(result.minimumAverage);
  const edit = (next: typeof config) => {
    setDraft({ ...draft, config: next });
    setSaved(false);
  };
  function changeScore(id: string, value: number | null) {
    const scenario = config.scenarios.realistic;
    edit({
      ...config,
      scenarios: {
        ...config.scenarios,
        realistic: {
          ...scenario,
          overrides: { ...scenario.overrides, [id]: value },
        },
      },
    });
  }
  return (
    <form
      className="syllabus-form"
      onChange={(event) => setInvalid(!event.currentTarget.checkValidity())}
      onSubmit={(event) => {
        event.preventDefault();
        if (invalid || !dirty || conflict || save.isPending) return;
        save.mutate(
          { courseId: course.id, config, expectedConfig: draft.base },
          {
            onSuccess: () => {
              writeSessionDraft(key, undefined);
              setSaved(true);
            },
            onError: onRefresh,
          },
        );
      }}
    >
      <section className="syllabus-card syllabus-answer">
        <div className="syllabus-answer-head">
          <div>
            <p>Нужный средний балл</p>
            <output
              aria-label="Нужный средний балл"
              aria-live="polite"
              className={
                invalid || blocked || achieved || !result.targetPossible
                  ? "syllabus-answer-text"
                  : ""
              }
            >
              {answer}
            </output>
          </div>
          <fieldset disabled={save.isPending}>
            <ScoreInput
              label="Цель по предмету"
              value={config.target}
              required
              onChange={(v) => v !== null && edit({ ...config, target: v })}
            />
          </fieldset>
        </div>
        <p className="syllabus-caption">
          {invalid
            ? "Проверь введённые баллы."
            : blocked
              ? "Оставшегося веса недостаточно для порога из силабуса."
              : achieved
                ? "По введённым оценкам уже набрано достаточно баллов."
                : !result.targetPossible
                  ? "Максимально возможный итог — " +
                    format(result.maximumFinal) +
                    " из 100."
                  : "Из 100 на оставшихся работах с учётом их веса."}
        </p>
        {!invalid && (
          <dl className="syllabus-totals">
            <div>
              <dt>Набрано</dt>
              <dd>{format(result.earnedFinalPoints)} / 100</dd>
            </div>
            <div>
              <dt>До цели</dt>
              <dd>{format(result.gradeGap)}</dd>
            </div>
            <div>
              <dt>Вес остатка</dt>
              <dd>{format(result.remainingFinalWeight)}%</dd>
            </div>
          </dl>
        )}
        {!invalid &&
          !blocked &&
          result.stageMinima
            .filter(
              (stage) =>
                stage.needed !== null &&
                stage.needed > (result.minimumAverage ?? 0),
            )
            .map((stage) => (
              <p key={stage.period} className="syllabus-warning">
                {stage.period === "att1" ? "Первая" : "Вторая"} аттестация: по
                оставшимся работам этапа нужно в среднем не меньше{" "}
                {format(stage.needed)}.
              </p>
            ))}
        {!invalid &&
          result.attestationWarnings.map((text) => (
            <p key={text} className="syllabus-warning">
              {text}
            </p>
          ))}
      </section>
      <details className="syllabus-card syllabus-fields" open>
        <summary>Оценки и веса</summary>
        <p className="syllabus-caption">
          {verifiedProfile
            ? profile.source + " · стр. " + profile.sourcePage
            : evidence.definition.sourceName}
          . Пустое поле — оценка ещё неизвестна.
        </p>
        <fieldset disabled={save.isPending}>
          {periods.map(([period, name, weight]) => (
            <section key={period} className="syllabus-period">
              <h3>
                {name}
                <span>{weight}% итога</span>
              </h3>
              {period !== "exam" &&
                evidence.definition.attestationThreshold > 0 && (
                  <p className="syllabus-caption">
                    Порог этапа:{" "}
                    {format(evidence.definition.attestationThreshold)} из 100.
                  </p>
                )}
              {evidence.rows
                .filter((row) => row.period === period)
                .map((row) => (
                  <div key={row.id} className="syllabus-row">
                    {row.confirmed !== null ? (
                      <div className="syllabus-fixed">
                        <span>{row.label}</span>
                        <strong>{format(row.confirmed)}</strong>
                      </div>
                    ) : (
                      <ScoreInput
                        label={row.label}
                        value={result.values[row.id]}
                        placeholder="—"
                        onChange={(v) => changeScore(row.id, v)}
                      />
                    )}
                    <small>
                      {format(
                        evidence.definition.fields.find((f) => f.id === row.id)!
                          .weightPercent,
                      )}
                      % этапа · {format(row.weightInFinal)}% итога
                      {row.confirmed !== null
                        ? " · Moodle"
                        : result.values[row.id] !== null
                          ? " · введено вручную"
                          : ""}
                    </small>
                  </div>
                ))}
            </section>
          ))}
        </fieldset>
        <button type="button" onClick={onOpenCalculator}>
          Настроить веса
        </button>
      </details>
      {evidence.warnings.length > 0 && (
        <details className="syllabus-card">
          <summary>Проверить данные ({evidence.warnings.length})</summary>
          {evidence.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </details>
      )}
      {conflict && (
        <div role="alert" className="syllabus-warning">
          План изменился в другой сессии. Обнови оценки и загрузи сохранённый
          план.
          <button
            type="button"
            onClick={() => {
              setDraft(
                reconcileScholarshipDraft(undefined, remote, defaultTarget),
              );
              save.reset();
              setInvalid(false);
              onRefresh();
            }}
          >
            Загрузить сохранённый план
          </button>
        </div>
      )}
      {save.isError && !conflict && (
        <p role="alert">
          Сохранение не удалось. Введённые значения остались в этой вкладке.
        </p>
      )}
      {(dirty || saved) && (
        <button
          className="syllabus-save"
          type="submit"
          disabled={!dirty || invalid || !!conflict || save.isPending}
        >
          {save.isPending
            ? "Сохраняем…"
            : saved && !dirty
              ? "Расчёт сохранён"
              : "Сохранить расчёт"}
        </button>
      )}
    </form>
  );
}
