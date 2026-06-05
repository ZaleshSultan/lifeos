import { telegram } from "../telegram";
import type {
  ApiEnvelope,
  AcademicSummary,
  CreateReminderInput,
  CurrentWorkout,
  FocusSummary,
  HealthSummary,
  HomeSummary,
  ModeSummary,
  RemindersResponse,
  SaveModeInput,
  SourcesSummary,
  StudyCourse,
  UpdateCourseProgressInput,
} from "./types";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(
  /\/$/,
  "",
);

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-telegram-init-data": telegram.initData,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(
      text || `Request failed: ${response.status}`,
      response.status,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const body = (await response.json()) as ApiEnvelope<T> | T;

  if (body && typeof body === "object" && "data" in body) {
    return (body as ApiEnvelope<T>).data;
  }

  return body as T;
}

export const api = {
  getHome(): Promise<HomeSummary> {
    return request<HomeSummary>("/api/tma/home");
  },
  getCurrentWorkout(): Promise<CurrentWorkout | null> {
    return request<CurrentWorkout | null>("/api/tma/workout/current");
  },
  startWorkout(): Promise<CurrentWorkout> {
    return request<CurrentWorkout>("/api/tma/workout/start", {
      method: "POST",
    });
  },
  completeSet(setId: string): Promise<CurrentWorkout> {
    return request<CurrentWorkout>(
      `/api/tma/workout/sets/${encodeURIComponent(setId)}/complete`,
      { method: "POST" },
    );
  },
  undoSet(setId: string): Promise<CurrentWorkout> {
    return request<CurrentWorkout>(
      `/api/tma/workout/sets/${encodeURIComponent(setId)}/undo`,
      { method: "POST" },
    );
  },
  completeWorkout(workoutId: string): Promise<CurrentWorkout> {
    return request<CurrentWorkout>(
      `/api/tma/workout/${encodeURIComponent(workoutId)}/complete`,
      { method: "POST" },
    );
  },
  getHealth(): Promise<HealthSummary> {
    return request<HealthSummary>("/api/tma/health");
  },
  getFocus(): Promise<FocusSummary> {
    return request<FocusSummary>("/api/tma/focus");
  },
  getSources(): Promise<SourcesSummary> {
    return request<SourcesSummary>("/api/tma/sources");
  },
  getReminders(): Promise<RemindersResponse> {
    return request<RemindersResponse>("/api/tma/reminders");
  },
  getAcademic(): Promise<AcademicSummary> {
    return request<AcademicSummary>("/api/tma/academic");
  },
  createReminder(input: CreateReminderInput): Promise<SourcesSummary> {
    return request<SourcesSummary>("/api/tma/reminders", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  getMode(): Promise<ModeSummary> {
    return request<ModeSummary>("/api/tma/mode");
  },
  saveMode(input: SaveModeInput): Promise<ModeSummary> {
    return request<ModeSummary>("/api/tma/mode", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  clearMode(): Promise<ModeSummary> {
    return request<ModeSummary>("/api/tma/mode", {
      method: "DELETE",
    });
  },
  getActiveCourse(): Promise<StudyCourse | null> {
    return request<StudyCourse | null>("/api/tma/course/active");
  },
  updateActiveCourseProgress(
    input: UpdateCourseProgressInput,
  ): Promise<StudyCourse> {
    return request<StudyCourse>("/api/tma/course/active/progress", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
};
