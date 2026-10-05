import { cookies } from "next/headers";

export interface WebSessionStatus {
  state: "unregistered" | "pending" | "active" | "blocked";
  telegramUserId: number;
  displayName?: string | null;
  username?: string | null;
  profile: {
    status: "pending" | "active" | "blocked";
    role: "user" | "admin";
  } | null;
  integrations: {
    telegram: { connected: boolean };
    google: {
      connected: boolean;
      status: string;
      accountEmail?: string | null;
      updatedAt?: string | null;
      calendarWriteEnabled?: boolean;
      reconnectRequired?: boolean;
    };
  };
}

export interface WebWeatherSummary {
  locationName: string;
  temperatureC: number | null;
  apparentTemperatureC: number | null;
  weatherLabel: string;
  minTemperatureC: number | null;
  maxTemperatureC: number | null;
  precipitationProbabilityPercent: number | null;
}

export interface WebHomeSummary {
  displayName?: string;
  localDate: string;
  modeLabel: string;
  modeReason: string;
  recoveryMode: string;
  focusScore: number | null;
  healthCompletenessScore?: number | null;
  pendingSyncCount?: number;
  weather?: WebWeatherSummary | null;
}

function apiBaseUrl(): string {
  const value =
    process.env.LIFEOS_API_BASE_URL ??
    process.env.NEXT_PUBLIC_LIFEOS_API_BASE_URL;
  if (!value) {
    throw new Error("LIFEOS_API_BASE_URL is not configured");
  }
  return value.replace(/\/$/, "");
}

export function lifeosApiBaseUrl(): string {
  return apiBaseUrl();
}

export async function webSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get("lifeos_web_session")?.value ?? null;
}

export async function lifeosApi<T>(path: string): Promise<T | null> {
  const token = await webSessionToken();
  if (!token) return null;

  const response = await fetch(`${apiBaseUrl()}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) {
    throw new Error(`LifeOS API ${path} failed with ${response.status}`);
  }
  const body = (await response.json()) as { data?: T };
  return body.data ?? null;
}

export function verifyWebTokenAgainstApi(token: string): Promise<Response> {
  return fetch(`${apiBaseUrl()}/api/tma/session`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
}


export interface WebStudySchedule {
  id: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  room: string | null;
  sessionType: string | null;
  instructorName: string | null;
}

export interface WebStudyCourse {
  id: string;
  code: string;
  title: string;
  startsOn: string | null;
  endsOn: string | null;
  externalCourseKey: string | null;
  schedules: WebStudySchedule[];
  calculator: unknown | null;
}

export interface WebStudySummary {
  timezone: string;
  courses: WebStudyCourse[];
  records: Array<{
    id?: string;
    courseCode?: string | null;
    courseTitle?: string | null;
    title?: string | null;
    score?: number | null;
    maxScore?: number | null;
    dueAt?: string | null;
  }>;
}
