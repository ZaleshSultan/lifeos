import type {
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

export type HealthSyncRunStatus = "success" | "failed";

export type ExternalSourceStatus = "disabled" | "connected" | "error";

export type SyncRunStatus = "running" | "success" | "partial" | "failed";

export type ReminderStatus =
  | "pending"
  | "processing"
  | "sent"
  | "cancelled"
  | "failed";

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

export type FinanceBudgetPeriod = "weekly" | "monthly" | "quarterly" | "yearly";

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
      finance_accounts: TableDefinition<
        {
          id: string;
          user_id: string;
          name: string;
          account_type: FinanceAccountType;
          currency: string;
          opening_balance: number;
          institution_name: string | null;
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
          merchant: string | null;
          description: string | null;
          external_ref: string | null;
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
          merchant?: string | null;
          description?: string | null;
          external_ref?: string | null;
          metadata?: Json;
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
          amount: number;
          currency: string;
          notes: string | null;
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
          amount: number;
          currency?: string;
          notes?: string | null;
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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      lifeos_project_status: LifeOSProjectStatus;
      lifeos_task_status: LifeOSTaskStatus;
      health_entry_source: HealthEntrySource;
      medication_log_status: MedicationLogStatus;
      workout_intensity: WorkoutIntensity;
      finance_account_type: FinanceAccountType;
      finance_transaction_type: FinanceTransactionType;
      finance_budget_period: FinanceBudgetPeriod;
      life_entity_type: LifeEntityType;
      obsidian_sync_status: ObsidianSyncStatus;
      health_sync_reason: HealthSyncReason;
      health_recovery_mode: HealthMode;
      health_sync_run_status: HealthSyncRunStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}

export interface SupabaseConfig {
  url: string;
  anonKey?: string;
  serviceRoleKey?: string;
}
