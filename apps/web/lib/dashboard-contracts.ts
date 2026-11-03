import type { DailyPlan } from "../../../packages/core/src/planner.js";
import type { AiModelRouteReceipt } from "../../../packages/core/src/ai-execution.js";
import type {
  CurrentWorkout,
  WorkoutSet,
  WorkoutExercise,
} from "../../tma/src/api/types";
export interface WebAiStatus {
  enabled: boolean;
  available: boolean;
  reason: string | null;
  liveEnabled: false;
  assistantEnabled?: boolean;
}
export interface WebTodaySummary {
  plan: DailyPlan;
  events: Array<{ title: string; startsAt: string; endsAt: string }>;
  reminders: Array<{ title: string; remindAt: string }>;
  productivity: {
    totalCreated: number;
    totalCompleted: number;
    completionRate: number | null;
    truncated: boolean;
    warnings: string[];
  };
  ai: WebAiStatus;
}
export interface WebAiMessage {
  role: "user" | "assistant";
  text: string;
}
export interface WebAiRequest {
  messages: WebAiMessage[];
  date?: string;
  requestId: string;
  confirmationToken?: string;
  previousModelId?: string;
}
export interface WebAiAnswer {
  answer: string;
  provider: string;
  modelRoute?: AiModelRouteReceipt;
  readOnly: boolean;
  confirmation?: { token: string; summary: string };
  suggestions: Array<{ title?: string; startsAt: string; endsAt: string }>;
}
export interface WebWorkoutSet extends WorkoutSet {
  restSeconds: number | null;
}
export interface WebWorkout extends Omit<CurrentWorkout, "exercises"> {
  exercises: Array<Omit<WorkoutExercise, "sets"> & { sets: WebWorkoutSet[] }>;
}
export interface WebWorkoutHistory extends WebWorkout {
  endedAt: string;
  volumeKg: number;
}
