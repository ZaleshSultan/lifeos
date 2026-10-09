import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StudyCalculatorState } from "../../../../packages/core/src/study.js";
import { telegram } from "../telegram";
import { request } from "./client";
import type { AcademicRecord } from "./types";

export type StudyWeekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export interface StudySchedule {
  id: string;
  dayOfWeek: StudyWeekday;
  startTime: string;
  endTime: string;
  room: string | null;
  sessionType: string | null;
  instructorName: string | null;
}

export interface StudyWorkspaceCourse {
  id: string;
  code: string;
  title: string;
  startsOn: string | null;
  endsOn: string | null;
  externalCourseKey: string | null;
  schedules: StudySchedule[];
  calculator: StudyCalculatorState | null;
  term?: string | null;
  instructorName?: string | null;
  updatedAt?: string;
  actualValues?: StudyCalculatorState["values"];
  gradingSchemes?: StudyGradingScheme[];
  documents?: StudyDocument[];
}

export interface StudyDocument {
  id: string;
  fileName: string;
  version: number;
  sha256?: string;
  extractionStatus?: string;
  sourcePages?: number[];
  uploadedAt: string;
  available?: boolean;
  notes?: string[];
}

export interface StudyGradingScheme {
  id: string;
  version: number;
  definition: StudyCalculatorState["definition"];
  active?: boolean;
  isActive?: boolean;
  verification?: string;
  documentId?: string | null;
  createdAt: string;
}

export interface StudyAssignment {
  id: string;
  studyCourseId: string;
  courseTitle: string;
  courseCode: string | null;
  externalId: string | null;
  source: string;
  title: string;
  assessmentType: string | null;
  actualScore: number | null;
  maxScore: number | null;
  effectiveScore?: number | null;
  effectiveMax?: number | null;
  dueAt: string | null;
  status: string;
  notes: string | null;
  sourceUrl?: string | null;
  componentId?: string | null;
  schemeId?: string | null;
  editable?: boolean;
  override?: { earned: number; max: number; note?: string | null } | null;
  updatedAt: string;
}

export interface StudyDeadline {
  id: string;
  title: string;
  courseTitle?: string | null;
  courseId?: string | null;
  dueAt: string;
  status: string;
  source: string;
  sourceUrl?: string | null;
  assessmentId?: string | null;
  externalId?: string | null;
}

export interface StudyAssignmentInput {
  studyCourseId: string;
  title: string;
  assessmentType?: string | null;
  dueAt?: string | null;
  maxScore?: number | null;
  actualScore?: number | null;
  status?: string;
  notes?: string | null;
  sourceUrl?: string | null;
}

export interface StudyWorkspace {
  timezone: string;
  courses: StudyWorkspaceCourse[];
  records: AcademicRecord[];
  assignments?: StudyAssignment[];
  deadlines?: StudyDeadline[];
  sync?: { updatedAt: string | null; status: string; message?: string };
  sources?: Array<{
    id: string;
    title: string;
    status: string;
    lastSyncedAt: string | null;
    lastError: string | null;
  }>;
}

export const studyQueryKey = ["study"] as const;

export function useStudyQuery() {
  return useQuery({
    queryKey: studyQueryKey,
    queryFn: () => request<StudyWorkspace>("/api/tma/study"),
  });
}

export function useSaveStudyCalculatorMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      courseId,
      state,
    }: {
      courseId: string;
      state: StudyCalculatorState;
    }) =>
      request<StudyCalculatorState>(
        `/api/tma/study/courses/${encodeURIComponent(courseId)}/calculator`,
        {
          method: "PUT",
          body: JSON.stringify({
            values: state.values,
            target: state.target,
            attendancePercent: state.attendancePercent ?? null,
            maxima: state.maxima ?? {},
          }),
        },
      ),
    async onMutate() {
      await queryClient.cancelQueries({ queryKey: studyQueryKey });
    },
    async onSuccess(state, { courseId }) {
      // A refresh started during the save must not replace the saved values.
      await queryClient.cancelQueries({ queryKey: studyQueryKey });
      queryClient.setQueryData<StudyWorkspace>(studyQueryKey, (current) =>
        current
          ? {
              ...current,
              courses: current.courses.map((course) =>
                course.id === courseId
                  ? { ...course, calculator: state }
                  : course,
              ),
            }
          : current,
      );
      telegram.hapticImpact("light");
    },
  });
}

export function useConfigureStudyCalculatorMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      courseId,
      definition,
      target,
    }: {
      courseId: string;
      definition: StudyCalculatorState["definition"];
      target?: number;
    }) =>
      request<StudyCalculatorState>(
        `/api/tma/study/courses/${encodeURIComponent(courseId)}/syllabus`,
        {
          method: "PUT",
          body: JSON.stringify({ definition, target }),
        },
      ),
    async onMutate() {
      await queryClient.cancelQueries({ queryKey: studyQueryKey });
    },
    async onSuccess(state, { courseId }) {
      await queryClient.cancelQueries({ queryKey: studyQueryKey });
      queryClient.setQueryData<StudyWorkspace>(studyQueryKey, (current) =>
        current
          ? {
              ...current,
              courses: current.courses.map((course) =>
                course.id === courseId
                  ? { ...course, calculator: state }
                  : course,
              ),
            }
          : current,
      );
      telegram.hapticImpact("light");
    },
  });
}

/** All study writes remain behind the server's Telegram authentication boundary. */
export function useStudyWriteMutation<TInput, TOutput = unknown>(
  write: (input: TInput) => Promise<TOutput>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    async onSuccess() {
      telegram.hapticImpact("light");
      await queryClient.invalidateQueries({ queryKey: studyQueryKey });
    },
  });
}

const coursePath = (id: string) =>
  `/api/tma/study/courses/${encodeURIComponent(id)}`;
const assignmentPath = (id: string) =>
  `/api/tma/study/assignments/${encodeURIComponent(id)}`;
const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});

export const studyApi = {
  saveAssignment: ({
    id,
    input,
  }: {
    id?: string;
    input: StudyAssignmentInput;
  }) =>
    request<StudyAssignment>(
      id ? assignmentPath(id) : "/api/tma/study/assignments",
      json(id ? "PUT" : "POST", input),
    ),
  overrideGrade: ({
    id,
    value,
  }: {
    id: string;
    value: { earned: number; max: number; note?: string } | null;
  }) =>
    request<{ saved: true }>(
      `${assignmentPath(id)}/grade-override`,
      json("PUT", value ?? { earned: null, max: null }),
    ),
  mapGrade: ({ id, componentId }: { id: string; componentId: string | null }) =>
    request<{ saved: true }>(
      `${assignmentPath(id)}/component`,
      json("PUT", { componentId }),
    ),
  uploadDocument: ({
    courseId,
    fileName,
    file,
  }: {
    courseId: string;
    fileName: string;
    file: Blob;
  }) =>
    request<StudyDocument>(`${coursePath(courseId)}/documents`, {
      method: "POST",
      body: file,
      headers: {
        "content-type": "application/pdf",
        "x-study-file-name": encodeURIComponent(fileName),
      },
    }),
  createScheme: ({
    courseId,
    ...input
  }: {
    courseId: string;
    definition: StudyCalculatorState["definition"];
    documentId?: string;
    activate?: boolean;
    confirmed?: boolean;
  }) =>
    request<StudyGradingScheme>(
      `${coursePath(courseId)}/schemes`,
      json("POST", input),
    ),
  activateScheme: ({
    courseId,
    schemeId,
  }: {
    courseId: string;
    schemeId: string;
  }) =>
    request<StudyGradingScheme>(
      `${coursePath(courseId)}/schemes/${encodeURIComponent(schemeId)}/activate`,
      json("POST", { confirmed: true }),
    ),
  async downloadDocument(documentId: string, fileName: string) {
    const blob = await fetchStudyPdf(documentId);
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
  },
  async openDocument(documentId: string) {
    // Open on the user's tap so the WebView can allow the new window. Nothing
    // private is put into it until the authenticated request has completed.
    const preview = window.open("about:blank", "_blank");
    if (!preview)
      throw new Error("Окно заблокировано. Используй «Скачать PDF».");
    preview.opener = null;
    try {
      const blob = await fetchStudyPdf(documentId);
      const objectUrl = URL.createObjectURL(blob);
      preview.location.replace(objectUrl);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 300_000);
    } catch (error) {
      preview.close();
      throw error;
    }
  },
};

export async function fetchStudyPdf(documentId: string): Promise<Blob> {
  const base = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
  const session = telegram.initData;
  const response = await fetch(
    `${base}/api/tma/study/documents/${encodeURIComponent(documentId)}/download`,
    { headers: { "x-telegram-init-data": session }, cache: "no-store" },
  );
  if (
    !response.ok ||
    response.headers.get("content-type")?.split(";")[0] !== "application/pdf"
  )
    throw new Error("Не удалось открыть PDF. Обнови данные и повтори.");
  const blob = await response.blob();
  if (session !== telegram.initData)
    throw new Error("Сессия Telegram изменилась. Открой PDF повторно.");
  return blob;
}
