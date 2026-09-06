import type {
  HealthMetricSource,
  HealthMetricType,
  HealthMode,
  HealthSyncReason,
  LifeMode,
  LifeModeSource,
} from "@lifeos/core";

export type Json =
  | boolean
  | number
  | string
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type TableDefinition<Row, Insert, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type LifeEntityType =
  | "capture"
  | "task"
  | "deadline"
  | "health"
  | "health_daily"
  | "external_event"
  | "reminder"
  | "mode"
  | "review"
  | "finance"
  | "spend"
  | "workout";

export type ObsidianSyncStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export type UserObsidianMode = "local_vault" | "agent" | "syncthing";

export type UserObsidianStatus = "disconnected" | "connected" | "error";

export type UserOAuthProvider = "google";

export type UserOAuthStatus = "connected" | "expired" | "revoked" | "error";

export type HealthSyncRunStatus = "success" | "failed";

export type ExternalSourceStatus = "disabled" | "connected" | "error";

export type ProfileStatus = "pending" | "active" | "blocked";

export type ProfileRole = "user" | "admin";

export type SyncRunStatus = "running" | "success" | "partial" | "failed";

export type ReminderStatus =
  | "pending"
  | "processing"
  | "sent"
  | "cancelled"
  | "failed";

export type MonthlyReviewStatus = "draft" | "generated" | "failed";

export type LifeOSProjectStatus =
  | "active"
  | "paused"
  | "completed"
  | "archived";

export type LifeOSTaskStatus =
  | "inbox"
  | "next"
  | "scheduled"
  | "waiting"
  | "done"
  | "cancelled";

export type StudyCourseStatus =
  | "planned"
  | "active"
  | "paused"
  | "completed"
  | "archived";

export type AssessmentItemStatus =
  | "pending"
  | "submitted"
  | "graded"
  | "missed";

export type HealthEntrySource = "manual" | "telegram" | "import" | "automation";

export type MedicationLogStatus = "planned" | "taken" | "skipped";

export type WorkoutIntensity = "easy" | "moderate" | "hard" | "max";

export type FinanceAccountType =
  | "cash"
  | "checking"
  | "savings"
  | "credit"
  | "investment"
  | "loan"
  | "other";

export type FinanceTransactionType =
  | "income"
  | "expense"
  | "transfer"
  | "adjustment";

export type FinanceTransactionStatus = "draft" | "confirmed" | "cancelled";

export type FinanceBudgetPeriod =
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly"
  | "custom";

export type FinanceReimbursementStatus =
  | "pending"
  | "partial"
  | "completed"
  | "cancelled";

export type FinanceReceiptStatus =
  | "uploaded"
  | "processing"
  | "parsed"
  | "linked"
  | "partial"
  | "needs_review"
  | "failed";

export interface Database {
  public: {
    Tables: {
      profiles: TableDefinition<
        {
          user_id: string;
          display_name: string | null;
          timezone: string;
          locale: string;
          telegram_user_id: number | null;
          status: ProfileStatus;
          role: ProfileRole;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          user_id: string;
          display_name?: string | null;
          timezone?: string;
          locale?: string;
          telegram_user_id?: number | null;
          status?: ProfileStatus;
          role?: ProfileRole;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      user_settings: TableDefinition<
        {
          user_id: string;
          settings: Json;
          created_at: string;
          updated_at: string;
        },
        {
          user_id: string;
          settings?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      user_obsidian_settings: TableDefinition<
        {
          user_id: string;
          enabled: boolean;
          mode: UserObsidianMode;
          vault_path: string | null;
          syncthing_folder_id: string | null;
          is_active: boolean;
          timezone: string;
          status: UserObsidianStatus;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          user_id: string;
          enabled?: boolean;
          mode?: UserObsidianMode;
          vault_path?: string | null;
          syncthing_folder_id?: string | null;
          is_active?: boolean;
          timezone?: string;
          status?: UserObsidianStatus;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      google_oauth_state_nonces: TableDefinition<
        {
          nonce: string;
          user_id: string;
          telegram_user_id: number | null;
          issued_at: string;
          expires_at: string;
          consumed_at: string | null;
          created_at: string;
        },
        {
          nonce: string;
          user_id: string;
          telegram_user_id?: number | null;
          issued_at: string;
          expires_at: string;
          consumed_at?: string | null;
          created_at?: string;
        }
      >;
      user_oauth_connections: TableDefinition<
        {
          id: string;
          user_id: string;
          provider: UserOAuthProvider;
          provider_account_email: string | null;
          access_token: string | null;
          refresh_token: string | null;
          expires_at: string | null;
          scopes: string[];
          status: UserOAuthStatus;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          provider: UserOAuthProvider;
          provider_account_email?: string | null;
          access_token?: string | null;
          refresh_token?: string | null;
          expires_at?: string | null;
          scopes?: string[];
          status?: UserOAuthStatus;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      life_areas: TableDefinition<
        {
          id: string;
          user_id: string;
          name: string;
          description: string | null;
          color: string | null;
          sort_order: number;
          archived_at: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          name: string;
          description?: string | null;
          color?: string | null;
          sort_order?: number;
          archived_at?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      projects: TableDefinition<
        {
          id: string;
          user_id: string;
          area_id: string | null;
          name: string;
          description: string | null;
          status: LifeOSProjectStatus;
          starts_on: string | null;
          due_on: string | null;
          completed_at: string | null;
          archived_at: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          area_id?: string | null;
          name: string;
          description?: string | null;
          status?: LifeOSProjectStatus;
          starts_on?: string | null;
          due_on?: string | null;
          completed_at?: string | null;
          archived_at?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      daily_logs: TableDefinition<
        {
          id: string;
          user_id: string;
          log_date: string;
          mood_score: number | null;
          energy_score: number | null;
          focus_score: number | null;
          notes: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          log_date: string;
          mood_score?: number | null;
          energy_score?: number | null;
          focus_score?: number | null;
          notes?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      life_modes: TableDefinition<
        {
          id: string;
          user_id: string;
          mode: LifeMode;
          source: LifeModeSource;
          reason: string | null;
          active_from: string;
          active_until: string | null;
          is_active: boolean;
          priority_json: Json;
          created_at: string;
        },
        {
          id?: string;
          user_id: string;
          mode: LifeMode;
          source?: LifeModeSource;
          reason?: string | null;
          active_from?: string;
          active_until?: string | null;
          is_active?: boolean;
          priority_json?: Json;
          created_at?: string;
        }
      >;
      life_seasons: TableDefinition<
        {
          id: string;
          user_id: string;
          name: string;
          mode: LifeMode;
          starts_on: string;
          ends_on: string;
          priority_json: Json;
          created_at: string;
        },
        {
          id?: string;
          user_id: string;
          name: string;
          mode: LifeMode;
          starts_on: string;
          ends_on: string;
          priority_json?: Json;
          created_at?: string;
        }
      >;
      study_courses: TableDefinition<
        {
          id: string;
          user_id: string;
          code: string;
          title: string;
          term: string | null;
          starts_on: string | null;
          ends_on: string | null;
          status: StudyCourseStatus;
          progress_percent: number;
          completed_units: number;
          total_units: number | null;
          last_studied_on: string | null;
          instructor_name: string | null;
          instructor_email: string | null;
          room: string | null;
          external_course_key: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          code: string;
          title: string;
          term?: string | null;
          starts_on?: string | null;
          ends_on?: string | null;
          status?: StudyCourseStatus;
          progress_percent?: number;
          completed_units?: number;
          total_units?: number | null;
          last_studied_on?: string | null;
          instructor_name?: string | null;
          instructor_email?: string | null;
          room?: string | null;
          external_course_key?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      tasks: TableDefinition<
        {
          id: string;
          user_id: string;
          project_id: string | null;
          area_id: string | null;
          parent_task_id: string | null;
          title: string;
          notes: string | null;
          status: LifeOSTaskStatus;
          priority: number;
          due_at: string | null;
          scheduled_for: string | null;
          completed_at: string | null;
          source: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          project_id?: string | null;
          area_id?: string | null;
          parent_task_id?: string | null;
          title: string;
          notes?: string | null;
          status?: LifeOSTaskStatus;
          priority?: number;
          due_at?: string | null;
          scheduled_for?: string | null;
          completed_at?: string | null;
          source?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      health_vitals: TableDefinition<
        {
          id: string;
          user_id: string;
          measured_at: string;
          metric: string;
          value: number;
          unit: string;
          source: HealthEntrySource;
          notes: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          measured_at?: string;
          metric: string;
          value: number;
          unit: string;
          source?: HealthEntrySource;
          notes?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      sleep_entries: TableDefinition<
        {
          id: string;
          user_id: string;
          sleep_date: string;
          started_at: string | null;
          ended_at: string | null;
          duration_minutes: number | null;
          quality_score: number | null;
          interruptions: number;
          source: HealthEntrySource;
          notes: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          sleep_date: string;
          started_at?: string | null;
          ended_at?: string | null;
          duration_minutes?: number | null;
          quality_score?: number | null;
          interruptions?: number;
          source?: HealthEntrySource;
          notes?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      mood_entries: TableDefinition<
        {
          id: string;
          user_id: string;
          recorded_at: string;
          mood_score: number;
          stress_score: number | null;
          anxiety_score: number | null;
          energy_score: number | null;
          tags: string[];
          source: HealthEntrySource;
          notes: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          recorded_at?: string;
          mood_score: number;
          stress_score?: number | null;
          anxiety_score?: number | null;
          energy_score?: number | null;
          tags?: string[];
          source?: HealthEntrySource;
          notes?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      symptom_entries: TableDefinition<
        {
          id: string;
          user_id: string;
          recorded_at: string;
          symptom: string;
          severity: number | null;
          body_area: string | null;
          source: HealthEntrySource;
          notes: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          recorded_at?: string;
          symptom: string;
          severity?: number | null;
          body_area?: string | null;
          source?: HealthEntrySource;
          notes?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      medications: TableDefinition<
        {
          id: string;
          user_id: string;
          name: string;
          dosage: string | null;
          schedule_text: string | null;
          active: boolean;
          started_on: string | null;
          ended_on: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          name: string;
          dosage?: string | null;
          schedule_text?: string | null;
          active?: boolean;
          started_on?: string | null;
          ended_on?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      medication_logs: TableDefinition<
        {
          id: string;
          user_id: string;
          medication_id: string | null;
          scheduled_for: string | null;
          recorded_at: string;
          status: MedicationLogStatus;
          dose_taken: string | null;
          notes: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          medication_id?: string | null;
          scheduled_for?: string | null;
          recorded_at?: string;
          status?: MedicationLogStatus;
          dose_taken?: string | null;
          notes?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      workouts: TableDefinition<
        {
          id: string;
          user_id: string;
          title: string | null;
          workout_type: string | null;
          started_at: string;
          ended_at: string | null;
          duration_minutes: number | null;
          intensity: WorkoutIntensity | null;
          perceived_effort: number | null;
          notes: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          title?: string | null;
          workout_type?: string | null;
          started_at?: string;
          ended_at?: string | null;
          duration_minutes?: number | null;
          intensity?: WorkoutIntensity | null;
          perceived_effort?: number | null;
          notes?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      fitness_exercises: TableDefinition<
        {
          id: string;
          user_id: string;
          name: string;
          category: string | null;
          primary_muscles: string[];
          equipment: string | null;
          archived_at: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          name: string;
          category?: string | null;
          primary_muscles?: string[];
          equipment?: string | null;
          archived_at?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      fitness_logs: TableDefinition<
        {
          id: string;
          user_id: string;
          workout_id: string | null;
          life_entity_id: string | null;
          exercise_id: string | null;
          exercise_name: string;
          logged_at: string;
          weight_kg: number | null;
          sets: number;
          reps: number | null;
          volume_kg: number | null;
          source: string;
          source_command: string | null;
          source_telegram_chat_id: number | null;
          source_telegram_message_id: number | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          workout_id?: string | null;
          life_entity_id?: string | null;
          exercise_id?: string | null;
          exercise_name: string;
          logged_at?: string;
          weight_kg?: number | null;
          sets?: number;
          reps?: number | null;
          source?: string;
          source_command?: string | null;
          source_telegram_chat_id?: number | null;
          source_telegram_message_id?: number | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      workout_sets: TableDefinition<
        {
          id: string;
          user_id: string;
          workout_id: string;
          exercise_id: string | null;
          set_index: number;
          reps: number | null;
          weight_kg: number | null;
          distance_meters: number | null;
          duration_seconds: number | null;
          rest_seconds: number | null;
          completed: boolean;
          completed_at: string | null;
          notes: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          workout_id: string;
          exercise_id?: string | null;
          set_index?: number;
          reps?: number | null;
          weight_kg?: number | null;
          distance_meters?: number | null;
          duration_seconds?: number | null;
          rest_seconds?: number | null;
          completed?: boolean;
          completed_at?: string | null;
          notes?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      body_measurements: TableDefinition<
        {
          id: string;
          user_id: string;
          measured_at: string;
          weight_kg: number | null;
          body_fat_percent: number | null;
          waist_cm: number | null;
          chest_cm: number | null;
          hip_cm: number | null;
          notes: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          measured_at?: string;
          weight_kg?: number | null;
          body_fat_percent?: number | null;
          waist_cm?: number | null;
          chest_cm?: number | null;
          hip_cm?: number | null;
          notes?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      fitness_goals: TableDefinition<
        {
          id: string;
          user_id: string;
          title: string;
          metric: string;
          target_value: number | null;
          target_unit: string | null;
          starts_on: string | null;
          target_on: string | null;
          completed_at: string | null;
          archived_at: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          title: string;
          metric: string;
          target_value?: number | null;
          target_unit?: string | null;
          starts_on?: string | null;
          target_on?: string | null;
          completed_at?: string | null;
          archived_at?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      health_daily: TableDefinition<
        {
          id: string;
          user_id: string;
          log_date: string;
          sync_reason: HealthSyncReason;
          recovery_mode: HealthMode;
          data_completeness_score: number;
          sleep_minutes: number | null;
          sleep_score: number | null;
          deep_sleep_minutes: number | null;
          rem_sleep_minutes: number | null;
          awake_minutes: number | null;
          resting_heart_rate: number | null;
          hrv_ms: number | null;
          spo2_avg: number | null;
          steps: number | null;
          calories_burned: number | null;
          active_energy_kcal: number | null;
          workout_minutes: number | null;
          weight_kg: number | null;
          mood_score: number | null;
          energy_score: number | null;
          stress_score: number | null;
          source: string | null;
          timezone: string | null;
          missing_metrics: Json;
          metadata: Json;
          raw_payload: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          log_date: string;
          sync_reason: HealthSyncReason;
          recovery_mode: HealthMode;
          data_completeness_score: number;
          sleep_minutes?: number | null;
          sleep_score?: number | null;
          deep_sleep_minutes?: number | null;
          rem_sleep_minutes?: number | null;
          awake_minutes?: number | null;
          resting_heart_rate?: number | null;
          hrv_ms?: number | null;
          spo2_avg?: number | null;
          steps?: number | null;
          calories_burned?: number | null;
          active_energy_kcal?: number | null;
          workout_minutes?: number | null;
          weight_kg?: number | null;
          mood_score?: number | null;
          energy_score?: number | null;
          stress_score?: number | null;
          source?: string | null;
          timezone?: string | null;
          missing_metrics?: Json;
          metadata?: Json;
          raw_payload?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      health_sync_runs: TableDefinition<
        {
          id: string;
          user_id: string;
          health_daily_id: string | null;
          life_entity_id: string | null;
          sync_date: string;
          sync_reason: HealthSyncReason;
          status: HealthSyncRunStatus;
          started_at: string;
          completed_at: string | null;
          workouts_upserted: number;
          samples_inserted: number;
          data_completeness_score: number | null;
          recovery_mode: HealthMode | null;
          source: string | null;
          error: string | null;
          missing_metrics: Json;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          health_daily_id?: string | null;
          life_entity_id?: string | null;
          sync_date: string;
          sync_reason: HealthSyncReason;
          status: HealthSyncRunStatus;
          started_at?: string;
          completed_at?: string | null;
          workouts_upserted?: number;
          samples_inserted?: number;
          data_completeness_score?: number | null;
          recovery_mode?: HealthMode | null;
          source?: string | null;
          error?: string | null;
          missing_metrics?: Json;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      health_workouts: TableDefinition<
        {
          id: string;
          user_id: string;
          health_daily_id: string | null;
          external_id: string | null;
          workout_date: string;
          started_at: string;
          ended_at: string | null;
          workout_type: string | null;
          title: string | null;
          duration_minutes: number | null;
          calories_kcal: number | null;
          distance_meters: number | null;
          source: string;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          health_daily_id?: string | null;
          external_id?: string | null;
          workout_date: string;
          started_at: string;
          ended_at?: string | null;
          workout_type?: string | null;
          title?: string | null;
          duration_minutes?: number | null;
          calories_kcal?: number | null;
          distance_meters?: number | null;
          source?: string;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      health_samples: TableDefinition<
        {
          id: string;
          user_id: string;
          health_daily_id: string | null;
          sample_type: string;
          sampled_at: string;
          value: number;
          unit: string;
          source: string;
          metadata: Json;
          created_at: string;
        },
        {
          id?: string;
          user_id: string;
          health_daily_id?: string | null;
          sample_type: string;
          sampled_at: string;
          value: number;
          unit: string;
          source?: string;
          metadata?: Json;
          created_at?: string;
        }
      >;
      health_metrics: TableDefinition<
        {
          id: string;
          user_id: string;
          metric_date: string;
          metric_type: HealthMetricType;
          value: number;
          unit: string | null;
          source: HealthMetricSource;
          confidence: number | null;
          raw_json: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          metric_date: string;
          metric_type: HealthMetricType;
          value: number;
          unit?: string | null;
          source?: HealthMetricSource;
          confidence?: number | null;
          raw_json?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      finance_accounts: TableDefinition<
        {
          id: string;
          user_id: string;
          name: string;
          account_type: FinanceAccountType;
          currency: string;
          opening_balance: number;
          institution_name: string | null;
          is_default: boolean;
          archived_at: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          name: string;
          account_type?: FinanceAccountType;
          currency?: string;
          opening_balance?: number;
          institution_name?: string | null;
          is_default?: boolean;
          archived_at?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      finance_categories: TableDefinition<
        {
          id: string;
          user_id: string;
          name: string;
          transaction_type: FinanceTransactionType;
          parent_category_id: string | null;
          color: string | null;
          archived_at: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          name: string;
          transaction_type: FinanceTransactionType;
          parent_category_id?: string | null;
          color?: string | null;
          archived_at?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      finance_transactions: TableDefinition<
        {
          id: string;
          user_id: string;
          account_id: string;
          transfer_account_id: string | null;
          category_id: string | null;
          transaction_type: FinanceTransactionType;
          occurred_on: string;
          posted_at: string | null;
          amount: number;
          currency: string;
          base_amount: number | null;
          base_currency: string;
          exchange_rate: number | null;
          exchange_rate_date: string | null;
          merchant: string | null;
          description: string | null;
          external_ref: string | null;
          status: FinanceTransactionStatus;
          raw_text: string | null;
          confidence: number | null;
          source: string;
          parse_run_id: string | null;
          confirmed_at: string | null;
          cancelled_at: string | null;
          tags: string[];
          receipt_id: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          account_id: string;
          transfer_account_id?: string | null;
          category_id?: string | null;
          transaction_type: FinanceTransactionType;
          occurred_on: string;
          posted_at?: string | null;
          amount: number;
          currency?: string;
          base_amount?: number | null;
          base_currency?: string;
          exchange_rate?: number | null;
          exchange_rate_date?: string | null;
          merchant?: string | null;
          description?: string | null;
          external_ref?: string | null;
          status?: FinanceTransactionStatus;
          raw_text?: string | null;
          confidence?: number | null;
          source?: string;
          parse_run_id?: string | null;
          confirmed_at?: string | null;
          cancelled_at?: string | null;
          tags?: string[];
          receipt_id?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      finance_ai_parse_runs: TableDefinition<
        {
          id: string;
          user_id: string;
          input_text: string;
          parsed_json: Json;
          status: string;
          error_message: string | null;
          parser: string;
          confidence: number | null;
          transaction_id: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          input_text: string;
          parsed_json?: Json;
          status?: string;
          error_message?: string | null;
          parser?: string;
          confidence?: number | null;
          transaction_id?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      finance_budgets: TableDefinition<
        {
          id: string;
          user_id: string;
          category_id: string | null;
          period: FinanceBudgetPeriod;
          period_start: string;
          period_end: string | null;
          amount: number;
          currency: string;
          name: string | null;
          notes: string | null;
          is_active: boolean;
          archived_at: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          category_id?: string | null;
          period?: FinanceBudgetPeriod;
          period_start: string;
          period_end?: string | null;
          amount: number;
          currency?: string;
          name?: string | null;
          notes?: string | null;
          is_active?: boolean;
          archived_at?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      finance_recurring_rules: TableDefinition<
        {
          id: string;
          user_id: string;
          account_id: string;
          category_id: string | null;
          transaction_type: FinanceTransactionType;
          amount: number;
          currency: string;
          cadence: string;
          starts_on: string;
          ends_on: string | null;
          next_due_on: string | null;
          merchant: string | null;
          description: string | null;
          active: boolean;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          account_id: string;
          category_id?: string | null;
          transaction_type: FinanceTransactionType;
          amount: number;
          currency?: string;
          cadence: string;
          starts_on: string;
          ends_on?: string | null;
          next_due_on?: string | null;
          merchant?: string | null;
          description?: string | null;
          active?: boolean;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      finance_budget_categories: TableDefinition<
        {
          id: string;
          user_id: string;
          budget_id: string;
          category_id: string;
          limit_amount: number;
          currency: string;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          budget_id: string;
          category_id: string;
          limit_amount: number;
          currency?: string;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      finance_tags: TableDefinition<
        {
          id: string;
          user_id: string;
          name: string;
          color: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          name: string;
          color?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      finance_transaction_tags: TableDefinition<
        {
          transaction_id: string;
          tag_id: string;
          created_at: string;
        },
        {
          transaction_id: string;
          tag_id: string;
          created_at?: string;
        }
      >;
      finance_currencies: TableDefinition<
        {
          code: string;
          name: string;
          symbol: string;
          decimal_places: number;
          is_active: boolean;
          created_at: string;
        },
        {
          code: string;
          name: string;
          symbol: string;
          decimal_places?: number;
          is_active?: boolean;
          created_at?: string;
        }
      >;
      finance_exchange_rates: TableDefinition<
        {
          id: string;
          from_currency: string;
          to_currency: string;
          rate: number;
          rate_date: string;
          source: string;
          created_at: string;
        },
        {
          id?: string;
          from_currency: string;
          to_currency: string;
          rate: number;
          rate_date: string;
          source?: string;
          created_at?: string;
        }
      >;
      finance_reimbursements: TableDefinition<
        {
          id: string;
          user_id: string;
          transaction_id: string;
          original_amount: number;
          reimbursed_amount: number;
          remaining: number;
          currency: string;
          status: FinanceReimbursementStatus;
          reimbursed_by: string | null;
          notes: string | null;
          reimbursed_at: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          transaction_id: string;
          original_amount: number;
          reimbursed_amount?: number;
          currency?: string;
          status?: FinanceReimbursementStatus;
          reimbursed_by?: string | null;
          notes?: string | null;
          reimbursed_at?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      finance_receipts: TableDefinition<
        {
          id: string;
          user_id: string;
          storage_path: string;
          file_name: string | null;
          mime_type: string | null;
          ocr_json: Json;
          parsed_json: Json;
          ocr_text: string | null;
          openrouter_model: string | null;
          processed_at: string | null;
          status: FinanceReceiptStatus;
          transaction_id: string | null;
          error_message: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          storage_path: string;
          file_name?: string | null;
          mime_type?: string | null;
          ocr_json?: Json;
          parsed_json?: Json;
          ocr_text?: string | null;
          openrouter_model?: string | null;
          processed_at?: string | null;
          status?: FinanceReceiptStatus;
          transaction_id?: string | null;
          error_message?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      finance_receipt_items: TableDefinition<
        {
          id: string;
          user_id: string;
          receipt_id: string;
          name: string;
          quantity: number;
          unit_price: number | null;
          total_amount: number | null;
          currency: string;
          metadata: Json;
          created_at: string;
        },
        {
          id?: string;
          user_id: string;
          receipt_id: string;
          name: string;
          quantity?: number;
          unit_price?: number | null;
          total_amount?: number | null;
          currency?: string;
          metadata?: Json;
          created_at?: string;
        }
      >;
      finance_ai_analysis_runs: TableDefinition<
        {
          id: string;
          user_id: string;
          request_type: string;
          prompt: string;
          input_json: Json;
          output_json: Json;
          model: string | null;
          status: string;
          error_message: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          request_type: string;
          prompt: string;
          input_json?: Json;
          output_json?: Json;
          model?: string | null;
          status?: string;
          error_message?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      external_sources: TableDefinition<
        {
          id: string;
          user_id: string;
          source_key: string;
          source_type: string;
          display_name: string;
          status: ExternalSourceStatus;
          config_json: Json;
          last_sync_at: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          source_key: string;
          source_type: string;
          display_name: string;
          status?: ExternalSourceStatus;
          config_json?: Json;
          last_sync_at?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      sync_runs: TableDefinition<
        {
          id: string;
          user_id: string;
          source_id: string | null;
          source_key: string;
          status: SyncRunStatus;
          started_at: string;
          finished_at: string | null;
          records_seen: number;
          records_created: number;
          records_updated: number;
          error_message: string | null;
          metadata_json: Json;
        },
        {
          id?: string;
          user_id: string;
          source_id?: string | null;
          source_key: string;
          status?: SyncRunStatus;
          started_at?: string;
          finished_at?: string | null;
          records_seen?: number;
          records_created?: number;
          records_updated?: number;
          error_message?: string | null;
          metadata_json?: Json;
        }
      >;
      source_events: TableDefinition<
        {
          id: string;
          user_id: string;
          source_key: string;
          external_id: string | null;
          event_type: string;
          title: string | null;
          description: string | null;
          location: string | null;
          starts_at: string | null;
          ends_at: string | null;
          due_at: string | null;
          status: string;
          raw_json: Json;
          normalized_entity_id: string | null;
          provider: string | null;
          external_updated_at: string | null;
          source_url: string | null;
          reminder_policy_key: string | null;
          checksum: string | null;
          last_synced_at: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          source_key: string;
          external_id?: string | null;
          event_type: string;
          title?: string | null;
          description?: string | null;
          location?: string | null;
          starts_at?: string | null;
          ends_at?: string | null;
          due_at?: string | null;
          status?: string;
          raw_json?: Json;
          normalized_entity_id?: string | null;
          provider?: string | null;
          external_updated_at?: string | null;
          source_url?: string | null;
          reminder_policy_key?: string | null;
          checksum?: string | null;
          last_synced_at?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      reminders: TableDefinition<
        {
          id: string;
          user_id: string;
          life_entity_id: string | null;
          source_event_id: string | null;
          channel: string;
          remind_at: string;
          status: ReminderStatus;
          message: string;
          metadata_json: Json;
          dedup_key: string | null;
          reminder_policy_key: string | null;
          claimed_at: string | null;
          sent_at: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          life_entity_id?: string | null;
          source_event_id?: string | null;
          channel?: string;
          remind_at: string;
          status?: ReminderStatus;
          message: string;
          metadata_json?: Json;
          dedup_key?: string | null;
          reminder_policy_key?: string | null;
          claimed_at?: string | null;
          sent_at?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      academic_records: TableDefinition<
        {
          id: string;
          user_id: string;
          source_event_id: string | null;
          course_title: string;
          record_type: string;
          title: string;
          value_text: string | null;
          score: number | null;
          max_score: number | null;
          percentage: number | null;
          occurs_at: string | null;
          due_at: string | null;
          raw_json: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          source_event_id?: string | null;
          course_title: string;
          record_type: string;
          title: string;
          value_text?: string | null;
          score?: number | null;
          max_score?: number | null;
          percentage?: number | null;
          occurs_at?: string | null;
          due_at?: string | null;
          raw_json?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      life_captures: TableDefinition<
        {
          id: string;
          user_id: string;
          text: string;
          source: string;
          status: string;
          chat_id: number | null;
          message_id: number | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          text: string;
          source?: string;
          status?: string;
          chat_id?: number | null;
          message_id?: number | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      life_entities: TableDefinition<
        {
          id: string;
          user_id: string;
          entity_type: LifeEntityType;
          domain: string;
          status: string;
          title: string;
          description: string | null;
          body: string | null;
          occurred_at: string;
          due_at: string | null;
          source: string;
          source_command: string | null;
          telegram_chat_id: number | null;
          telegram_message_id: number | null;
          linked_table: string | null;
          linked_id: string | null;
          metadata: Json;
          raw_payload_json: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          entity_type: LifeEntityType;
          domain?: string;
          status?: string;
          title: string;
          description?: string | null;
          body?: string | null;
          occurred_at?: string;
          due_at?: string | null;
          source?: string;
          source_command?: string | null;
          telegram_chat_id?: number | null;
          telegram_message_id?: number | null;
          linked_table?: string | null;
          linked_id?: string | null;
          metadata?: Json;
          raw_payload_json?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      obsidian_sync_queue: TableDefinition<
        {
          id: string;
          user_id: string;
          life_entity_id: string | null;
          operation: string;
          entity_type: LifeEntityType | null;
          action: string;
          target_path: string | null;
          status: ObsidianSyncStatus;
          attempts: number;
          available_at: string;
          locked_at: string | null;
          completed_at: string | null;
          last_error: string | null;
          payload: Json;
          payload_json: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          life_entity_id?: string | null;
          operation?: string;
          entity_type?: LifeEntityType | null;
          action?: string;
          target_path?: string | null;
          status?: ObsidianSyncStatus;
          attempts?: number;
          available_at?: string;
          locked_at?: string | null;
          completed_at?: string | null;
          last_error?: string | null;
          payload?: Json;
          payload_json?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
      monthly_reviews: TableDefinition<
        {
          id: string;
          user_id: string;
          period_month: string;
          status: MonthlyReviewStatus;
          report_title: string | null;
          report_markdown: string;
          ai_model: string | null;
          ai_input_json: Json;
          ai_output_json: Json;
          stats_json: Json;
          obsidian_path: string | null;
          generated_at: string | null;
          error_message: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          period_month: string;
          status?: MonthlyReviewStatus;
          report_title?: string | null;
          report_markdown: string;
          ai_model?: string | null;
          ai_input_json?: Json;
          ai_output_json?: Json;
          stats_json?: Json;
          obsidian_path?: string | null;
          generated_at?: string | null;
          error_message?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      course_schedules: TableDefinition<
        {
          id: string;
          study_course_id: string;
          day_of_week: string;
          start_time: string;
          end_time: string;
          room: string | null;
          session_type: string | null;
          instructor_name: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          study_course_id: string;
          day_of_week: string;
          start_time: string;
          end_time: string;
          room?: string | null;
          session_type?: string | null;
          instructor_name?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      >;
      assessment_items: TableDefinition<
        {
          id: string;
          study_course_id: string;
          external_id: string | null;
          source: string;
          title: string;
          assessment_type: string | null;
          weight_percent: number | null;
          max_score: number | null;
          actual_score: number | null;
          due_at: string | null;
          due_source: string | null;
          syllabus_due_at: string | null;
          status: AssessmentItemStatus;
          notes: string | null;
          raw_json: Json;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          study_course_id: string;
          external_id?: string | null;
          source?: string;
          title: string;
          assessment_type?: string | null;
          weight_percent?: number | null;
          max_score?: number | null;
          actual_score?: number | null;
          due_at?: string | null;
          due_source?: string | null;
          syllabus_due_at?: string | null;
          status?: AssessmentItemStatus;
          notes?: string | null;
          raw_json?: Json;
          created_at?: string;
          updated_at?: string;
        }
      >;
    };
    Views: {
      finance_budget_category_status: {
        Row: {
          id: string;
          user_id: string;
          budget_id: string;
          category_id: string;
          category_name: string;
          budget_name: string | null;
          period: FinanceBudgetPeriod;
          period_start: string;
          period_end: string;
          limit_amount: number;
          spent_amount: number;
          remaining_amount: number;
          percent_used: number;
          overspent: boolean;
          currency: string;
        };
        Relationships: [];
      };
      safe_user_oauth_connections: {
        Row: {
          id: string;
          user_id: string;
          provider: UserOAuthProvider;
          provider_account_email: string | null;
          expires_at: string | null;
          scopes: string[];
          status: UserOAuthStatus;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Relationships: [];
      };
    };
    Functions: {
      purge_expired_google_oauth_state_nonces: {
        Args: Record<string, never>;
        Returns: number;
      };
      create_life_entity_with_sync: {
        Args: {
          p_user_id: string;
          p_entity_type: LifeEntityType;
          p_title: string;
          p_description?: string | null;
          p_body?: string | null;
          p_domain?: string;
          p_status?: string;
          p_source?: string;
          p_source_command?: string | null;
          p_telegram_chat_id?: number | null;
          p_telegram_message_id?: number | null;
          p_due_at?: string | null;
          p_linked_table?: string | null;
          p_linked_id?: string | null;
          p_metadata?: Json;
          p_raw_payload?: Json;
          p_sync_operation?: string;
          p_sync_entity_type?: LifeEntityType | null;
          p_sync_action?: string;
          p_sync_target_path?: string | null;
          p_sync_payload?: Json;
        };
        Returns: {
          id: string;
          user_id: string;
          entity_type: LifeEntityType;
          domain: string;
          status: string;
          title: string;
          description: string | null;
          body: string | null;
          occurred_at: string;
          due_at: string | null;
          source: string;
          source_command: string | null;
          telegram_chat_id: number | null;
          telegram_message_id: number | null;
          linked_table: string | null;
          linked_id: string | null;
          metadata: Json;
          raw_payload_json: Json;
          created_at: string;
          updated_at: string;
        };
      };
    };
    Enums: {
      lifeos_project_status: LifeOSProjectStatus;
      lifeos_task_status: LifeOSTaskStatus;
      health_entry_source: HealthEntrySource;
      medication_log_status: MedicationLogStatus;
      workout_intensity: WorkoutIntensity;
      finance_account_type: FinanceAccountType;
      finance_transaction_type: FinanceTransactionType;
      finance_budget_period: FinanceBudgetPeriod;
      finance_reimbursement_status: FinanceReimbursementStatus;
      finance_receipt_status: FinanceReceiptStatus;
      life_entity_type: LifeEntityType;
      obsidian_sync_status: ObsidianSyncStatus;
      health_sync_reason: HealthSyncReason;
      health_recovery_mode: HealthMode;
      health_sync_run_status: HealthSyncRunStatus;
      profile_status: ProfileStatus;
      profile_role: ProfileRole;
      user_oauth_provider: UserOAuthProvider;
      user_oauth_status: UserOAuthStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}

export interface SupabaseConfig {
  url: string;
  anonKey?: string;
  serviceRoleKey?: string;
}

export interface CourseMatchCandidate {
  externalKey: string;
  suggestedStudyCourseId: string | null;
  confidence: "exact" | "fuzzy" | "none";
}
