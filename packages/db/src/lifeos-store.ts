import {
  DEFAULT_FINANCE_CATEGORIES,
  DEFAULT_FINANCE_CURRENCY,
  aggregateMonthlyReviewStats,
  applyModeToFocusScoring,
  buildMonthlyReviewMarkdown,
  calculateHealthIngestDaily,
  explainModeReason,
  getModeLabel,
  healthModeLabel,
  parseLifeMode,
  redactFinanceText,
  monthlyReviewBounds,
  normalizeSourceEventToLifeEntity,
  normalizeFinanceCategory,
  resolveHealthMode,
  resolveCurrentMode as resolveCoreCurrentMode,
  scoreFocus,
  type FocusScoringItem,
  type HealthIngestPayload,
  type HealthMetricSource,
  type HealthMetricType,
  type HealthMetricsIngestPayload,
  type HealthMode,
  type LifeMode,
  type LifeModeProjectSprint,
  type LifeModeRecord,
  type LifeModeResolution,
  type LifeSeasonRecord,
  type ModeAwareFocusItem,
  type MonthlyReviewStats,
  type SourceEventLike,
  advanceNextDueDate,
  analyzeFinanceQuestion,
  buildFinanceReportRecommendations,
  detectFinanceAnomalies,
  extractReceiptOcrText,
  fetchDailyExchangeRates,
  financeReportPeriodBounds,
  interpretFinanceQuestion,
  normalizeFinanceBaseCurrency,
  parseReceiptText,
  previousFinanceReportPeriodBounds,
  validateReceiptParse,
  type FinanceAnomaly,
  type RecurringCadence,
  type BudgetCategorySummary,
  type BudgetSummary,
  type FinanceAssistantContext,
  type FinanceAssistantOptions,
  type FinanceAssistantResult,
  type FinanceReportData,
  type FinanceReportPeriod,
  type ReceiptParseResult,
  type TmaReceiptDisplayStatus,
  type CurrencyCode,
} from "@lifeos/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  ExternalSourceStatus,
  FinanceBudgetPeriod,
  FinanceTransactionStatus,
  FinanceTransactionType,
  FinanceReimbursementStatus,
  FinanceReceiptStatus,
  HealthSyncRunStatus,
  Json,
  LifeEntityType,
  ObsidianSyncStatus,
  ProfileRole,
  ProfileStatus,
  ReminderStatus,
  MonthlyReviewStatus,
  UserObsidianMode,
  UserObsidianStatus,
  SyncRunStatus,
  StudyCourseStatus,
  WorkoutIntensity,
} from "./types.js";

type LifeOSSupabaseClient = SupabaseClient<Database>;
type WorkoutRow = Database["public"]["Tables"]["workouts"]["Row"];
type WorkoutSetRow = Database["public"]["Tables"]["workout_sets"]["Row"];
type FitnessExerciseRow =
  Database["public"]["Tables"]["fitness_exercises"]["Row"];
type HealthDailyRow = Database["public"]["Tables"]["health_daily"]["Row"];
type HealthMetricRow = Database["public"]["Tables"]["health_metrics"]["Row"];
type LifeModeRow = Database["public"]["Tables"]["life_modes"]["Row"];
type LifeSeasonRow = Database["public"]["Tables"]["life_seasons"]["Row"];
type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];
type StudyCourseRow = Database["public"]["Tables"]["study_courses"]["Row"];
type ExternalSourceRow =
  Database["public"]["Tables"]["external_sources"]["Row"];
type SourceEventRow = Database["public"]["Tables"]["source_events"]["Row"];
type ReminderRow = Database["public"]["Tables"]["reminders"]["Row"];
type SyncRunRow = Database["public"]["Tables"]["sync_runs"]["Row"];
type AcademicRecordRow =
  Database["public"]["Tables"]["academic_records"]["Row"];
type FinanceAccountRow =
  Database["public"]["Tables"]["finance_accounts"]["Row"];
type FinanceCategoryRow =
  Database["public"]["Tables"]["finance_categories"]["Row"];
type FinanceTransactionRow =
  Database["public"]["Tables"]["finance_transactions"]["Row"];
type FinanceBudgetRow = Database["public"]["Tables"]["finance_budgets"]["Row"];
type FinanceBudgetCategoryRow =
  Database["public"]["Tables"]["finance_budget_categories"]["Row"];
type FinanceRecurringRuleRow =
  Database["public"]["Tables"]["finance_recurring_rules"]["Row"];
type FinanceTagRow = Database["public"]["Tables"]["finance_tags"]["Row"];
type FinanceReimbursementRow =
  Database["public"]["Tables"]["finance_reimbursements"]["Row"];
type FinanceReceiptRow =
  Database["public"]["Tables"]["finance_receipts"]["Row"];
type FinanceReceiptItemRow =
  Database["public"]["Tables"]["finance_receipt_items"]["Row"];
type FinanceAiAnalysisRunRow =
  Database["public"]["Tables"]["finance_ai_analysis_runs"]["Row"];
type MonthlyReviewRow = Database["public"]["Tables"]["monthly_reviews"]["Row"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type UserObsidianSettingsRow =
  Database["public"]["Tables"]["user_obsidian_settings"]["Row"];

export interface TelegramUserRecord {
  userId: string;
  telegramUserId: number | null;
  displayName: string | null;
  username: string | null;
  timezone: string;
  status: ProfileStatus;
  role: ProfileRole;
}

export interface BootstrapTelegramUserInput {
  userId: string;
  telegramUserId: number;
  displayName?: string | null;
  timezone?: string;
  locale?: string;
}

export interface CreatePendingTelegramUserInput {
  telegramUserId: number;
  displayName?: string | null;
  username?: string | null;
  timezone?: string;
  locale?: string;
}

export interface TelegramProfileRecord extends TelegramUserRecord {
  createdAt: string;
  updatedAt: string;
}

export interface LifeEntityRecord {
  id: string;
  userId: string;
  entityType: LifeEntityType;
  domain?: string;
  status?: string;
  title: string;
  description?: string | null;
  body: string | null;
  source?: string;
  sourceCommand?: string | null;
  telegramChatId?: number | null;
  telegramMessageId?: number | null;
  dueAt: string | null;
  linkedTable: string | null;
  linkedId: string | null;
  metadata?: Json;
  rawPayloadJson?: Json;
  createdAt: string;
}

export interface CreateLifeEntityInput {
  userId: string;
  entityType: LifeEntityType;
  domain?: string;
  status?: string;
  title: string;
  description?: string | null;
  body?: string | null;
  occurredAt?: string;
  dueAt?: string | null;
  source?: string;
  sourceCommand?: string | null;
  telegramChatId?: number | null;
  telegramMessageId?: number | null;
  linkedTable?: string | null;
  linkedId?: string | null;
  metadata?: Json;
  rawPayloadJson?: Json;
}

export interface LifeCaptureRecord {
  id: string;
  userId: string;
  text: string;
  source: string;
  status: string;
  chatId: number | null;
  createdAt: string;
}

export interface CreateLifeCaptureInput {
  userId: string;
  text: string;
  source?: string;
  status?: string;
  chatId?: number | null;
  messageId?: number | null;
  metadata?: Json;
}

export interface CreateTaskInput {
  userId: string;
  title: string;
  notes?: string | null;
  dueAt?: string | null;
  source?: string | null;
  metadata?: Json;
}

export interface TaskRecord {
  id: string;
  title: string;
  dueAt: string | null;
}

export interface DailyLogRecord {
  moodScore: number | null;
  energyScore: number | null;
  focusScore: number | null;
  notes: string | null;
}

export interface WorkoutRecord {
  id: string;
  title: string | null;
  startedAt: string;
  created: boolean;
}

export interface SetManualModeInput {
  userId: string;
  mode: LifeMode;
  reason?: string | null;
  activeFrom?: string | null;
  activeUntil?: string | null;
  priorityJson?: Record<string, number>;
}

export type SetManualLifeModeInput = SetManualModeInput;

export interface StudyCourseRecord {
  id: string;
  userId: string;
  code: string;
  title: string;
  term: string | null;
  startsOn: string | null;
  endsOn: string | null;
  status: StudyCourseStatus;
  progressPercent: number;
  completedUnits: number;
  totalUnits: number | null;
  lastStudiedOn: string | null;
  metadata: Json;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateStudyCourseProgressInput {
  userId: string;
  courseId?: string;
  code?: string;
  progressPercent: number;
  completedUnits?: number | null;
  totalUnits?: number | null;
  lastStudiedOn?: string | null;
  status?: StudyCourseStatus;
  metadata?: Json;
}

export interface SourceRecord {
  id: string;
  userId: string;
  sourceKey: string;
  sourceType: string;
  displayName: string;
  status: ExternalSourceStatus;
  configJson: Json;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertExternalSourceInput {
  sourceKey: string;
  sourceType: string;
  displayName: string;
  status?: ExternalSourceStatus;
  configJson?: Json;
  lastSyncAt?: string | null;
}

export interface UserObsidianSettings {
  userId: string;
  enabled: boolean;
  mode: UserObsidianMode;
  vaultPath: string | null;
  status: UserObsidianStatus;
  metadata: Json;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertUserObsidianSettingsInput {
  enabled?: boolean;
  mode?: UserObsidianMode;
  vaultPath?: string | null;
  status?: UserObsidianStatus;
  metadata?: Json;
}

export interface SourceEventRecord {
  id: string;
  userId: string;
  sourceKey: string;
  externalId: string | null;
  eventType: string;
  title: string | null;
  description: string | null;
  location: string | null;
  startsAt: string | null;
  endsAt: string | null;
  dueAt: string | null;
  status: string;
  rawJson: Json;
  normalizedEntityId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertSourceEventInput {
  userId: string;
  sourceKey: string;
  externalId?: string | null;
  eventType: string;
  title?: string | null;
  description?: string | null;
  location?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  dueAt?: string | null;
  status?: string;
  rawJson?: Json;
  normalizedEntityId?: string | null;
}

export interface ListSourceEventsFilters {
  sourceKey?: string;
  status?: string;
  eventType?: string;
  before?: string;
  after?: string;
  limit?: number;
}

export interface CreateReminderInput {
  userId: string;
  lifeEntityId?: string | null;
  sourceEventId?: string | null;
  channel?: string;
  remindAt: string;
  message: string;
  metadataJson?: Json;
}

export type ReminderMode = "chill" | "normal" | "duolingo" | "war";

export interface ReminderRecord {
  id: string;
  userId: string;
  lifeEntityId: string | null;
  sourceEventId: string | null;
  channel: string;
  remindAt: string;
  status: ReminderStatus;
  message: string;
  metadataJson: Json;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncRunRecord {
  id: string;
  userId: string;
  sourceId: string | null;
  sourceKey: string;
  status: SyncRunStatus;
  startedAt: string;
  finishedAt: string | null;
  recordsSeen: number;
  recordsCreated: number;
  recordsUpdated: number;
  errorMessage: string | null;
  metadataJson: Json;
}

export interface AcademicRecord {
  id: string;
  userId: string;
  sourceEventId: string | null;
  courseTitle: string;
  recordType: string;
  title: string;
  valueText: string | null;
  score: number | null;
  maxScore: number | null;
  percentage: number | null;
  occursAt: string | null;
  dueAt: string | null;
  rawJson: Json;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertAcademicRecordInput {
  userId: string;
  sourceEventId?: string | null;
  courseTitle: string;
  recordType: string;
  title: string;
  valueText?: string | null;
  score?: number | null;
  maxScore?: number | null;
  percentage?: number | null;
  occursAt?: string | null;
  dueAt?: string | null;
  rawJson?: Json;
}

export interface FocusItemRecord extends FocusScoringItem {
  id: string;
  sourceType: "task" | "life_entity";
  title: string;
  dueAt: string | null;
  metadata: Record<string, unknown>;
}

export type ModeAwareFocusItemRecord = ModeAwareFocusItem<FocusItemRecord>;

export interface WorkoutSetSummary {
  id: string;
  index: number;
  targetReps: number | null;
  targetWeightKg: number | null;
  completed: boolean;
  completedAt: string | null;
}

export interface WorkoutExerciseSummary {
  id: string;
  name: string;
  note: string | null;
  sets: WorkoutSetSummary[];
}

export interface CurrentWorkoutSummary {
  id: string;
  title: string;
  mode: string;
  startedAt: string;
  progressPercent: number;
  completedSets: number;
  totalSets: number;
  restTimerEndsAt: string | null;
  exercises: WorkoutExerciseSummary[];
}

export interface ObsidianSyncStatusSummary {
  counts: Partial<Record<ObsidianSyncStatus, number>>;
}

export interface HealthSyncStatusSummary {
  counts: Partial<Record<HealthSyncRunStatus, number>>;
  runs: Array<{
    id: string;
    syncDate: string;
    syncReason: string;
    status: HealthSyncRunStatus;
    dataCompletenessScore: number | null;
    missingMetrics: Record<string, boolean>;
    completedAt: string | null;
    error: string | null;
  }>;
  latestRun: {
    id: string;
    syncDate: string;
    syncReason: string;
    status: HealthSyncRunStatus;
    dataCompletenessScore: number | null;
    missingMetrics: Record<string, boolean>;
    completedAt: string | null;
    error: string | null;
  } | null;
}

export interface FinanceSummary {
  capturedSpendCount: number;
  capturedSpendTotal: number | null;
}

export interface FinanceCategoryRecord {
  id: string;
  name: string;
  transactionType: FinanceTransactionType;
}

export interface FinanceTransactionRecord {
  id: string;
  shortId: string;
  userId: string;
  accountId: string;
  categoryId: string | null;
  categoryName: string | null;
  transactionType: FinanceTransactionType;
  status: FinanceTransactionStatus;
  occurredOn: string;
  amount: number;
  currency: string;
  baseAmount: number | null;
  baseCurrency: string;
  exchangeRate: number | null;
  exchangeRateDate: string | null;
  merchant: string | null;
  description: string | null;
  tags: string[];
  receiptId: string | null;
  rawText: string | null;
  confidence: number | null;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface FinancePeriodSummary {
  amount: number;
  count: number;
}

export interface TmaMonthlySummary {
  income: number;
  expense: number;
  net: number;
}

export interface TmaReceiptSummary {
  id: string;
  status: FinanceReceiptStatus;
  displayStatus: TmaReceiptDisplayStatus;
  fileName: string | null;
  amount: number | null;
  currency: string | null;
  merchant: string | null;
  transactionId: string | null;
  errorMessage: string | null;
  createdAt: string;
  processedAt: string | null;
}

export interface TmaFinanceSummary {
  currency: string;
  baseCurrency: string;
  today: FinancePeriodSummary;
  week: FinancePeriodSummary;
  month: FinancePeriodSummary;
  monthlySummary: TmaMonthlySummary;
  topCategories: Array<{
    category: string;
    amount: number;
    count: number;
  }>;
  budgets: BudgetSummary[];
  recentTransactions: FinanceTransactionRecord[];
  recentExpenses: FinanceTransactionRecord[];
  recentIncome: FinanceTransactionRecord[];
  recentReceipts: TmaReceiptSummary[];
  anomalies: FinanceAnomaly[];
  recommendations: string[];
  drafts: FinanceTransactionRecord[];
}

export interface MonthlyReviewRecord {
  id: string;
  userId: string;
  periodMonth: string;
  status: MonthlyReviewStatus;
  reportTitle: string | null;
  reportMarkdown: string;
  aiModel: string | null;
  aiInputJson: Json;
  aiOutputJson: Json;
  statsJson: Json;
  obsidianPath: string | null;
  generatedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TmaMonthlyReviewSummary {
  latest: MonthlyReviewRecord | null;
}

export interface CreateFinanceTransactionInput {
  userId: string;
  transactionType: "expense" | "income";
  accountId?: string;
  amount: number;
  currency?: string;
  baseCurrency?: string;
  baseAmount?: number | null;
  exchangeRate?: number | null;
  exchangeRateDate?: string | null;
  categoryId?: string | null;
  category?: string | null;
  merchant?: string | null;
  description?: string | null;
  tags?: string[];
  receiptId?: string | null;
  occurredOn: string;
  status?: FinanceTransactionStatus;
  rawText?: string | null;
  confidence?: number | null;
  source?: string;
  parseRunId?: string | null;
  metadata?: Json;
}

export interface UpdateFinanceTransactionInput {
  userId: string;
  shortId: string;
  status?: FinanceTransactionStatus;
  amount?: number;
  category?: string;
  merchant?: string | null;
  description?: string | null;
  tags?: string[];
}

export interface FinanceBudgetCategoryLimit {
  categoryId: string;
  limit: number;
  currency?: string;
}

export interface FinanceBudgetRecord {
  id: string;
  userId: string;
  categoryId: string | null;
  categoryName: string | null;
  period: FinanceBudgetPeriod;
  periodStart: string;
  periodEnd: string | null;
  amount: number;
  currency: string;
  name: string | null;
  notes: string | null;
  isActive: boolean;
  archivedAt: string | null;
  categoryLimits: FinanceBudgetCategoryLimit[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBudgetInput {
  userId: string;
  categoryId?: string | null;
  categoryLimits?: FinanceBudgetCategoryLimit[];
  period?: FinanceBudgetPeriod;
  periodStart: string;
  periodEnd?: string | null;
  amount: number;
  currency?: string;
  name?: string | null;
  notes?: string | null;
}

export interface UpdateBudgetInput {
  userId: string;
  budgetId: string;
  amount?: number;
  name?: string | null;
  notes?: string | null;
  isActive?: boolean;
  periodEnd?: string | null;
  categoryLimits?: FinanceBudgetCategoryLimit[];
  metadata?: Record<string, unknown>;
}

export interface FinanceRecurringRuleRecord {
  id: string;
  userId: string;
  accountId: string;
  categoryId: string | null;
  categoryName: string | null;
  transactionType: FinanceTransactionType;
  amount: number;
  currency: string;
  cadence: string;
  startsOn: string;
  endsOn: string | null;
  nextDueOn: string | null;
  merchant: string | null;
  description: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRecurringRuleInput {
  userId: string;
  transactionType?: FinanceTransactionType;
  amount: number;
  currency?: string;
  cadence: RecurringCadence;
  startsOn: string;
  endsOn?: string | null;
  merchant?: string | null;
  description?: string | null;
  categoryName?: string | null;
  categoryId?: string | null;
}

export interface FinanceTagRecord {
  id: string;
  userId: string;
  name: string;
  color: string | null;
  createdAt: string;
}

export interface FinanceReimbursementRecord {
  id: string;
  userId: string;
  transactionId: string;
  originalAmount: number;
  reimbursedAmount: number;
  remaining: number;
  currency: string;
  status: string;
  reimbursedBy: string | null;
  notes: string | null;
  reimbursedAt: string | null;
  createdAt: string;
}

export interface CreateReimbursementInput {
  userId: string;
  transactionId: string;
  amount: number;
  reimbursedBy?: string | null;
  notes?: string | null;
}

export interface FinanceReceiptRecord {
  id: string;
  userId: string;
  storagePath: string;
  fileName: string | null;
  mimeType: string | null;
  ocrJson: Json;
  parsedJson: Json;
  ocrText: string | null;
  openRouterModel: string | null;
  processedAt: string | null;
  status: FinanceReceiptStatus;
  transactionId: string | null;
  errorMessage: string | null;
  items: FinanceReceiptItemRecord[];
  createdAt: string;
}

export interface FinanceReceiptItemRecord {
  id: string;
  userId: string;
  receiptId: string;
  name: string;
  quantity: number;
  unitPrice: number | null;
  totalAmount: number | null;
  currency: string;
  createdAt: string;
}

export interface CreateReceiptInput {
  userId: string;
  storagePath: string;
  fileName?: string | null;
  mimeType?: string | null;
  ocrJson?: Json;
  metadata?: Json;
}

export interface ProcessReceiptOcrTextInput {
  userId: string;
  receiptId: string;
  ocrText: string;
  ai?: FinanceAssistantOptions;
}

export interface UploadReceiptImageInput {
  userId: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface ProcessReceiptImageInput extends UploadReceiptImageInput {
  ocrText?: string;
  ai?: FinanceAssistantOptions;
}

export interface FinanceAiAnalysisRunRecord {
  id: string;
  userId: string;
  requestType: string;
  prompt: string;
  inputJson: Json;
  outputJson: Json;
  model: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
}

export interface FinanceExportResult {
  fileName: string;
  contentType: string;
  body: string | Uint8Array;
}

export interface HealthIngestResult {
  healthDailyId: string;
  lifeEntityId: string;
  syncRunId: string;
  date: string;
  recoveryMode: string;
  dataCompletenessScore: number;
  workoutsUpserted: number;
  samplesInserted: number;
}

// ---------------------------------------------------------------------------
// Finance V2 types — Bank lines, receipt scans, budget summary payloads
// ---------------------------------------------------------------------------

export type BankLineStatus = "unmatched" | "matched";

export interface BankLineRecord {
  id: string;
  userId: string;
  amount: number;
  currency: string;
  description: string | null;
  bookingDate: string;
  status: BankLineStatus;
  matchedEntityId: string | null;
  shortId: string;
  merchant: string | null;
  source: string;
  createdAt: string;
}

export interface ReceiptScanRecord {
  id: string;
  userId: string;
  storagePath: string;
  status: FinanceReceiptStatus;
  extractedAmount: number | null;
  extractedCurrency: string | null;
  extractedCategory: string | null;
  matchedEntityId: string | null;
  fileName: string | null;
  mimeType: string | null;
  createdAt: string;
}

export interface BudgetSummaryPayload {
  budgetId: string;
  name: string | null;
  category: string;
  period: FinanceBudgetPeriod;
  periodStart: string;
  periodEnd: string;
  limitAmount: number;
  actualSpent: number;
  remainingBalance: number;
  percentUsed: number;
  isOverspent: boolean;
  rolloverEnabled: boolean;
  currency: string;
}

export interface TmaHomeSummary {
  displayName?: string;
  localDate: string;
  mode: LifeMode;
  modeLabel: string;
  modeReason: string;
  recoveryMode: HealthMode;
  focusScore: number | null;
  activeWorkout: {
    id: string;
    title: string;
    startedAt: string;
    progressPercent: number;
  } | null;
  healthCompletenessScore: number | null;
  pendingSyncCount: number;
  obsidianStatus: TmaObsidianStatus;
}

export interface TmaObsidianStatus {
  enabled: boolean;
  status: UserObsidianStatus;
  mode: UserObsidianMode;
  configured: boolean;
  updatedAt: string | null;
  pendingSyncCount: number;
}

export interface TmaHealthSummary {
  date: string;
  lifeMode: LifeMode;
  lifeModeLabel: string;
  recommendation: string;
  recoveryMode: HealthMode;
  dataCompletenessScore: number;
  sleepMinutes: number | null;
  deepSleepMinutes: number | null;
  remSleepMinutes: number | null;
  awakeMinutes: number | null;
  restingHeartRate: number | null;
  hrvMs: number | null;
  spo2Avg: number | null;
  steps: number | null;
  activeEnergyKcal: number | null;
  missingMetrics: Record<string, boolean>;
  samplesCount: number;
  hasMetrics: boolean;
  sourceLabel: string | null;
  latestSource: string | null;
  averageHeartRate: number | null;
  totalEnergyKcal: number | null;
  workoutMinutes: number | null;
  distanceM: number | null;
  weightKg: number | null;
  sleepScore: number | null;
  stressScore: number | null;
  moodScore: number | null;
  energyScore: number | null;
  weekly: HealthMetricWeekSummary;
  trends: HealthMetricTrendDay[];
  sources: HealthMetricSourceStatus[];
}

export interface HealthMetricRecord {
  id: string;
  userId: string;
  metricDate: string;
  metricType: HealthMetricType;
  value: number;
  unit: string | null;
  source: HealthMetricSource;
  confidence: number | null;
  rawJson: Json;
  createdAt: string;
  updatedAt: string;
}

export type HealthMetricValues = Partial<Record<HealthMetricType, number>>;

export interface HealthMetricDaySummary {
  date: string;
  metrics: HealthMetricValues;
  sources: string[];
  sourceLabel: string | null;
  latestSource: string | null;
  missingMetrics: Record<string, boolean>;
  records: HealthMetricRecord[];
}

export interface HealthMetricTrendDay {
  date: string;
  steps: number | null;
  sleepMinutes: number | null;
  restingHeartRate: number | null;
  activeEnergyKcal: number | null;
  workoutMinutes: number | null;
}

export interface HealthMetricWeekSummary {
  startDate: string;
  endDate: string;
  avgSteps: number | null;
  avgSleepMinutes: number | null;
  avgRestingHeartRate: number | null;
  totalWorkoutMinutes: number;
  missingDays: string[];
}

export interface HealthMetricSourceStatus {
  source: string;
  label: string;
  latestMetricAt: string | null;
}

export interface HealthMetricsIngestResult {
  date: string;
  source: HealthMetricSource;
  created: number;
  updated: number;
  metrics: HealthMetricRecord[];
}

export interface TmaFocusSummary {
  score: number;
  band: "low" | "medium" | "high";
  mode: HealthMode;
  lifeMode: LifeMode;
  lifeModeLabel: string;
  lifeModeReason: string;
  reasons: string[];
  nextBestAction: string | null;
  openTaskCount: number;
  topItems: ModeAwareFocusItemRecord[];
  priorityWeights: Record<string, number>;
}

export interface TmaSourcesSummary {
  sources: SourceRecord[];
  sourceEvents: SourceEventRecord[];
  reminders: ReminderRecord[];
  syncRuns: SyncRunRecord[];
}

export interface TmaAcademicSummary {
  currentMode: LifeModeResolution;
  nextAcademicEvent: SourceEventRecord | null;
  finals: SourceEventRecord[];
  examfx: SourceEventRecord[];
  activeCourse: StudyCourseRecord | null;
  summerCourse: StudyCourseRecord | null;
  nextTransition: LifeSeasonRecord | null;
  academicRecords: AcademicRecord[];
}

export interface LifeOSStore {
  resolveTelegramUser(
    telegramUserId: number,
  ): Promise<TelegramUserRecord | null>;
  linkDefaultTelegramUser(
    input: BootstrapTelegramUserInput,
  ): Promise<TelegramUserRecord>;
  createPendingTelegramUser(
    input: CreatePendingTelegramUserInput,
  ): Promise<TelegramUserRecord>;
  listPendingUsers(): Promise<TelegramProfileRecord[]>;
  listTelegramUsers(limit?: number): Promise<TelegramProfileRecord[]>;
  approveTelegramUser(
    telegramUserId: number,
    approvedByTelegramUserId?: number,
  ): Promise<TelegramUserRecord | null>;
  blockTelegramUser(telegramUserId: number): Promise<TelegramUserRecord | null>;
  isAdminTelegramUser(telegramUserId: number): Promise<boolean>;
  createTask(input: CreateTaskInput): Promise<TaskRecord>;
  createLifeCapture(input: CreateLifeCaptureInput): Promise<LifeCaptureRecord>;
  createLifeEntity(input: CreateLifeEntityInput): Promise<LifeEntityRecord>;
  enqueueObsidianSync(input: {
    userId: string;
    lifeEntityId: string;
    entityType?: LifeEntityType;
    action?: string;
    targetPath?: string | null;
    payload?: Json;
    payloadJson?: Json;
  }): Promise<void>;
  listTodayEntities(input: {
    userId: string;
    dayStart: string;
    dayEnd: string;
  }): Promise<LifeEntityRecord[]>;
  getLatestDailyLog(userId: string): Promise<DailyLogRecord | null>;
  getObsidianSyncStatus(userId: string): Promise<ObsidianSyncStatusSummary>;
  getUserObsidianSettings(
    userId: string,
  ): Promise<UserObsidianSettings | null>;
  upsertUserObsidianSettings(
    userId: string,
    input: UpsertUserObsidianSettingsInput,
  ): Promise<UserObsidianSettings>;
  isObsidianEnabledForUser(userId: string): Promise<boolean>;
  getHealthSyncStatus(userId: string): Promise<HealthSyncStatusSummary>;
  getActiveManualMode(
    userId: string,
    now?: Date | string,
  ): Promise<LifeModeRecord | null>;
  getActiveSeason(
    userId: string,
    today?: Date | string,
  ): Promise<LifeSeasonRecord | null>;
  getActiveStudyCourse(
    userId: string,
    today?: Date | string,
  ): Promise<StudyCourseRecord | null>;
  updateStudyCourseProgress(
    input: UpdateStudyCourseProgressInput,
  ): Promise<StudyCourseRecord>;
  resolveCurrentMode(userId: string): Promise<LifeModeResolution>;
  setManualMode(input: SetManualModeInput): Promise<LifeModeResolution>;
  clearManualMode(userId: string): Promise<LifeModeResolution>;
  setManualLifeMode(input: SetManualLifeModeInput): Promise<LifeModeResolution>;
  clearManualLifeMode(userId: string): Promise<LifeModeResolution>;
  listModeAwareFocusItems(input: {
    userId: string;
    mode: LifeMode;
    limit?: number;
  }): Promise<ModeAwareFocusItemRecord[]>;
  getOrCreateCurrentWorkout(input: {
    userId: string;
    title?: string | null;
    now: string;
    lifeMode?: LifeMode;
  }): Promise<WorkoutRecord>;
  getCurrentWorkout(input: {
    userId: string;
    workoutId?: string;
  }): Promise<CurrentWorkoutSummary | null>;
  completeWorkoutSet(input: {
    userId: string;
    setId: string;
    completedAt: string;
  }): Promise<CurrentWorkoutSummary>;
  undoWorkoutSet(input: {
    userId: string;
    setId: string;
  }): Promise<CurrentWorkoutSummary>;
  completeWorkout(input: {
    userId: string;
    workoutId: string;
    completedAt: string;
  }): Promise<CurrentWorkoutSummary>;
  getTmaHomeSummary(user: TelegramUserRecord): Promise<TmaHomeSummary>;
  getTmaHealthSummary(userId: string): Promise<TmaHealthSummary>;
  getHealthMetricDay(
    userId: string,
    date: string,
  ): Promise<HealthMetricDaySummary>;
  getHealthMetricWeek(
    userId: string,
    endDate: string,
  ): Promise<HealthMetricWeekSummary & { trends: HealthMetricTrendDay[] }>;
  getHealthMetricSources(userId: string): Promise<HealthMetricSourceStatus[]>;
  upsertHealthMetrics(
    input: HealthMetricsIngestPayload,
  ): Promise<HealthMetricsIngestResult>;
  getTmaFocusSummary(userId: string): Promise<TmaFocusSummary>;
  getTmaSourcesSummary(userId: string): Promise<TmaSourcesSummary>;
  getTmaAcademicSummary(userId: string): Promise<TmaAcademicSummary>;
  upsertExternalSource(
    userId: string,
    source: UpsertExternalSourceInput,
  ): Promise<SourceRecord>;
  listExternalSources(userId: string): Promise<SourceRecord[]>;
  createSyncRun(userId: string, sourceKey: string): Promise<SyncRunRecord>;
  finishSyncRun(
    syncRunId: string,
    status: SyncRunStatus,
    stats?: {
      recordsSeen?: number;
      recordsCreated?: number;
      recordsUpdated?: number;
      errorMessage?: string | null;
      metadataJson?: Json;
    },
  ): Promise<SyncRunRecord>;
  upsertSourceEvent(input: UpsertSourceEventInput): Promise<SourceEventRecord>;
  listSourceEvents(
    userId: string,
    filters?: ListSourceEventsFilters,
  ): Promise<SourceEventRecord[]>;
  normalizeSourceEvent(
    userId: string,
    sourceEventId: string,
  ): Promise<LifeEntityRecord>;
  createReminder(input: CreateReminderInput): Promise<ReminderRecord>;
  listPendingReminders(
    userId: string,
    before: string,
  ): Promise<ReminderRecord[]>;
  listUpcomingReminders(
    userId: string,
    limit?: number,
  ): Promise<ReminderRecord[]>;
  markReminderSent(reminderId: string): Promise<ReminderRecord>;
  cancelReminder(userId: string, reminderId: string): Promise<ReminderRecord>;
  snoozeReminder(
    userId: string,
    reminderId: string,
    remindAt: string,
  ): Promise<ReminderRecord>;
  getReminderMode(userId: string): Promise<ReminderMode>;
  setReminderMode(userId: string, mode: ReminderMode): Promise<ReminderMode>;
  listAcademicRecords(userId: string): Promise<AcademicRecord[]>;
  upsertAcademicRecord(
    input: UpsertAcademicRecordInput,
  ): Promise<AcademicRecord>;
  getFinanceSummary(input: {
    userId: string;
    since: string;
  }): Promise<FinanceSummary>;
  createFinanceTransaction(
    input: CreateFinanceTransactionInput,
  ): Promise<FinanceTransactionRecord>;
  updateFinanceTransaction(
    input: UpdateFinanceTransactionInput,
  ): Promise<FinanceTransactionRecord>;
  listFinanceCategories(userId: string): Promise<FinanceCategoryRecord[]>;
  getTmaFinanceSummary(input: {
    userId: string;
    today: string;
  }): Promise<TmaFinanceSummary>;
  recordFinanceParseRun(input: {
    userId: string;
    inputText: string;
    parsedJson: Json;
    status: string;
    parser: string;
    confidence?: number | null;
    transactionId?: string | null;
    errorMessage?: string | null;
  }): Promise<void>;

  // Budget methods
  createBudget(input: CreateBudgetInput): Promise<FinanceBudgetRecord>;
  updateBudget(input: UpdateBudgetInput): Promise<FinanceBudgetRecord>;
  deleteBudget(userId: string, budgetId: string): Promise<void>;
  archiveBudget(userId: string, budgetId: string): Promise<FinanceBudgetRecord>;
  listBudgets(input: {
    userId: string;
    period?: FinanceBudgetPeriod;
    activeOnly?: boolean;
  }): Promise<FinanceBudgetRecord[]>;
  getBudgetSummary(input: {
    userId: string;
    today: string;
  }): Promise<BudgetSummary[]>;

  // Recurring rule methods
  createRecurringRule(
    input: CreateRecurringRuleInput,
  ): Promise<FinanceRecurringRuleRecord>;
  updateRecurringRule(input: {
    userId: string;
    ruleId: string;
    amount?: number;
    cadence?: RecurringCadence;
    active?: boolean;
    description?: string | null;
  }): Promise<FinanceRecurringRuleRecord>;
  deleteRecurringRule(userId: string, ruleId: string): Promise<void>;
  listRecurringRules(userId: string): Promise<FinanceRecurringRuleRecord[]>;
  processDueRecurringRules(
    userId: string,
    today: string,
  ): Promise<FinanceTransactionRecord[]>;

  // Tag methods
  createTag(
    userId: string,
    name: string,
    color?: string,
  ): Promise<FinanceTagRecord>;
  listTags(userId: string): Promise<FinanceTagRecord[]>;
  deleteTag(userId: string, tagId: string): Promise<void>;
  addTransactionTags(
    userId: string,
    transactionId: string,
    tagIds: string[],
  ): Promise<void>;
  removeTransactionTags(
    userId: string,
    transactionId: string,
    tagIds: string[],
  ): Promise<void>;

  // Reimbursement methods
  createReimbursement(
    input: CreateReimbursementInput,
  ): Promise<FinanceReimbursementRecord>;
  listReimbursements(
    userId: string,
    status?: FinanceReimbursementStatus,
  ): Promise<FinanceReimbursementRecord[]>;

  // Receipt methods
  createReceipt(input: CreateReceiptInput): Promise<FinanceReceiptRecord>;
  uploadReceiptImage(
    input: UploadReceiptImageInput,
  ): Promise<FinanceReceiptRecord>;
  processReceiptImage(
    input: ProcessReceiptImageInput,
  ): Promise<FinanceReceiptRecord>;
  processReceiptOcrText(
    input: ProcessReceiptOcrTextInput,
  ): Promise<FinanceReceiptRecord>;
  listReceipts(userId: string): Promise<FinanceReceiptRecord[]>;
  getReceipt(
    userId: string,
    receiptId: string,
  ): Promise<FinanceReceiptRecord | null>;
  downloadReceiptImage(
    userId: string,
    receiptId: string,
  ): Promise<{ bytes: Buffer; mimeType: string }>;
  reviewFinanceReceipt(input: {
    userId: string;
    receiptId: string;
    amount: number;
    currency: CurrencyCode;
    merchant: string;
    date: string;
    category: string;
  }): Promise<FinanceReceiptRecord>;

  getTelegramUserId(userId: string): Promise<number | null>;
  processFinanceAlerts(userId: string, today: string): Promise<string[]>;
  backfillFinanceBaseAmounts(input?: { userId?: string }): Promise<number>;

  getFinanceBaseCurrency(userId: string): Promise<string>;
  setFinanceBaseCurrency(userId: string, currency: string): Promise<string>;
  syncFinanceExchangeRates(input?: {
    fetchImpl?: typeof fetch;
  }): Promise<number>;
  detectFinanceAnomaliesForUser(input: {
    userId: string;
    today: string;
  }): Promise<FinanceAnomaly[]>;
  buildFinanceAssistantContext(input: {
    userId: string;
    today: string;
  }): Promise<FinanceAssistantContext & { anomalies: FinanceAnomaly[] }>;
  askFinanceAssistant(input: {
    userId: string;
    question: string;
    today: string;
    ai?: FinanceAssistantOptions;
  }): Promise<FinanceAssistantResult>;

  // Report methods
  getFinanceReport(input: {
    userId: string;
    period: FinanceReportPeriod;
    startDate: string;
    endDate: string;
  }): Promise<FinanceReportData>;
  answerFinanceQuestion(input: {
    userId: string;
    question: string;
    context: FinanceAssistantContext;
    ai?: FinanceAssistantOptions;
  }): Promise<FinanceAssistantResult>;
  recordFinanceAiAnalysisRun(input: {
    userId: string;
    requestType: string;
    prompt: string;
    inputJson: Json;
    outputJson?: Json;
    model?: string | null;
    status?: "pending" | "completed" | "failed";
    errorMessage?: string | null;
  }): Promise<FinanceAiAnalysisRunRecord>;
  exportFinanceReport(input: {
    userId: string;
    period: FinanceReportPeriod;
    startDate: string;
    endDate: string;
    format: "csv" | "xlsx" | "pdf";
  }): Promise<FinanceExportResult>;

  generateMonthlyReview(input: {
    userId: string;
    periodMonth: string;
    regenerate?: boolean;
  }): Promise<MonthlyReviewRecord>;
  getMonthlyReview(
    userId: string,
    periodMonth: string,
  ): Promise<MonthlyReviewRecord | null>;
  getLatestMonthlyReview(userId: string): Promise<MonthlyReviewRecord | null>;
  getTmaMonthlyReviewSummary(userId: string): Promise<TmaMonthlyReviewSummary>;
  ingestHealthPayload(
    payload: HealthIngestPayload,
  ): Promise<HealthIngestResult>;

  // Finance V2 — Bank line reconciliation
  listUnmatchedBankLines(
    userId: string,
    tenantId: string,
  ): Promise<BankLineRecord[]>;
  reconcileBankLine(
    userId: string,
    lineId: string,
    entityId: string,
  ): Promise<void>;

  // Finance V2 — Budget periods with rollover
  getActiveBudgetsWithPeriods(
    userId: string,
    tenantId: string,
    currentDate: string,
  ): Promise<BudgetSummaryPayload[]>;

  // Finance V2 — Receipt scan jobs
  createReceiptScanJob(
    userId: string,
    tenantId: string,
    storagePath: string,
  ): Promise<ReceiptScanRecord>;

  // Finance V2 — Budget limit management
  updateBudgetLimit(
    userId: string,
    tenantId: string,
    category: string,
    amount: number,
    periodType: string,
  ): Promise<void>;
}

type WorkoutPlan = ReadonlyArray<{
  name: string;
  category: string;
  equipment: string;
  sets: ReadonlyArray<{
    reps: number;
    weightKg: number | null;
    restSeconds: number;
  }>;
}>;

const DEFAULT_WORKOUT_PLAN = [
  {
    name: "Push-up",
    category: "strength",
    equipment: "bodyweight",
    sets: [
      { reps: 10, weightKg: null, restSeconds: 90 },
      { reps: 10, weightKg: null, restSeconds: 90 },
      { reps: 8, weightKg: null, restSeconds: 90 },
    ],
  },
  {
    name: "Bodyweight Squat",
    category: "strength",
    equipment: "bodyweight",
    sets: [
      { reps: 12, weightKg: null, restSeconds: 90 },
      { reps: 12, weightKg: null, restSeconds: 90 },
      { reps: 12, weightKg: null, restSeconds: 90 },
    ],
  },
  {
    name: "Dumbbell Row",
    category: "strength",
    equipment: "dumbbell",
    sets: [
      { reps: 10, weightKg: 12, restSeconds: 90 },
      { reps: 10, weightKg: 12, restSeconds: 90 },
      { reps: 10, weightKg: 12, restSeconds: 90 },
    ],
  },
] as const;

const RECOVERY_WORKOUT_PLAN = [
  {
    name: "Mobility Flow",
    category: "mobility",
    equipment: "bodyweight",
    sets: [
      { reps: 8, weightKg: null, restSeconds: 45 },
      { reps: 8, weightKg: null, restSeconds: 45 },
    ],
  },
  {
    name: "Easy Walk",
    category: "cardio",
    equipment: "bodyweight",
    sets: [{ reps: 1, weightKg: null, restSeconds: 60 }],
  },
] as const satisfies WorkoutPlan;

const EXAM_WAR_WORKOUT_PLAN = [
  {
    name: "Push-up",
    category: "strength",
    equipment: "bodyweight",
    sets: [
      { reps: 8, weightKg: null, restSeconds: 60 },
      { reps: 8, weightKg: null, restSeconds: 60 },
    ],
  },
  {
    name: "Bodyweight Squat",
    category: "strength",
    equipment: "bodyweight",
    sets: [
      { reps: 10, weightKg: null, restSeconds: 60 },
      { reps: 10, weightKg: null, restSeconds: 60 },
    ],
  },
] as const satisfies WorkoutPlan;

function toLifeEntityRecord(
  row: Database["public"]["Tables"]["life_entities"]["Row"],
): LifeEntityRecord {
  return {
    id: row.id,
    userId: row.user_id,
    entityType: row.entity_type,
    domain: row.domain,
    status: row.status,
    title: row.title,
    description: row.description,
    body: row.body,
    source: row.source,
    sourceCommand: row.source_command,
    telegramChatId: row.telegram_chat_id,
    telegramMessageId: row.telegram_message_id,
    dueAt: row.due_at,
    linkedTable: row.linked_table,
    linkedId: row.linked_id,
    metadata: row.metadata,
    rawPayloadJson: row.raw_payload_json,
    createdAt: row.created_at,
  };
}

function toLifeModeRecord(row: LifeModeRow): LifeModeRecord {
  return {
    id: row.id,
    userId: row.user_id,
    mode: row.mode,
    source: row.source,
    reason: row.reason,
    activeFrom: row.active_from,
    activeUntil: row.active_until,
    isActive: row.is_active,
    priorityJson: jsonNumberRecord(row.priority_json),
    createdAt: row.created_at,
  };
}

function toLifeSeasonRecord(row: LifeSeasonRow): LifeSeasonRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    mode: row.mode,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    priorityJson: jsonNumberRecord(row.priority_json),
    createdAt: row.created_at,
  };
}

function toStudyCourseRecord(row: StudyCourseRow): StudyCourseRecord {
  return {
    id: row.id,
    userId: row.user_id,
    code: row.code,
    title: row.title,
    term: row.term,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    status: row.status,
    progressPercent: Number(row.progress_percent),
    completedUnits: row.completed_units,
    totalUnits: row.total_units,
    lastStudiedOn: row.last_studied_on,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSourceRecord(row: ExternalSourceRow): SourceRecord {
  return {
    id: row.id,
    userId: row.user_id,
    sourceKey: row.source_key,
    sourceType: row.source_type,
    displayName: row.display_name,
    status: row.status,
    configJson: row.config_json,
    lastSyncAt: row.last_sync_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toUserObsidianSettings(
  row: UserObsidianSettingsRow,
): UserObsidianSettings {
  return {
    userId: row.user_id,
    enabled: row.enabled,
    mode: row.mode,
    vaultPath: row.vault_path,
    status: row.status,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSourceEventRecord(row: SourceEventRow): SourceEventRecord {
  return {
    id: row.id,
    userId: row.user_id,
    sourceKey: row.source_key,
    externalId: row.external_id,
    eventType: row.event_type,
    title: row.title,
    description: row.description,
    location: row.location,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    dueAt: row.due_at,
    status: row.status,
    rawJson: row.raw_json,
    normalizedEntityId: row.normalized_entity_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toReminderRecord(row: ReminderRow): ReminderRecord {
  return {
    id: row.id,
    userId: row.user_id,
    lifeEntityId: row.life_entity_id,
    sourceEventId: row.source_event_id,
    channel: row.channel,
    remindAt: row.remind_at,
    status: row.status,
    message: row.message,
    metadataJson: row.metadata_json,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function profileUsername(row: Pick<ProfileRow, "metadata">): string | null {
  const metadata = jsonObject(row.metadata);
  return typeof metadata.telegramUsername === "string"
    ? metadata.telegramUsername
    : typeof metadata.username === "string"
      ? metadata.username
      : null;
}

function toTelegramUserRecord(row: ProfileRow): TelegramUserRecord {
  return {
    userId: row.user_id,
    telegramUserId: row.telegram_user_id,
    displayName: row.display_name,
    username: profileUsername(row),
    timezone: row.timezone,
    status: row.status,
    role: row.role,
  };
}

function toTelegramProfileRecord(row: ProfileRow): TelegramProfileRecord {
  return {
    ...toTelegramUserRecord(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toHealthMetricRecord(row: HealthMetricRow): HealthMetricRecord {
  return {
    id: row.id,
    userId: row.user_id,
    metricDate: row.metric_date,
    metricType: row.metric_type,
    value: Number(row.value),
    unit: row.unit,
    source: row.source,
    confidence: numberOrNull(row.confidence),
    rawJson: row.raw_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSyncRunRecord(row: SyncRunRow): SyncRunRecord {
  return {
    id: row.id,
    userId: row.user_id,
    sourceId: row.source_id,
    sourceKey: row.source_key,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    recordsSeen: row.records_seen,
    recordsCreated: row.records_created,
    recordsUpdated: row.records_updated,
    errorMessage: row.error_message,
    metadataJson: row.metadata_json,
  };
}

function toAcademicRecord(row: AcademicRecordRow): AcademicRecord {
  return {
    id: row.id,
    userId: row.user_id,
    sourceEventId: row.source_event_id,
    courseTitle: row.course_title,
    recordType: row.record_type,
    title: row.title,
    valueText: row.value_text,
    score: numberOrNull(row.score),
    maxScore: numberOrNull(row.max_score),
    percentage: numberOrNull(row.percentage),
    occursAt: row.occurs_at,
    dueAt: row.due_at,
    rawJson: row.raw_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sourceEventToCore(row: SourceEventRow): SourceEventLike {
  return {
    id: row.id,
    userId: row.user_id,
    sourceKey: row.source_key,
    externalId: row.external_id,
    eventType: row.event_type,
    title: row.title,
    description: row.description,
    location: row.location,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    dueAt: row.due_at,
    status: row.status,
    rawJson: row.raw_json,
  };
}

function toFinanceCategoryRecord(
  row: FinanceCategoryRow,
): FinanceCategoryRecord {
  return {
    id: row.id,
    name: row.name,
    transactionType: row.transaction_type,
  };
}

function toFinanceTransactionRecord(
  row: FinanceTransactionRow,
  categoryName: string | null = null,
): FinanceTransactionRecord {
  return {
    id: row.id,
    shortId: row.id.split("-")[0]?.slice(0, 8) ?? row.id.slice(0, 8),
    userId: row.user_id,
    accountId: row.account_id,
    categoryId: row.category_id,
    categoryName,
    transactionType: row.transaction_type,
    status: row.status,
    occurredOn: row.occurred_on,
    amount: Number(row.amount),
    currency: row.currency,
    baseAmount: row.base_amount === null ? null : Number(row.base_amount),
    baseCurrency: row.base_currency,
    exchangeRate: row.exchange_rate === null ? null : Number(row.exchange_rate),
    exchangeRateDate: row.exchange_rate_date,
    merchant: row.merchant,
    description: row.description,
    tags: row.tags,
    receiptId: row.receipt_id,
    rawText: row.raw_text,
    confidence: row.confidence === null ? null : Number(row.confidence),
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMonthlyReviewRecord(row: MonthlyReviewRow): MonthlyReviewRecord {
  return {
    id: row.id,
    userId: row.user_id,
    periodMonth: row.period_month,
    status: row.status,
    reportTitle: row.report_title,
    reportMarkdown: row.report_markdown,
    aiModel: row.ai_model,
    aiInputJson: row.ai_input_json,
    aiOutputJson: row.ai_output_json,
    statsJson: row.stats_json,
    obsidianPath: row.obsidian_path,
    generatedAt: row.generated_at,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toFinanceBudgetRecord(
  row: FinanceBudgetRow,
  categoryName: string | null = null,
  categoryLimits: FinanceBudgetCategoryLimit[] = [],
): FinanceBudgetRecord {
  return {
    id: row.id,
    userId: row.user_id,
    categoryId: row.category_id,
    categoryName,
    period: row.period,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    amount: Number(row.amount),
    currency: row.currency,
    name: row.name,
    notes: row.notes,
    isActive: row.is_active,
    archivedAt: row.archived_at,
    categoryLimits,
    metadata: jsonObject(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toFinanceBudgetCategoryLimit(
  row: FinanceBudgetCategoryRow,
): FinanceBudgetCategoryLimit {
  return {
    categoryId: row.category_id,
    limit: Number(row.limit_amount),
    currency: row.currency,
  };
}

function toFinanceRecurringRuleRecord(
  row: FinanceRecurringRuleRow,
  categoryName: string | null = null,
): FinanceRecurringRuleRecord {
  return {
    id: row.id,
    userId: row.user_id,
    accountId: row.account_id,
    categoryId: row.category_id,
    categoryName,
    transactionType: row.transaction_type,
    amount: Number(row.amount),
    currency: row.currency,
    cadence: row.cadence,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    nextDueOn: row.next_due_on,
    merchant: row.merchant,
    description: row.description,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toFinanceTagRecord(row: FinanceTagRow): FinanceTagRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
  };
}

function toFinanceReimbursementRecord(
  row: FinanceReimbursementRow,
): FinanceReimbursementRecord {
  return {
    id: row.id,
    userId: row.user_id,
    transactionId: row.transaction_id,
    originalAmount: Number(row.original_amount),
    reimbursedAmount: Number(row.reimbursed_amount),
    remaining: Number(row.remaining),
    currency: row.currency,
    status: row.status,
    reimbursedBy: row.reimbursed_by,
    notes: row.notes,
    reimbursedAt: row.reimbursed_at,
    createdAt: row.created_at,
  };
}

function toFinanceReceiptItemRecord(
  row: FinanceReceiptItemRow,
): FinanceReceiptItemRecord {
  return {
    id: row.id,
    userId: row.user_id,
    receiptId: row.receipt_id,
    name: row.name,
    quantity: Number(row.quantity),
    unitPrice: row.unit_price === null ? null : Number(row.unit_price),
    totalAmount: row.total_amount === null ? null : Number(row.total_amount),
    currency: row.currency,
    createdAt: row.created_at,
  };
}

function toFinanceReceiptRecord(
  row: FinanceReceiptRow,
  items: FinanceReceiptItemRecord[] = [],
): FinanceReceiptRecord {
  return {
    id: row.id,
    userId: row.user_id,
    storagePath: row.storage_path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    ocrJson: row.ocr_json,
    parsedJson: row.parsed_json,
    ocrText: row.ocr_text,
    openRouterModel: row.openrouter_model,
    processedAt: row.processed_at,
    status: row.status,
    transactionId: row.transaction_id,
    errorMessage: row.error_message,
    items,
    createdAt: row.created_at,
  };
}

function toFinanceAiAnalysisRunRecord(
  row: FinanceAiAnalysisRunRow,
): FinanceAiAnalysisRunRecord {
  return {
    id: row.id,
    userId: row.user_id,
    requestType: row.request_type,
    prompt: row.prompt,
    inputJson: row.input_json,
    outputJson: row.output_json,
    model: row.model,
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

function throwSupabaseError(error: unknown, context: string): never {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String(error.message)
      : "Unknown Supabase error";

  throw new Error(`${context}: ${message}`);
}

function localDateFor(timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const values = Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function numberOrNull(value: number | string | null): number | null {
  if (value === null) {
    return null;
  }

  return Number(value);
}

function jsonBooleanRecord(
  value: Json | null | undefined,
): Record<string, boolean> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, boolean] => {
      return typeof entry[1] === "boolean";
    }),
  );
}

function jsonNumberRecord(
  value: Json | null | undefined,
): Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] => {
      return typeof entry[1] === "number";
    }),
  );
}

function jsonObject(value: Json | null | undefined): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function receiptDisplayStatus(
  status: FinanceReceiptStatus,
): TmaReceiptDisplayStatus {
  if (status === "linked" || status === "parsed") {
    return "completed";
  }

  if (status === "partial") {
    return "partial";
  }

  if (status === "needs_review") {
    return "needs_review";
  }

  if (status === "failed") {
    return "failed";
  }

  return "processing";
}

function toTmaReceiptSummary(receipt: FinanceReceiptRecord): TmaReceiptSummary {
  const parsed =
    typeof receipt.parsedJson === "object" &&
    receipt.parsedJson !== null &&
    !Array.isArray(receipt.parsedJson)
      ? (receipt.parsedJson as Record<string, unknown>)
      : {};

  return {
    id: receipt.id,
    status: receipt.status,
    displayStatus: receiptDisplayStatus(receipt.status),
    fileName: receipt.fileName,
    amount: typeof parsed.amount === "number" ? parsed.amount : null,
    currency: typeof parsed.currency === "string" ? parsed.currency : null,
    merchant: typeof parsed.merchant === "string" ? parsed.merchant : null,
    transactionId: receipt.transactionId,
    errorMessage: receipt.errorMessage,
    createdAt: receipt.createdAt,
    processedAt: receipt.processedAt,
  };
}

const HEALTH_SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  telegram: "Manual",
  tma: "Manual",
  xiaomi_health_connect: "Xiaomi Watch / Health Connect",
  import_json: "JSON import",
  import_csv: "CSV import",
  api: "API",
};

const REQUIRED_TODAY_HEALTH_METRICS: HealthMetricType[] = [
  "steps",
  "sleep_minutes",
  "resting_heart_rate",
  "active_energy_kcal",
  "workout_minutes",
  "stress_score",
  "mood_score",
  "energy_score",
];

const HEALTH_SOURCE_PRIORITY: Record<string, number> = {
  xiaomi_health_connect: 50,
  import_json: 40,
  import_csv: 35,
  api: 30,
  tma: 25,
  telegram: 20,
  manual: 10,
};

function healthSourceLabel(source: string | null | undefined): string | null {
  if (!source) {
    return null;
  }

  return HEALTH_SOURCE_LABELS[source] ?? source;
}

function preferredMetricRows(rows: HealthMetricRecord[]): HealthMetricValues {
  const selected = new Map<HealthMetricType, HealthMetricRecord>();

  for (const row of rows) {
    const current = selected.get(row.metricType);
    const currentPriority = current
      ? (HEALTH_SOURCE_PRIORITY[current.source] ?? 0)
      : -1;
    const nextPriority = HEALTH_SOURCE_PRIORITY[row.source] ?? 0;

    if (
      !current ||
      nextPriority > currentPriority ||
      (nextPriority === currentPriority && row.updatedAt > current.updatedAt)
    ) {
      selected.set(row.metricType, row);
    }
  }

  return Object.fromEntries(
    [...selected.entries()].map(([type, row]) => [type, row.value]),
  ) as HealthMetricValues;
}

function healthMissingMetrics(
  metrics: HealthMetricValues,
): Record<string, boolean> {
  return Object.fromEntries(
    REQUIRED_TODAY_HEALTH_METRICS.map((type) => [
      type,
      metrics[type] === undefined,
    ]),
  );
}

function addDaysToDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function financePeriodEnd(
  periodStart: string,
  period: FinanceBudgetPeriod,
  customEnd?: string | null,
): string {
  if (period === "custom") {
    return customEnd ?? periodStart;
  }

  const date = new Date(`${periodStart}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Budget period_start is invalid");
  }

  switch (period) {
    case "weekly":
      date.setUTCDate(date.getUTCDate() + 6);
      break;
    case "monthly":
      date.setUTCMonth(date.getUTCMonth() + 1, 0);
      break;
    case "quarterly":
      date.setUTCMonth(date.getUTCMonth() + 3, 0);
      break;
    case "yearly":
      date.setUTCFullYear(date.getUTCFullYear() + 1);
      date.setUTCDate(date.getUTCDate() - 1);
      break;
  }

  return date.toISOString().slice(0, 10);
}

function financePeriodStart(
  inputDate: string,
  period: FinanceBudgetPeriod,
): string {
  const date = new Date(`${inputDate}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date for financePeriodStart");
  }

  switch (period) {
    case "weekly": {
      const day = date.getUTCDay();
      const diff = day === 0 ? 6 : day - 1;
      date.setUTCDate(date.getUTCDate() - diff);
      break;
    }
    case "monthly":
      date.setUTCDate(1);
      break;
    case "quarterly": {
      const quarter = Math.floor(date.getUTCMonth() / 3);
      date.setUTCMonth(quarter * 3, 1);
      break;
    }
    case "yearly":
      date.setUTCMonth(0, 1);
      break;
    case "custom":
      return inputDate;
  }

  return date.toISOString().slice(0, 10);
}

function normalizeFinanceTags(tags: readonly string[] | undefined): string[] {
  return [
    ...new Set(
      (tags ?? [])
        .map((tag) => tag.trim().replace(/^#/, "").toLowerCase())
        .filter(Boolean),
    ),
  ];
}

function csvCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

const FINANCE_RECEIPTS_BUCKET = "receipts";

type FinanceReportExportCell = string | number | null | undefined;
type FinanceReportExportRow = FinanceReportExportCell[];

function financeReportRows(
  report: FinanceReportData,
): FinanceReportExportRow[] {
  return [
    [
      "section",
      "name",
      "amount",
      "count",
      "percent",
      "date",
      "income",
      "expense",
    ],
    ["summary", "income", report.totalIncome, "", "", "", "", ""],
    ["summary", "expense", report.totalExpense, "", "", "", "", ""],
    ["summary", "net_flow", report.netFlow, "", "", "", "", ""],
    ...(report.periodComparison
      ? [
          [
            "comparison",
            "previous_expense",
            report.periodComparison.previousPeriodExpense,
            "",
            report.periodComparison.changePercent,
            report.periodComparison.changeDirection,
            "",
            "",
          ],
        ]
      : []),
    ...report.categoryBreakdown.map((item) => [
      "category",
      item.category,
      item.amount,
      item.count,
      item.percentOfTotal,
      "",
      "",
      "",
    ]),
    ...report.dailyTrend.map((item) => [
      "daily",
      "",
      "",
      "",
      "",
      item.date,
      item.income,
      item.expense,
    ]),
    ...report.topMerchants.map((item) => [
      "merchant",
      item.merchant,
      item.amount,
      item.count,
      "",
      "",
      "",
      "",
    ]),
    ...report.overspentBudgets.map((item) => [
      "overspend",
      item.name ?? item.budgetId,
      item.overspent,
      "",
      "",
      "",
      "",
      "",
    ]),
    ...report.recommendations.map((item) => [
      "recommendation",
      item,
      "",
      "",
      "",
      "",
      "",
      "",
    ]),
  ];
}

function financeReportCsv(report: FinanceReportData): string {
  return financeReportRows(report)
    .map((line) => line.map(csvCell).join(","))
    .join("\n");
}

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }

  return output;
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const CRC32_TABLE = new Uint32Array(
  Array.from({ length: 256 }, (_, index) => {
    let crc = index;

    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }

    return crc >>> 0;
  }),
);

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(
  files: readonly { path: string; data: Uint8Array }[],
): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const file of files) {
    const nameBytes = utf8Bytes(file.path);
    const checksum = crc32(file.data);
    const localHeader = new Uint8Array(30 + nameBytes.byteLength);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, file.data.byteLength, true);
    localView.setUint32(22, file.data.byteLength, true);
    localView.setUint16(26, nameBytes.byteLength, true);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, file.data);

    const centralHeader = new Uint8Array(46 + nameBytes.byteLength);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, file.data.byteLength, true);
    centralView.setUint32(24, file.data.byteLength, true);
    centralView.setUint16(28, nameBytes.byteLength, true);
    centralView.setUint32(42, localOffset, true);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    localOffset += localHeader.byteLength + file.data.byteLength;
  }

  const centralDirectory = concatBytes(centralParts);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralDirectory.byteLength, true);
  endView.setUint32(16, localOffset, true);

  return concatBytes([...localParts, centralDirectory, endRecord]);
}

function xlsxColumnName(index: number): string {
  let value = index + 1;
  let name = "";

  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }

  return name;
}

function xlsxCell(
  value: FinanceReportExportCell,
  columnIndex: number,
  rowIndex: number,
): string {
  const reference = `${xlsxColumnName(columnIndex)}${rowIndex + 1}`;

  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${reference}"><v>${value}</v></c>`;
  }

  const text = value === null || value === undefined ? "" : String(value);
  return `<c r="${reference}" t="inlineStr"><is><t>${escapeXmlText(text)}</t></is></c>`;
}

function financeReportXlsx(report: FinanceReportData): Uint8Array {
  const rows = [
    ["LifeOS Finance Report"],
    ["period", report.period],
    ["start_date", report.startDate],
    ["end_date", report.endDate],
    ["currency", report.currency],
    [],
    ...financeReportRows(report),
  ];
  const rowsXml = rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map((cell, columnIndex) => xlsxCell(cell, columnIndex, rowIndex))
          .join("")}</row>`,
    )
    .join("");

  return zipStore([
    {
      path: "[Content_Types].xml",
      data: utf8Bytes(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          "</Types>",
      ),
    },
    {
      path: "_rels/.rels",
      data: utf8Bytes(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          "</Relationships>",
      ),
    },
    {
      path: "xl/workbook.xml",
      data: utf8Bytes(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<sheets><sheet name="Finance Report" sheetId="1" r:id="rId1"/></sheets>' +
          "</workbook>",
      ),
    },
    {
      path: "xl/_rels/workbook.xml.rels",
      data: utf8Bytes(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          "</Relationships>",
      ),
    },
    {
      path: "xl/worksheets/sheet1.xml",
      data: utf8Bytes(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
          `<sheetData>${rowsXml}</sheetData></worksheet>`,
      ),
    },
  ]);
}

function escapePdfText(value: string): string {
  return value
    .replace(/[^\x20-\x7e]/g, "?")
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function financeReportPdf(report: FinanceReportData): Uint8Array {
  const lines = [
    `LifeOS Finance ${report.period} report`,
    `${report.startDate} to ${report.endDate}, currency ${report.currency}`,
    `Income: ${report.totalIncome}`,
    `Expense: ${report.totalExpense}`,
    `Net flow: ${report.netFlow}`,
    report.periodComparison
      ? `Previous expense: ${report.periodComparison.previousPeriodExpense} (${report.periodComparison.changeDirection} ${report.periodComparison.changePercent}%)`
      : "",
    "",
    "Categories",
    ...report.categoryBreakdown
      .slice(0, 32)
      .map(
        (item) =>
          `${item.category}: ${item.amount} (${item.count}, ${item.percentOfTotal}%)`,
      ),
    "",
    "Recommendations",
    ...report.recommendations.slice(0, 5).map((item) => `- ${item}`),
  ];
  const content = [
    "BT",
    "/F1 10 Tf",
    "50 780 Td",
    "14 TL",
    ...lines.map((line) => `(${escapePdfText(line)}) Tj T*`),
    "ET",
  ].join("\n");
  const stream = `<< /Length ${utf8Bytes(content).byteLength} >>\nstream\n${content}\nendstream`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    stream,
  ];
  const offsets: number[] = [0];
  let pdf = "%PDF-1.4\n";

  for (const [index, object] of objects.entries()) {
    offsets.push(utf8Bytes(pdf).byteLength);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = utf8Bytes(pdf).byteLength;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return utf8Bytes(pdf);
}

function roundedAverage(values: number[]): number | null {
  if (!values.length) {
    return null;
  }

  return Math.round(
    values.reduce((total, value) => total + value, 0) / values.length,
  );
}

function metricValue(
  metrics: HealthMetricValues,
  type: HealthMetricType,
): number | null {
  return metrics[type] ?? null;
}

function addSeconds(timestamp: string, seconds: number): string {
  return new Date(new Date(timestamp).getTime() + seconds * 1000).toISOString();
}

function isoDateTimeFromInput(value: Date | string | undefined): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    return value;
  }

  return new Date().toISOString();
}

function isoDateFromInput(value: Date | string | undefined): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "string") {
    return value.includes("T") ? value.slice(0, 10) : value;
  }

  return new Date().toISOString().slice(0, 10);
}

function defaultWorkoutTitle(mode: LifeMode): string {
  switch (mode) {
    case "recovery":
      return "Recovery workout";
    case "exam_war":
      return "Short exam workout";
    case "summer":
      return "Fitness workout";
    default:
      return "Telegram workout";
  }
}

function workoutTypeForMode(mode: LifeMode | undefined): string {
  switch (mode) {
    case "recovery":
      return "mobility";
    case "summer":
      return "fitness";
    default:
      return "strength";
  }
}

function workoutIntensityForMode(
  mode: LifeMode | undefined,
): WorkoutIntensity | null {
  switch (mode) {
    case "recovery":
      return "easy";
    case "exam_war":
      return "moderate";
    case "summer":
      return "hard";
    default:
      return null;
  }
}

function workoutTemplateForMode(mode: LifeMode | undefined): string {
  switch (mode) {
    case "recovery":
      return "recovery_mobility";
    case "exam_war":
      return "exam_war_short";
    case "summer":
      return "summer_fitness";
    default:
      return "default_strength";
  }
}

function healthRecommendationForMode(mode: LifeMode): string {
  switch (mode) {
    case "recovery":
      return "Protect sleep, reduce load, and keep movement easy.";
    case "exam_war":
      return "Keep workouts short and preserve sleep for study retention.";
    case "practice":
      return "Bias the day toward timed practice, review, and steady recovery.";
    case "recovery_setup":
      return "Use the reset window for sleep, admin, and light planning.";
    case "summer_term":
      return "Protect course work blocks while keeping health anchors stable.";
    case "summer":
      return "Use the wider runway for fitness, recovery, and consistency.";
    case "project_sprint":
      return "Keep health anchors stable while the sprint gets priority.";
    case "maintenance":
      return "Maintain sleep, food, and money routines before adding load.";
    case "trimester":
      return "Balance study blocks with health and finance basics.";
  }
}

function workoutPlanForMode(mode: LifeMode | undefined): WorkoutPlan {
  switch (mode) {
    case "recovery":
      return RECOVERY_WORKOUT_PLAN;
    case "exam_war":
      return EXAM_WAR_WORKOUT_PLAN;
    default:
      return DEFAULT_WORKOUT_PLAN;
  }
}

function dueDateScore(dueAt: string | null): number {
  if (!dueAt) {
    return 0;
  }

  const diffMs = new Date(dueAt).getTime() - Date.now();
  const diffDays = diffMs / 86_400_000;

  if (diffDays < 0) {
    return 40;
  }

  if (diffDays <= 1) {
    return 30;
  }

  if (diffDays <= 3) {
    return 20;
  }

  return 10;
}

function projectSprintFromProject(
  project: ProjectRow,
): LifeModeProjectSprint | null {
  const metadata = jsonObject(project.metadata);
  const configuredMode =
    typeof metadata.life_mode === "string"
      ? parseLifeMode(metadata.life_mode)
      : typeof metadata.mode === "string"
        ? parseLifeMode(metadata.mode)
        : null;
  const configuredSprint =
    metadata.project_sprint === true ||
    metadata.projectSprint === true ||
    metadata.sprint === true ||
    configuredMode === "project_sprint";

  if (!configuredSprint) {
    return null;
  }

  const rawPriorityJson =
    typeof metadata.priority_json === "object" && metadata.priority_json
      ? (metadata.priority_json as Json)
      : typeof metadata.priorityJson === "object" && metadata.priorityJson
        ? (metadata.priorityJson as Json)
        : null;

  return {
    id: project.id,
    userId: project.user_id,
    name: project.name,
    startsOn: project.starts_on,
    endsOn: project.due_on,
    priorityJson: jsonNumberRecord(rawPriorityJson),
  };
}

function workoutBody(summary: CurrentWorkoutSummary): string {
  const exerciseLines = summary.exercises.flatMap((exercise) => {
    const sets = exercise.sets
      .map((set) => {
        const target = [
          set.targetReps ? `${set.targetReps} reps` : null,
          set.targetWeightKg ? `${set.targetWeightKg} kg` : null,
        ]
          .filter(Boolean)
          .join(", ");
        return `  - Set ${set.index}: ${set.completed ? "done" : "open"}${
          target ? ` (${target})` : ""
        }`;
      })
      .join("\n");
    return [`- ${exercise.name}`, sets];
  });

  return [
    `Progress: ${summary.completedSets}/${summary.totalSets} sets`,
    `Started: ${summary.startedAt}`,
    "",
    ...exerciseLines,
  ].join("\n");
}

export interface SupabaseLifeOSStoreOptions {
  adminTelegramUserIds?: number[];
}

export class SupabaseLifeOSStore implements LifeOSStore {
  private readonly adminTelegramUserIds: ReadonlySet<number>;

  constructor(
    private readonly client: LifeOSSupabaseClient,
    options: SupabaseLifeOSStoreOptions = {},
  ) {
    this.adminTelegramUserIds = new Set(options.adminTelegramUserIds ?? []);
  }

  async resolveTelegramUser(
    telegramUserId: number,
  ): Promise<TelegramUserRecord | null> {
    const { data, error } = await this.client
      .from("profiles")
      .select("*")
      .eq("telegram_user_id", telegramUserId)
      .maybeSingle();

    if (error) {
      throwSupabaseError(error, "Failed to resolve Telegram user");
    }

    if (!data) {
      return null;
    }

    return toTelegramUserRecord(data);
  }

  async linkDefaultTelegramUser(
    input: BootstrapTelegramUserInput,
  ): Promise<TelegramUserRecord> {
    const { data, error } = await this.client
      .from("profiles")
      .upsert(
        {
          user_id: input.userId,
          display_name: input.displayName ?? null,
          timezone: input.timezone ?? "Asia/Qyzylorda",
          locale: input.locale ?? "en",
          telegram_user_id: input.telegramUserId,
          status: "active",
          role: "admin",
          metadata: {
            bootstrap: true,
            linkedBy: "telegram_start",
          },
        },
        {
          onConflict: "user_id",
        },
      )
      .select("*")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to link default Telegram user");
    }

    return toTelegramUserRecord(data);
  }

  async createPendingTelegramUser(
    input: CreatePendingTelegramUserInput,
  ): Promise<TelegramUserRecord> {
    const existing = await this.resolveTelegramUser(input.telegramUserId);

    if (existing) {
      return existing;
    }

    const password = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    const email = `telegram-${input.telegramUserId}@telegram.lifeos.local`;
    const { data: authData, error: authError } =
      await this.client.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          provider: "telegram",
          telegram_user_id: input.telegramUserId,
          telegram_username: input.username ?? null,
          display_name: input.displayName ?? null,
        },
      });

    if (authError) {
      throwSupabaseError(authError, "Failed to create pending auth user");
    }

    const userId = authData.user?.id;

    if (!userId) {
      throw new Error("Supabase did not return an auth user id");
    }

    const { data, error } = await this.client
      .from("profiles")
      .insert({
        user_id: userId,
        display_name: input.displayName ?? null,
        timezone: input.timezone ?? "Asia/Qyzylorda",
        locale: input.locale ?? "en",
        telegram_user_id: input.telegramUserId,
        status: "pending",
        role: "user",
        metadata: {
          signupMode: "pending_approval",
          telegramUsername: input.username ?? null,
          registeredVia: "telegram_start",
        },
      })
      .select("*")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to create pending Telegram profile");
    }

    return toTelegramUserRecord(data);
  }

  async listPendingUsers(): Promise<TelegramProfileRecord[]> {
    const { data, error } = await this.client
      .from("profiles")
      .select("*")
      .eq("status", "pending")
      .not("telegram_user_id", "is", null)
      .order("created_at", { ascending: true });

    if (error) {
      throwSupabaseError(error, "Failed to list pending Telegram users");
    }

    return data.map(toTelegramProfileRecord);
  }

  async listTelegramUsers(limit = 25): Promise<TelegramProfileRecord[]> {
    const { data, error } = await this.client
      .from("profiles")
      .select("*")
      .not("telegram_user_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      throwSupabaseError(error, "Failed to list Telegram users");
    }

    return data.map(toTelegramProfileRecord);
  }

  async approveTelegramUser(
    telegramUserId: number,
    approvedByTelegramUserId?: number,
  ): Promise<TelegramUserRecord | null> {
    const { data: existing, error: existingError } = await this.client
      .from("profiles")
      .select("*")
      .eq("telegram_user_id", telegramUserId)
      .maybeSingle();

    if (existingError) {
      throwSupabaseError(existingError, "Failed to load Telegram user");
    }

    if (!existing) {
      return null;
    }

    const metadata = jsonObject(existing.metadata);

    const { data, error } = await this.client
      .from("profiles")
      .update({
        status: "active",
        metadata: {
          ...metadata,
          approvedByTelegramUserId: approvedByTelegramUserId ?? null,
          approvedAt: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq("telegram_user_id", telegramUserId)
      .select("*")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to approve Telegram user");
    }

    return toTelegramUserRecord(data);
  }

  async blockTelegramUser(
    telegramUserId: number,
  ): Promise<TelegramUserRecord | null> {
    const existing = await this.resolveTelegramUser(telegramUserId);

    if (!existing) {
      return null;
    }

    const { data, error } = await this.client
      .from("profiles")
      .update({
        status: "blocked",
        updated_at: new Date().toISOString(),
      })
      .eq("telegram_user_id", telegramUserId)
      .select("*")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to block Telegram user");
    }

    return toTelegramUserRecord(data);
  }

  async isAdminTelegramUser(telegramUserId: number): Promise<boolean> {
    if (this.adminTelegramUserIds.has(telegramUserId)) {
      return true;
    }

    const user = await this.resolveTelegramUser(telegramUserId);
    return user?.status === "active" && user.role === "admin";
  }

  async createTask(input: CreateTaskInput): Promise<TaskRecord> {
    const { data, error } = await this.client
      .from("tasks")
      .insert({
        user_id: input.userId,
        title: input.title,
        notes: input.notes,
        due_at: input.dueAt,
        source: input.source ?? "telegram",
        metadata: input.metadata ?? {},
      })
      .select("id, title, due_at")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to create task");
    }

    return {
      id: data.id,
      title: data.title,
      dueAt: data.due_at,
    };
  }

  async createLifeCapture(
    input: CreateLifeCaptureInput,
  ): Promise<LifeCaptureRecord> {
    const { data, error } = await this.client
      .from("life_captures")
      .insert({
        user_id: input.userId,
        text: input.text,
        source: input.source ?? "telegram",
        status: input.status ?? "inbox",
        chat_id: input.chatId,
        message_id: input.messageId,
        metadata: input.metadata ?? {},
      })
      .select("id, user_id, text, source, status, chat_id, created_at")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to create life capture");
    }

    return {
      id: data.id,
      userId: data.user_id,
      text: data.text,
      source: data.source,
      status: data.status,
      chatId: data.chat_id,
      createdAt: data.created_at,
    };
  }

  async createLifeEntity(
    input: CreateLifeEntityInput,
  ): Promise<LifeEntityRecord> {
    const { data, error } = await this.client
      .from("life_entities")
      .insert({
        user_id: input.userId,
        entity_type: input.entityType,
        domain: input.domain ?? "personal",
        status: input.status ?? "inbox",
        title: input.title,
        description: input.description,
        body: input.body,
        occurred_at: input.occurredAt,
        due_at: input.dueAt,
        source: input.source ?? "telegram",
        source_command: input.sourceCommand,
        telegram_chat_id: input.telegramChatId,
        telegram_message_id: input.telegramMessageId,
        linked_table: input.linkedTable,
        linked_id: input.linkedId,
        metadata: input.metadata ?? {},
        raw_payload_json: input.rawPayloadJson ?? {},
      })
      .select("*")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to create life entity");
    }

    return toLifeEntityRecord(data);
  }

  async enqueueObsidianSync(input: {
    userId: string;
    lifeEntityId: string;
    entityType?: LifeEntityType;
    action?: string;
    targetPath?: string | null;
    payload?: Json;
    payloadJson?: Json;
  }): Promise<void> {
    const payloadJson = input.payloadJson ?? input.payload ?? {};
    const { error } = await this.client.from("obsidian_sync_queue").insert({
      user_id: input.userId,
      life_entity_id: input.lifeEntityId,
      operation: input.action ?? "upsert_note",
      entity_type: input.entityType,
      action: input.action ?? "upsert",
      target_path: input.targetPath,
      payload: payloadJson,
      payload_json: payloadJson,
    });

    if (error) {
      throwSupabaseError(error, "Failed to enqueue Obsidian sync");
    }
  }

  async listTodayEntities(input: {
    userId: string;
    dayStart: string;
    dayEnd: string;
  }): Promise<LifeEntityRecord[]> {
    const { data, error } = await this.client
      .from("life_entities")
      .select("*")
      .eq("user_id", input.userId)
      .gte("occurred_at", input.dayStart)
      .lt("occurred_at", input.dayEnd)
      .order("occurred_at", { ascending: true })
      .limit(10);

    if (error) {
      throwSupabaseError(error, "Failed to list today's entities");
    }

    return data.map(toLifeEntityRecord);
  }

  async getLatestDailyLog(userId: string): Promise<DailyLogRecord | null> {
    const { data, error } = await this.client
      .from("daily_logs")
      .select("mood_score, energy_score, focus_score, notes")
      .eq("user_id", userId)
      .order("log_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throwSupabaseError(error, "Failed to load daily log");
    }

    if (!data) {
      return null;
    }

    return {
      moodScore: data.mood_score,
      energyScore: data.energy_score,
      focusScore: data.focus_score,
      notes: data.notes,
    };
  }

  async getObsidianSyncStatus(
    userId: string,
  ): Promise<ObsidianSyncStatusSummary> {
    const { data, error } = await this.client
      .from("obsidian_sync_queue")
      .select("status")
      .eq("user_id", userId);

    if (error) {
      throwSupabaseError(error, "Failed to load Obsidian sync status");
    }

    const counts: Partial<Record<ObsidianSyncStatus, number>> = {};

    for (const item of data) {
      counts[item.status] = (counts[item.status] ?? 0) + 1;
    }

    return { counts };
  }

  async getUserObsidianSettings(
    userId: string,
  ): Promise<UserObsidianSettings | null> {
    const { data, error } = await this.client
      .from("user_obsidian_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throwSupabaseError(error, "Failed to load Obsidian settings");
    }

    return data ? toUserObsidianSettings(data) : null;
  }

  async upsertUserObsidianSettings(
    userId: string,
    input: UpsertUserObsidianSettingsInput,
  ): Promise<UserObsidianSettings> {
    const payload: Database["public"]["Tables"]["user_obsidian_settings"]["Insert"] =
      {
        user_id: userId,
      };

    if (input.enabled !== undefined) {
      payload.enabled = input.enabled;
    }
    if (input.mode !== undefined) {
      payload.mode = input.mode;
    }
    if (input.vaultPath !== undefined) {
      payload.vault_path = input.vaultPath;
    }
    if (input.status !== undefined) {
      payload.status = input.status;
    }
    if (input.metadata !== undefined) {
      payload.metadata = input.metadata;
    }

    const { data, error } = await this.client
      .from("user_obsidian_settings")
      .upsert(payload, { onConflict: "user_id" })
      .select("*")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to upsert Obsidian settings");
    }

    return toUserObsidianSettings(data);
  }

  async isObsidianEnabledForUser(userId: string): Promise<boolean> {
    const settings = await this.getUserObsidianSettings(userId);
    return Boolean(
      settings?.enabled &&
        settings.mode === "local_vault" &&
        settings.status === "connected" &&
        settings.vaultPath?.trim(),
    );
  }

  async getHealthSyncStatus(userId: string): Promise<HealthSyncStatusSummary> {
    const { data, error } = await this.client
      .from("health_sync_runs")
      .select(
        "id, sync_date, sync_reason, status, data_completeness_score, missing_metrics, completed_at, error",
      )
      .eq("user_id", userId)
      .order("started_at", { ascending: false })
      .limit(5);

    if (error) {
      throwSupabaseError(error, "Failed to load health sync status");
    }

    const counts: Partial<Record<HealthSyncRunStatus, number>> = {};

    for (const item of data) {
      counts[item.status] = (counts[item.status] ?? 0) + 1;
    }

    const runs = data.map((run) => ({
      id: run.id,
      syncDate: run.sync_date,
      syncReason: run.sync_reason,
      status: run.status,
      dataCompletenessScore:
        run.data_completeness_score === null
          ? null
          : Number(run.data_completeness_score),
      missingMetrics: jsonBooleanRecord(run.missing_metrics),
      completedAt: run.completed_at,
      error: run.error,
    }));
    const latest = runs.at(0);

    return {
      counts,
      runs,
      latestRun: latest ?? null,
    };
  }

  async getActiveManualMode(
    userId: string,
    now: Date | string = new Date(),
  ): Promise<LifeModeRecord | null> {
    const modes = await this.listActiveLifeModes({
      userId,
      source: "manual",
      now: isoDateTimeFromInput(now),
    });

    return modes.at(0) ?? null;
  }

  async getActiveSeason(
    userId: string,
    today: Date | string = new Date(),
  ): Promise<LifeSeasonRecord | null> {
    const seasons = await this.listActiveLifeSeasons({
      userId,
      today: isoDateFromInput(today),
    });

    return seasons.at(0) ?? null;
  }

  async getActiveStudyCourse(
    userId: string,
    today: Date | string = new Date(),
  ): Promise<StudyCourseRecord | null> {
    const activeDate = isoDateFromInput(today);
    const { data, error } = await this.client
      .from("study_courses")
      .select("*")
      .eq("user_id", userId)
      .in("status", ["planned", "active"])
      .or(`starts_on.is.null,starts_on.lte.${activeDate}`)
      .or(`ends_on.is.null,ends_on.gte.${activeDate}`)
      .order("starts_on", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throwSupabaseError(error, "Failed to load active study course");
    }

    return data ? toStudyCourseRecord(data) : null;
  }

  async updateStudyCourseProgress(
    input: UpdateStudyCourseProgressInput,
  ): Promise<StudyCourseRecord> {
    if (!input.courseId && !input.code) {
      throw new Error("Study course id or code is required");
    }

    if (input.progressPercent < 0 || input.progressPercent > 100) {
      throw new Error("Study course progress must be between 0 and 100");
    }

    const update: Database["public"]["Tables"]["study_courses"]["Update"] = {
      progress_percent: input.progressPercent,
    };

    if (input.completedUnits !== undefined) {
      update.completed_units = input.completedUnits ?? 0;
    }

    if (input.totalUnits !== undefined) {
      update.total_units = input.totalUnits;
    }

    if (input.lastStudiedOn !== undefined) {
      update.last_studied_on = input.lastStudiedOn;
    }

    if (input.status !== undefined) {
      update.status = input.status;
    }

    if (input.metadata !== undefined) {
      update.metadata = input.metadata;
    }

    const query = this.client
      .from("study_courses")
      .update(update)
      .eq("user_id", input.userId);
    const scopedQuery = input.courseId
      ? query.eq("id", input.courseId)
      : query.eq("code", input.code as string);
    const { data, error } = await scopedQuery.select("*").single();

    if (error) {
      throwSupabaseError(error, "Failed to update study course progress");
    }

    return toStudyCourseRecord(data);
  }

  async resolveCurrentMode(userId: string): Promise<LifeModeResolution> {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const [manualMode, latestHealthDaily, season, sprintMode, sprintProject] =
      await Promise.all([
        this.getActiveManualMode(userId, now),
        this.getLatestHealthDaily(userId),
        this.getActiveSeason(userId, today),
        this.getConfiguredSprintMode({ userId, now: now.toISOString() }),
        this.getConfiguredProjectSprint({ userId, today }),
      ]);

    return resolveCoreCurrentMode(userId, {
      now,
      manualOverrides: manualMode ? [manualMode] : [],
      latestHealthDaily: latestHealthDaily
        ? {
            userId,
            sleepMinutes: latestHealthDaily.sleep_minutes,
            recoveryMode: latestHealthDaily.recovery_mode,
            logDate: latestHealthDaily.log_date,
          }
        : null,
      seasons: season ? [season] : [],
      projectSprint: sprintMode ?? sprintProject,
    });
  }

  async setManualMode(input: SetManualModeInput): Promise<LifeModeResolution> {
    const { error: clearError } = await this.client
      .from("life_modes")
      .update({ is_active: false })
      .eq("user_id", input.userId)
      .eq("source", "manual")
      .eq("is_active", true);

    if (clearError) {
      throwSupabaseError(clearError, "Failed to clear active manual modes");
    }

    const manualModeInsert: Database["public"]["Tables"]["life_modes"]["Insert"] =
      {
        user_id: input.userId,
        mode: input.mode,
        source: "manual",
        reason: input.reason ?? "Manual override from LifeOS.",
        active_until: input.activeUntil ?? null,
        priority_json: (input.priorityJson ?? {}) as Json,
      };

    if (input.activeFrom) {
      manualModeInsert.active_from = input.activeFrom;
    }

    const { error } = await this.client
      .from("life_modes")
      .insert(manualModeInsert);

    if (error) {
      throwSupabaseError(error, "Failed to set manual mode");
    }

    return this.resolveCurrentMode(input.userId);
  }

  async clearManualMode(userId: string): Promise<LifeModeResolution> {
    const { error } = await this.client
      .from("life_modes")
      .update({ is_active: false })
      .eq("user_id", userId)
      .eq("source", "manual")
      .eq("is_active", true);

    if (error) {
      throwSupabaseError(error, "Failed to clear manual modes");
    }

    return this.resolveCurrentMode(userId);
  }

  async setManualLifeMode(
    input: SetManualLifeModeInput,
  ): Promise<LifeModeResolution> {
    return this.setManualMode(input);
  }

  async clearManualLifeMode(userId: string): Promise<LifeModeResolution> {
    return this.clearManualMode(userId);
  }

  async listModeAwareFocusItems(input: {
    userId: string;
    mode: LifeMode;
    limit?: number;
  }): Promise<ModeAwareFocusItemRecord[]> {
    const { data, error } = await this.client
      .from("tasks")
      .select("id, title, due_at, priority, metadata")
      .eq("user_id", input.userId)
      .not("status", "in", "(done,cancelled)")
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("priority", { ascending: false })
      .limit(Math.max(input.limit ?? 8, 20));

    if (error) {
      throwSupabaseError(error, "Failed to load focus items");
    }

    const items: FocusItemRecord[] = data.map((task) => ({
      id: task.id,
      sourceType: "task",
      entityType: "task",
      title: task.title,
      dueAt: task.due_at,
      priority: task.priority,
      score: task.priority + dueDateScore(task.due_at),
      metadata: jsonObject(task.metadata),
    }));

    return applyModeToFocusScoring(items, input.mode).slice(
      0,
      input.limit ?? 8,
    );
  }

  async getOrCreateCurrentWorkout(input: {
    userId: string;
    title?: string | null;
    now: string;
    lifeMode?: LifeMode;
  }): Promise<WorkoutRecord> {
    const { data: existing, error: existingError } = await this.client
      .from("workouts")
      .select("id, title, started_at")
      .eq("user_id", input.userId)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throwSupabaseError(existingError, "Failed to load current workout");
    }

    if (existing) {
      await this.ensureDefaultWorkoutPlan(
        input.userId,
        existing.id,
        input.lifeMode,
      );

      return {
        id: existing.id,
        title: existing.title,
        startedAt: existing.started_at,
        created: false,
      };
    }

    const { data, error } = await this.client
      .from("workouts")
      .insert({
        user_id: input.userId,
        title:
          input.title ??
          (input.lifeMode
            ? defaultWorkoutTitle(input.lifeMode)
            : "Telegram workout"),
        workout_type: workoutTypeForMode(input.lifeMode),
        intensity: workoutIntensityForMode(input.lifeMode),
        started_at: input.now,
        metadata: {
          source: "telegram",
          template: workoutTemplateForMode(input.lifeMode),
          lifeMode: input.lifeMode ?? "trimester",
        },
      })
      .select("id, title, started_at")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to create workout");
    }

    await this.ensureDefaultWorkoutPlan(input.userId, data.id, input.lifeMode);

    return {
      id: data.id,
      title: data.title,
      startedAt: data.started_at,
      created: true,
    };
  }

  async getCurrentWorkout(input: {
    userId: string;
    workoutId?: string;
  }): Promise<CurrentWorkoutSummary | null> {
    let query = this.client
      .from("workouts")
      .select("*")
      .eq("user_id", input.userId)
      .order("started_at", { ascending: false })
      .limit(1);

    if (input.workoutId) {
      query = query.eq("id", input.workoutId);
    } else {
      query = query.is("ended_at", null);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throwSupabaseError(error, "Failed to load workout");
    }

    if (!data) {
      return null;
    }

    return this.buildWorkoutSummary(data);
  }

  async completeWorkoutSet(input: {
    userId: string;
    setId: string;
    completedAt: string;
  }): Promise<CurrentWorkoutSummary> {
    const { data, error } = await this.client
      .from("workout_sets")
      .update({
        completed: true,
        completed_at: input.completedAt,
      })
      .eq("user_id", input.userId)
      .eq("id", input.setId)
      .select("workout_id")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to complete workout set");
    }

    const workout = await this.getCurrentWorkout({
      userId: input.userId,
      workoutId: data.workout_id,
    });

    if (!workout) {
      throw new Error("Workout not found after set completion");
    }

    return workout;
  }

  async undoWorkoutSet(input: {
    userId: string;
    setId: string;
  }): Promise<CurrentWorkoutSummary> {
    const { data, error } = await this.client
      .from("workout_sets")
      .update({
        completed: false,
        completed_at: null,
      })
      .eq("user_id", input.userId)
      .eq("id", input.setId)
      .select("workout_id")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to undo workout set");
    }

    const workout = await this.getCurrentWorkout({
      userId: input.userId,
      workoutId: data.workout_id,
    });

    if (!workout) {
      throw new Error("Workout not found after set undo");
    }

    return workout;
  }

  async completeWorkout(input: {
    userId: string;
    workoutId: string;
    completedAt: string;
  }): Promise<CurrentWorkoutSummary> {
    const { data: existing, error: existingError } = await this.client
      .from("workouts")
      .select("id, started_at")
      .eq("user_id", input.userId)
      .eq("id", input.workoutId)
      .single();

    if (existingError) {
      throwSupabaseError(
        existingError,
        "Failed to load workout for completion",
      );
    }

    const durationMinutes = Math.max(
      1,
      Math.ceil(
        (new Date(input.completedAt).getTime() -
          new Date(existing.started_at).getTime()) /
          60000,
      ),
    );

    const { error } = await this.client
      .from("workouts")
      .update({
        ended_at: input.completedAt,
        duration_minutes: durationMinutes,
      })
      .eq("user_id", input.userId)
      .eq("id", input.workoutId);

    if (error) {
      throwSupabaseError(error, "Failed to complete workout");
    }

    const workout = await this.getCurrentWorkout({
      userId: input.userId,
      workoutId: input.workoutId,
    });

    if (!workout) {
      throw new Error("Workout not found after completion");
    }

    const entity = await this.upsertWorkoutLifeEntity({
      userId: input.userId,
      workout,
      completedAt: input.completedAt,
    });

    await this.enqueueObsidianSync({
      userId: input.userId,
      lifeEntityId: entity.id,
      payload: {
        entityType: "workout",
        workoutId: workout.id,
        completedAt: input.completedAt,
      },
    });

    return workout;
  }

  async getTmaHomeSummary(user: TelegramUserRecord): Promise<TmaHomeSummary> {
    const [mode, health, focus, workout, syncStatus, obsidianSettings] =
      await Promise.all([
        this.resolveCurrentMode(user.userId),
        this.getTmaHealthSummary(user.userId),
        this.getTmaFocusSummary(user.userId),
        this.getCurrentWorkout({ userId: user.userId }),
        this.getObsidianSyncStatus(user.userId),
        this.getUserObsidianSettings(user.userId),
      ]);
    const pendingSyncCount = syncStatus.counts.pending ?? 0;

    return {
      displayName: user.displayName ?? undefined,
      localDate: localDateFor(user.timezone),
      mode: mode.mode,
      modeLabel: mode.label,
      modeReason: explainModeReason(mode),
      recoveryMode: health.recoveryMode,
      focusScore: focus.score,
      activeWorkout: workout
        ? {
            id: workout.id,
            title: workout.title,
            startedAt: workout.startedAt,
            progressPercent: workout.progressPercent,
          }
        : null,
      healthCompletenessScore: health.dataCompletenessScore,
      pendingSyncCount,
      obsidianStatus: {
        enabled: Boolean(obsidianSettings?.enabled),
        status: obsidianSettings?.status ?? "disconnected",
        mode: obsidianSettings?.mode ?? "local_vault",
        configured: Boolean(obsidianSettings?.vaultPath?.trim()),
        updatedAt: obsidianSettings?.updatedAt ?? null,
        pendingSyncCount,
      },
    };
  }

  async getTmaHealthSummary(userId: string): Promise<TmaHealthSummary> {
    const today = localDateFor("Asia/Qyzylorda");
    const [mode, todayMetrics, week, sources, latest] = await Promise.all([
      this.resolveCurrentMode(userId),
      this.getHealthMetricDay(userId, today),
      this.getHealthMetricWeek(userId, today),
      this.getHealthMetricSources(userId),
      this.getLatestHealthDaily(userId),
    ]);
    const metrics = todayMetrics.metrics;
    const hasMetrics = Object.keys(metrics).length > 0;

    if (!hasMetrics && !latest) {
      return {
        date: today,
        lifeMode: mode.mode,
        lifeModeLabel: mode.label,
        recommendation: healthRecommendationForMode(mode.mode),
        recoveryMode: "baseline",
        dataCompletenessScore: 0,
        sleepMinutes: null,
        deepSleepMinutes: null,
        remSleepMinutes: null,
        awakeMinutes: null,
        restingHeartRate: null,
        hrvMs: null,
        spo2Avg: null,
        steps: null,
        activeEnergyKcal: null,
        missingMetrics: {},
        samplesCount: 0,
        hasMetrics: false,
        sourceLabel: null,
        latestSource: null,
        averageHeartRate: null,
        totalEnergyKcal: null,
        workoutMinutes: null,
        distanceM: null,
        weightKg: null,
        sleepScore: null,
        stressScore: null,
        moodScore: null,
        energyScore: null,
        weekly: week,
        trends: week.trends,
        sources,
      };
    }

    const samplesCount = latest
      ? await this.getHealthSampleCount(latest.id)
      : 0;

    return {
      date: hasMetrics ? today : (latest?.log_date ?? today),
      lifeMode: mode.mode,
      lifeModeLabel: mode.label,
      recommendation: healthRecommendationForMode(mode.mode),
      recoveryMode: latest?.recovery_mode ?? "baseline",
      dataCompletenessScore: hasMetrics
        ? Math.round(
            ((REQUIRED_TODAY_HEALTH_METRICS.length -
              Object.values(todayMetrics.missingMetrics).filter(Boolean)
                .length) /
              REQUIRED_TODAY_HEALTH_METRICS.length) *
              100,
          )
        : Number(latest?.data_completeness_score ?? 0),
      sleepMinutes:
        metricValue(metrics, "sleep_minutes") ?? latest?.sleep_minutes ?? null,
      deepSleepMinutes: latest?.deep_sleep_minutes ?? null,
      remSleepMinutes: latest?.rem_sleep_minutes ?? null,
      awakeMinutes: latest?.awake_minutes ?? null,
      restingHeartRate:
        metricValue(metrics, "resting_heart_rate") ??
        numberOrNull(latest?.resting_heart_rate ?? null),
      hrvMs: numberOrNull(latest?.hrv_ms ?? null),
      spo2Avg:
        metricValue(metrics, "spo2_percent") ??
        numberOrNull(latest?.spo2_avg ?? null),
      steps: metricValue(metrics, "steps") ?? latest?.steps ?? null,
      activeEnergyKcal:
        metricValue(metrics, "active_energy_kcal") ??
        numberOrNull(latest?.active_energy_kcal ?? null),
      missingMetrics: hasMetrics
        ? todayMetrics.missingMetrics
        : jsonBooleanRecord(latest?.missing_metrics),
      samplesCount,
      hasMetrics,
      sourceLabel: todayMetrics.sourceLabel,
      latestSource: todayMetrics.latestSource,
      averageHeartRate: metricValue(metrics, "average_heart_rate"),
      totalEnergyKcal: metricValue(metrics, "total_energy_kcal"),
      workoutMinutes: metricValue(metrics, "workout_minutes"),
      distanceM: metricValue(metrics, "distance_m"),
      weightKg: metricValue(metrics, "weight_kg"),
      sleepScore: metricValue(metrics, "sleep_score"),
      stressScore: metricValue(metrics, "stress_score"),
      moodScore: metricValue(metrics, "mood_score"),
      energyScore: metricValue(metrics, "energy_score"),
      weekly: week,
      trends: week.trends,
      sources,
    };
  }

  async getHealthMetricDay(
    userId: string,
    date: string,
  ): Promise<HealthMetricDaySummary> {
    const { data, error } = await this.client
      .from("health_metrics")
      .select("*")
      .eq("user_id", userId)
      .eq("metric_date", date)
      .order("updated_at", { ascending: false });

    if (error) {
      throwSupabaseError(error, "Failed to load health metrics");
    }

    const records = data.map(toHealthMetricRecord);
    const metrics = preferredMetricRows(records);
    const sources = [...new Set(records.map((row) => row.source))];
    const latestSource = records[0]?.source ?? null;

    return {
      date,
      metrics,
      sources,
      sourceLabel: healthSourceLabel(latestSource),
      latestSource,
      missingMetrics: healthMissingMetrics(metrics),
      records,
    };
  }

  async getHealthMetricWeek(
    userId: string,
    endDate: string,
  ): Promise<HealthMetricWeekSummary & { trends: HealthMetricTrendDay[] }> {
    const startDate = addDaysToDate(endDate, -6);
    const { data, error } = await this.client
      .from("health_metrics")
      .select("*")
      .eq("user_id", userId)
      .gte("metric_date", startDate)
      .lte("metric_date", endDate)
      .order("metric_date", { ascending: true })
      .order("updated_at", { ascending: false });

    if (error) {
      throwSupabaseError(error, "Failed to load health metric week");
    }

    const recordsByDate = new Map<string, HealthMetricRecord[]>();

    for (const row of data.map(toHealthMetricRecord)) {
      recordsByDate.set(row.metricDate, [
        ...(recordsByDate.get(row.metricDate) ?? []),
        row,
      ]);
    }

    const trends: HealthMetricTrendDay[] = [];

    for (let offset = 0; offset < 7; offset += 1) {
      const date = addDaysToDate(startDate, offset);
      const metrics = preferredMetricRows(recordsByDate.get(date) ?? []);
      trends.push({
        date,
        steps: metricValue(metrics, "steps"),
        sleepMinutes: metricValue(metrics, "sleep_minutes"),
        restingHeartRate: metricValue(metrics, "resting_heart_rate"),
        activeEnergyKcal: metricValue(metrics, "active_energy_kcal"),
        workoutMinutes: metricValue(metrics, "workout_minutes"),
      });
    }

    const missingDays = trends
      .filter((day) => day.steps === null && day.sleepMinutes === null)
      .map((day) => day.date);

    return {
      startDate,
      endDate,
      avgSteps: roundedAverage(
        trends
          .map((day) => day.steps)
          .filter((value): value is number => value !== null),
      ),
      avgSleepMinutes: roundedAverage(
        trends
          .map((day) => day.sleepMinutes)
          .filter((value): value is number => value !== null),
      ),
      avgRestingHeartRate: roundedAverage(
        trends
          .map((day) => day.restingHeartRate)
          .filter((value): value is number => value !== null),
      ),
      totalWorkoutMinutes: trends.reduce(
        (total, day) => total + (day.workoutMinutes ?? 0),
        0,
      ),
      missingDays,
      trends,
    };
  }

  async getHealthMetricSources(
    userId: string,
  ): Promise<HealthMetricSourceStatus[]> {
    const { data, error } = await this.client
      .from("health_metrics")
      .select("source,updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    if (error) {
      throwSupabaseError(error, "Failed to load health metric sources");
    }

    const latestBySource = new Map<string, string>();

    for (const row of data) {
      if (!latestBySource.has(row.source)) {
        latestBySource.set(row.source, row.updated_at);
      }
    }

    return ["manual", "xiaomi_health_connect", "import_json"].map((source) => ({
      source,
      label: healthSourceLabel(source) ?? source,
      latestMetricAt: latestBySource.get(source) ?? null,
    }));
  }

  async upsertHealthMetrics(
    input: HealthMetricsIngestPayload,
  ): Promise<HealthMetricsIngestResult> {
    const existingRows = await this.client
      .from("health_metrics")
      .select("metric_type,source")
      .eq("user_id", input.userId)
      .eq("metric_date", input.date)
      .eq("source", input.source);

    if (existingRows.error) {
      throwSupabaseError(
        existingRows.error,
        "Failed to load existing health metrics",
      );
    }

    const existingKeys = new Set(
      existingRows.data.map((row) => `${row.metric_type}:${row.source}`),
    );
    const rows = input.metrics.map((metric) => ({
      user_id: input.userId,
      metric_date: input.date,
      metric_type: metric.type,
      value: metric.value,
      unit: metric.unit ?? null,
      source: input.source,
      confidence: metric.confidence ?? null,
      raw_json: {
        ...(metric.rawJson ?? {}),
        device: input.device ?? undefined,
        timezone: input.timezone ?? undefined,
        ingestRaw: input.raw ?? undefined,
      } as Json,
    }));
    const { data, error } = await this.client
      .from("health_metrics")
      .upsert(rows, {
        onConflict: "user_id,metric_date,metric_type,source",
      })
      .select("*");

    if (error) {
      throwSupabaseError(error, "Failed to upsert health metrics");
    }

    const day = await this.getHealthMetricDay(input.userId, input.date);
    const metricValues = day.metrics;

    await this.ingestHealthPayload({
      userId: input.userId,
      date: input.date,
      syncReason: "manual",
      source: input.source,
      timezone: input.timezone ?? "Asia/Qyzylorda",
      metrics: {
        sleepMinutes: metricValues.sleep_minutes,
        sleepScore: metricValues.sleep_score,
        restingHeartRate: metricValues.resting_heart_rate,
        spo2Avg: metricValues.spo2_percent,
        steps: metricValues.steps,
        caloriesBurned: metricValues.total_energy_kcal,
        activeEnergyKcal: metricValues.active_energy_kcal,
        workoutMinutes: metricValues.workout_minutes,
        weightKg: metricValues.weight_kg,
        moodScore: metricValues.mood_score,
        energyScore: metricValues.energy_score,
        stressScore: metricValues.stress_score,
      },
      workouts: [],
      samples: [],
      missing: healthMissingMetrics(metricValues),
      raw: {
        normalizedHealthMetrics: day.records,
        device: input.device ?? null,
        raw: input.raw ?? {},
      },
    });

    return {
      date: input.date,
      source: input.source,
      created: rows.filter(
        (row) => !existingKeys.has(`${row.metric_type}:${row.source}`),
      ).length,
      updated: rows.filter((row) =>
        existingKeys.has(`${row.metric_type}:${row.source}`),
      ).length,
      metrics: data.map(toHealthMetricRecord),
    };
  }

  async getTmaFocusSummary(userId: string): Promise<TmaFocusSummary> {
    const [mode, health, openTaskCount] = await Promise.all([
      this.resolveCurrentMode(userId),
      this.getLatestHealthDaily(userId),
      this.getOpenTaskCount(userId),
    ]);
    const healthMode = health?.recovery_mode ?? "baseline";
    const result = scoreFocus({
      healthMode: mode.mode === "recovery" ? "recovery" : healthMode,
      moodScore: health?.mood_score ?? undefined,
      energyScore: health?.energy_score ?? undefined,
      stressScore: health?.stress_score ?? undefined,
      sleepHours: health?.sleep_minutes
        ? Number(health.sleep_minutes) / 60
        : undefined,
      openTaskCount,
    });
    const topItems = await this.listModeAwareFocusItems({
      userId,
      mode: mode.mode,
      limit: 5,
    });

    return {
      score: result.score,
      band: result.band,
      mode: healthMode,
      lifeMode: mode.mode,
      lifeModeLabel: mode.label,
      lifeModeReason: explainModeReason(mode),
      reasons: [...new Set([...result.reasons, `life-mode:${mode.mode}`])],
      nextBestAction:
        topItems.at(0)?.title ??
        (result.band === "low"
          ? "Pick one small task and protect recovery."
          : result.band === "medium"
            ? "Work the next concrete task before adding inputs."
            : "Use the strong window for deep work."),
      openTaskCount,
      topItems,
      priorityWeights: mode.priorityWeights,
    };
  }

  async getTmaSourcesSummary(userId: string): Promise<TmaSourcesSummary> {
    const now = new Date().toISOString();

    return {
      sources: await this.listExternalSources(userId),
      sourceEvents: await this.listSourceEvents(userId, {
        after: now,
        limit: 8,
      }),
      reminders: await this.listUpcomingReminders(userId, 8),
      syncRuns: await this.listRecentSyncRuns(userId, 5),
    };
  }

  async getTmaAcademicSummary(userId: string): Promise<TmaAcademicSummary> {
    const now = new Date();
    const nowIso = now.toISOString();
    const today = nowIso.slice(0, 10);
    const [
      currentMode,
      sourceEvents,
      activeCourse,
      summerCourse,
      nextTransition,
      records,
    ] = await Promise.all([
      this.resolveCurrentMode(userId),
      this.listSourceEvents(userId, {
        eventType: "academic_event",
        limit: 80,
      }),
      this.getActiveStudyCourse(userId, today),
      this.getStudyCourseByCode(userId, "DISCRETE-MATH-SUMMER-2026"),
      this.getNextSeasonTransition(userId, today),
      this.listAcademicRecords(userId),
    ]);
    const academicEvents = sourceEvents.filter(
      (event) => event.eventType === "academic_event",
    );
    const upcomingAcademicEvents = academicEvents.filter((event) => {
      const timestamp = event.startsAt ?? event.dueAt;
      return timestamp ? timestamp >= nowIso : false;
    });
    const finals = academicEvents.filter((event) =>
      `${event.title ?? ""} ${event.description ?? ""}`.match(/\bfinal\b/i),
    );
    const examfx = academicEvents.filter((event) =>
      `${event.title ?? ""} ${event.description ?? ""}`.match(/\bexamfx\b/i),
    );

    return {
      currentMode,
      nextAcademicEvent: upcomingAcademicEvents.at(0) ?? null,
      finals,
      examfx,
      activeCourse,
      summerCourse,
      nextTransition,
      academicRecords: records,
    };
  }

  async upsertExternalSource(
    userId: string,
    source: UpsertExternalSourceInput,
  ): Promise<SourceRecord> {
    const { data, error } = await this.client
      .from("external_sources")
      .upsert(
        {
          user_id: userId,
          source_key: source.sourceKey,
          source_type: source.sourceType,
          display_name: source.displayName,
          status: source.status ?? "disabled",
          config_json: source.configJson ?? {},
          last_sync_at: source.lastSyncAt ?? null,
        },
        {
          onConflict: "user_id,source_key",
        },
      )
      .select("*")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to upsert external source");
    }

    return toSourceRecord(data);
  }

  async listExternalSources(userId: string): Promise<SourceRecord[]> {
    const { data, error } = await this.client
      .from("external_sources")
      .select("*")
      .eq("user_id", userId)
      .order("display_name", { ascending: true });

    if (error) {
      throwSupabaseError(error, "Failed to list external sources");
    }

    return data.map(toSourceRecord);
  }

  async createSyncRun(
    userId: string,
    sourceKey: string,
  ): Promise<SyncRunRecord> {
    const source = await this.findExternalSource(userId, sourceKey);
    const { data, error } = await this.client
      .from("sync_runs")
      .insert({
        user_id: userId,
        source_id: source?.id ?? null,
        source_key: sourceKey,
      })
      .select("*")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to create sync run");
    }

    return toSyncRunRecord(data);
  }

  async finishSyncRun(
    syncRunId: string,
    status: SyncRunStatus,
    stats: {
      recordsSeen?: number;
      recordsCreated?: number;
      recordsUpdated?: number;
      errorMessage?: string | null;
      metadataJson?: Json;
    } = {},
  ): Promise<SyncRunRecord> {
    const { data, error } = await this.client
      .from("sync_runs")
      .update({
        status,
        finished_at: new Date().toISOString(),
        records_seen: stats.recordsSeen ?? 0,
        records_created: stats.recordsCreated ?? 0,
        records_updated: stats.recordsUpdated ?? 0,
        error_message: stats.errorMessage ?? null,
        metadata_json: stats.metadataJson ?? {},
      })
      .eq("id", syncRunId)
      .select("*")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to finish sync run");
    }

    return toSyncRunRecord(data);
  }

  async upsertSourceEvent(
    input: UpsertSourceEventInput,
  ): Promise<SourceEventRecord> {
    const row = {
      user_id: input.userId,
      source_key: input.sourceKey,
      external_id: input.externalId ?? null,
      event_type: input.eventType,
      title: input.title ?? null,
      description: input.description ?? null,
      location: input.location ?? null,
      starts_at: input.startsAt ?? null,
      ends_at: input.endsAt ?? null,
      due_at: input.dueAt ?? null,
      status: input.status ?? "active",
      raw_json: input.rawJson ?? {},
      normalized_entity_id: input.normalizedEntityId ?? null,
    };
    const query = input.externalId
      ? this.client
          .from("source_events")
          .upsert(row, { onConflict: "user_id,source_key,external_id" })
      : this.client.from("source_events").insert(row);
    const { data, error } = await query.select("*").single();

    if (error) {
      throwSupabaseError(error, "Failed to upsert source event");
    }

    return toSourceEventRecord(data);
  }

  async listSourceEvents(
    userId: string,
    filters: ListSourceEventsFilters = {},
  ): Promise<SourceEventRecord[]> {
    let query = this.client
      .from("source_events")
      .select("*")
      .eq("user_id", userId);

    if (filters.sourceKey) {
      query = query.eq("source_key", filters.sourceKey);
    }

    if (filters.status) {
      query = query.eq("status", filters.status);
    }

    if (filters.eventType) {
      query = query.eq("event_type", filters.eventType);
    }

    if (filters.after) {
      query = query.or(
        `starts_at.gte.${filters.after},due_at.gte.${filters.after}`,
      );
    }

    if (filters.before) {
      query = query.or(
        `starts_at.lte.${filters.before},due_at.lte.${filters.before}`,
      );
    }

    const { data, error } = await query
      .order("starts_at", { ascending: true, nullsFirst: false })
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(filters.limit ?? 25);

    if (error) {
      throwSupabaseError(error, "Failed to list source events");
    }

    return data.map(toSourceEventRecord);
  }

  async normalizeSourceEvent(
    userId: string,
    sourceEventId: string,
  ): Promise<LifeEntityRecord> {
    const { data: sourceEvent, error: sourceEventError } = await this.client
      .from("source_events")
      .select("*")
      .eq("user_id", userId)
      .eq("id", sourceEventId)
      .single();

    if (sourceEventError) {
      throwSupabaseError(sourceEventError, "Failed to load source event");
    }

    if (sourceEvent.normalized_entity_id) {
      const { data: existing, error: existingError } = await this.client
        .from("life_entities")
        .select("*")
        .eq("user_id", userId)
        .eq("id", sourceEvent.normalized_entity_id)
        .single();

      if (existingError) {
        throwSupabaseError(existingError, "Failed to load normalized entity");
      }

      return toLifeEntityRecord(existing);
    }

    const normalized = normalizeSourceEventToLifeEntity(
      sourceEventToCore(sourceEvent),
    );
    const entity = await this.createLifeEntity({
      userId,
      entityType: normalized.entityType,
      domain: normalized.domain,
      status: normalized.status,
      title: normalized.title,
      description: normalized.description,
      body: normalized.body,
      dueAt: normalized.dueAt,
      source: normalized.source,
      sourceCommand: normalized.sourceCommand,
      linkedTable: normalized.linkedTable,
      linkedId: sourceEvent.id,
      metadata: normalized.metadata as Json,
      rawPayloadJson: normalized.rawPayloadJson as Json,
    });
    const { error: updateError } = await this.client
      .from("source_events")
      .update({ normalized_entity_id: entity.id })
      .eq("id", sourceEvent.id);

    if (updateError) {
      throwSupabaseError(updateError, "Failed to mark source event normalized");
    }

    return entity;
  }

  async createReminder(input: CreateReminderInput): Promise<ReminderRecord> {
    const message = input.message.trim();

    if (!message) {
      throw new Error("Reminder message is required");
    }

    const remindAt = new Date(input.remindAt);

    if (Number.isNaN(remindAt.getTime())) {
      throw new Error("Reminder time is invalid");
    }

    const { data, error } = await this.client
      .from("reminders")
      .insert({
        user_id: input.userId,
        life_entity_id: input.lifeEntityId ?? null,
        source_event_id: input.sourceEventId ?? null,
        channel: input.channel ?? "telegram",
        remind_at: remindAt.toISOString(),
        message,
        metadata_json: input.metadataJson ?? {},
      })
      .select("*")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to create reminder");
    }

    return toReminderRecord(data);
  }

  async listPendingReminders(
    userId: string,
    before: string,
  ): Promise<ReminderRecord[]> {
    const { data, error } = await this.client
      .from("reminders")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "pending")
      .lte("remind_at", before)
      .order("remind_at", { ascending: true });

    if (error) {
      throwSupabaseError(error, "Failed to list pending reminders");
    }

    return data.map(toReminderRecord);
  }

  async listUpcomingReminders(
    userId: string,
    limit = 8,
  ): Promise<ReminderRecord[]> {
    const { data, error } = await this.client
      .from("reminders")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "pending")
      .gte("remind_at", new Date().toISOString())
      .order("remind_at", { ascending: true })
      .limit(limit);

    if (error) {
      throwSupabaseError(error, "Failed to list upcoming reminders");
    }

    return data.map(toReminderRecord);
  }

  async markReminderSent(reminderId: string): Promise<ReminderRecord> {
    const now = new Date().toISOString();
    const { data, error } = await this.client
      .from("reminders")
      .update({
        status: "sent",
        sent_at: now,
        updated_at: now,
      })
      .eq("id", reminderId)
      .select("*")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to mark reminder sent");
    }

    return toReminderRecord(data);
  }

  async cancelReminder(
    userId: string,
    reminderId: string,
  ): Promise<ReminderRecord> {
    const { data, error } = await this.client
      .from("reminders")
      .update({
        status: "cancelled",
        claimed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("id", reminderId)
      .eq("status", "pending")
      .select("*")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to cancel reminder");
    }

    return toReminderRecord(data);
  }

  async snoozeReminder(
    userId: string,
    reminderId: string,
    remindAt: string,
  ): Promise<ReminderRecord> {
    const parsed = new Date(remindAt);

    if (Number.isNaN(parsed.getTime())) {
      throw new Error("Reminder snooze time is invalid");
    }

    const { data, error } = await this.client
      .from("reminders")
      .update({
        status: "pending",
        remind_at: parsed.toISOString(),
        claimed_at: null,
      })
      .eq("user_id", userId)
      .eq("id", reminderId)
      .eq("status", "pending")
      .select("*")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to snooze reminder");
    }

    return toReminderRecord(data);
  }

  async getReminderMode(userId: string): Promise<ReminderMode> {
    const { data, error } = await this.client
      .from("user_settings")
      .select("settings")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throwSupabaseError(error, "Failed to load reminder mode");
    }

    const mode = jsonObject(data?.settings).reminder_mode;
    return mode === "chill" ||
      mode === "duolingo" ||
      mode === "war" ||
      mode === "normal"
      ? mode
      : "normal";
  }

  async setReminderMode(
    userId: string,
    mode: ReminderMode,
  ): Promise<ReminderMode> {
    const { data: current, error: loadError } = await this.client
      .from("user_settings")
      .select("settings")
      .eq("user_id", userId)
      .maybeSingle();

    if (loadError) {
      throwSupabaseError(loadError, "Failed to load reminder settings");
    }

    const settings = {
      ...jsonObject(current?.settings),
      reminder_mode: mode,
    } satisfies Json;
    const { error } = await this.client.from("user_settings").upsert(
      {
        user_id: userId,
        settings,
      },
      { onConflict: "user_id" },
    );

    if (error) {
      throwSupabaseError(error, "Failed to set reminder mode");
    }

    return mode;
  }

  async getFinanceBaseCurrency(userId: string): Promise<string> {
    const { data, error } = await this.client
      .from("user_settings")
      .select("settings")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throwSupabaseError(error, "Failed to load finance base currency");
    }

    return normalizeFinanceBaseCurrency(
      jsonObject(data?.settings).finance_base_currency,
    );
  }

  async setFinanceBaseCurrency(
    userId: string,
    currency: string,
  ): Promise<string> {
    const normalized = normalizeFinanceBaseCurrency(currency);
    const { data: current, error: loadError } = await this.client
      .from("user_settings")
      .select("settings")
      .eq("user_id", userId)
      .maybeSingle();

    if (loadError) {
      throwSupabaseError(loadError, "Failed to load finance settings");
    }

    const settings = {
      ...jsonObject(current?.settings),
      finance_base_currency: normalized,
    } satisfies Json;
    const { error } = await this.client.from("user_settings").upsert(
      {
        user_id: userId,
        settings,
      },
      { onConflict: "user_id" },
    );

    if (error) {
      throwSupabaseError(error, "Failed to set finance base currency");
    }

    return normalized;
  }

  async listAcademicRecords(userId: string): Promise<AcademicRecord[]> {
    const { data, error } = await this.client
      .from("academic_records")
      .select("*")
      .eq("user_id", userId)
      .order("occurs_at", { ascending: true, nullsFirst: false })
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(50);

    if (error) {
      throwSupabaseError(error, "Failed to list academic records");
    }

    return data.map(toAcademicRecord);
  }

  async upsertAcademicRecord(
    input: UpsertAcademicRecordInput,
  ): Promise<AcademicRecord> {
    const existing =
      input.sourceEventId === null || input.sourceEventId === undefined
        ? null
        : await this.findAcademicRecordBySourceEvent(input);
    const row = {
      user_id: input.userId,
      source_event_id: input.sourceEventId ?? null,
      course_title: input.courseTitle,
      record_type: input.recordType,
      title: input.title,
      value_text: input.valueText ?? null,
      score: input.score ?? null,
      max_score: input.maxScore ?? null,
      percentage: input.percentage ?? null,
      occurs_at: input.occursAt ?? null,
      due_at: input.dueAt ?? null,
      raw_json: input.rawJson ?? {},
    };
    const query = existing
      ? this.client.from("academic_records").update(row).eq("id", existing.id)
      : this.client.from("academic_records").insert(row);
    const { data, error } = await query.select("*").single();

    if (error) {
      throwSupabaseError(error, "Failed to upsert academic record");
    }

    return toAcademicRecord(data);
  }

  async getFinanceSummary(input: {
    userId: string;
    since: string;
  }): Promise<FinanceSummary> {
    const { data, error } = await this.client
      .from("finance_transactions")
      .select("amount, base_amount")
      .eq("user_id", input.userId)
      .eq("transaction_type", "expense")
      .eq("status", "confirmed")
      .gte("occurred_on", input.since.slice(0, 10));

    if (error) {
      throwSupabaseError(error, "Failed to load finance summary");
    }

    return {
      capturedSpendCount: data.length,
      capturedSpendTotal: data.reduce(
        (total, item) => total + Number(item.base_amount ?? item.amount),
        0,
      ),
    };
  }

  async createFinanceTransaction(
    input: CreateFinanceTransactionInput,
  ): Promise<FinanceTransactionRecord> {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new Error("Finance transaction amount must be greater than zero");
    }

    const defaults = await this.ensureFinanceDefaults(input.userId);
    const fallbackCategory =
      input.transactionType === "income" ? "Income" : "Other";
    const requestedCategory =
      normalizeFinanceCategory(input.category) ?? fallbackCategory;
    const category =
      input.categoryId !== undefined
        ? (defaults.categories.find(
            (item) =>
              item.id === input.categoryId &&
              item.transaction_type === input.transactionType,
          ) ?? null)
        : (defaults.categories.find(
            (item) =>
              item.name.toLocaleLowerCase("en") ===
                requestedCategory.toLocaleLowerCase("en") &&
              item.transaction_type === input.transactionType,
          ) ??
          defaults.categories.find(
            (item) =>
              item.name === fallbackCategory &&
              item.transaction_type === input.transactionType,
          ) ??
          null);
    const status = input.status ?? "confirmed";
    const now = new Date().toISOString();
    const currency = (input.currency ?? DEFAULT_FINANCE_CURRENCY).toUpperCase();
    const baseCurrency = (
      input.baseCurrency ?? (await this.getFinanceBaseCurrency(input.userId))
    ).toUpperCase();
    const baseMoney = await this.resolveBaseMoney({
      amount: input.amount,
      currency,
      baseCurrency,
      occurredOn: input.occurredOn,
      baseAmount: input.baseAmount,
      exchangeRate: input.exchangeRate,
      exchangeRateDate: input.exchangeRateDate,
    });
    const tags = normalizeFinanceTags(input.tags);
    const { data, error } = await this.client
      .from("finance_transactions")
      .insert({
        user_id: input.userId,
        account_id: input.accountId ?? defaults.account.id,
        category_id: category?.id ?? null,
        transaction_type: input.transactionType,
        occurred_on: input.occurredOn,
        amount: input.amount,
        currency,
        base_amount: baseMoney.baseAmount,
        base_currency: baseMoney.baseCurrency,
        exchange_rate: baseMoney.exchangeRate,
        exchange_rate_date: baseMoney.exchangeRateDate,
        merchant: input.merchant ?? null,
        description: input.description ?? null,
        tags,
        receipt_id: input.receiptId ?? null,
        status,
        raw_text: input.rawText ? redactFinanceText(input.rawText) : null,
        confidence: input.confidence ?? null,
        source: input.source ?? "manual",
        parse_run_id: input.parseRunId ?? null,
        confirmed_at: status === "confirmed" ? now : null,
        cancelled_at: status === "cancelled" ? now : null,
        metadata: input.metadata ?? {},
      })
      .select("*")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to create finance transaction");
    }

    if (tags.length) {
      await this.syncTransactionTagRows(input.userId, data.id, tags);
    }

    return toFinanceTransactionRecord(data, category?.name ?? null);
  }

  async updateFinanceTransaction(
    input: UpdateFinanceTransactionInput,
  ): Promise<FinanceTransactionRecord> {
    const shortId = input.shortId.trim().toLowerCase();

    if (!shortId) {
      throw new Error("Finance transaction short id is required");
    }

    if (
      input.amount !== undefined &&
      (!Number.isFinite(input.amount) || input.amount <= 0)
    ) {
      throw new Error("Finance transaction amount must be greater than zero");
    }

    const { data: candidates, error: candidatesError } = await this.client
      .from("finance_transactions")
      .select("*")
      .eq("user_id", input.userId)
      .order("created_at", { ascending: false })
      .limit(250);

    if (candidatesError) {
      throwSupabaseError(candidatesError, "Failed to find finance transaction");
    }

    const matches = candidates.filter((item) =>
      item.id.toLowerCase().startsWith(shortId),
    );

    if (matches.length !== 1) {
      throw new Error(
        matches.length
          ? "Finance short id is ambiguous"
          : "Finance transaction not found",
      );
    }

    const current = matches[0]!;
    let categoryName: string | null = null;
    let categoryId = current.category_id;

    if (input.category !== undefined) {
      const defaults = await this.ensureFinanceDefaults(input.userId);
      const requestedCategory = normalizeFinanceCategory(input.category);

      if (!requestedCategory) {
        throw new Error(`Unknown finance category: ${input.category}`);
      }

      const category = defaults.categories.find(
        (item) =>
          item.name.toLocaleLowerCase("en") ===
            requestedCategory.toLocaleLowerCase("en") &&
          item.transaction_type === current.transaction_type,
      );

      if (!category) {
        throw new Error(`Unknown finance category: ${input.category}`);
      }

      categoryId = category.id;
      categoryName = category.name;
    } else if (categoryId) {
      const { data: category, error: categoryError } = await this.client
        .from("finance_categories")
        .select("*")
        .eq("id", categoryId)
        .maybeSingle();

      if (categoryError) {
        throwSupabaseError(categoryError, "Failed to load finance category");
      }

      categoryName = category?.name ?? null;
    }

    const now = new Date().toISOString();
    const patch: Database["public"]["Tables"]["finance_transactions"]["Update"] =
      {
        category_id: categoryId,
      };

    if (input.amount !== undefined) {
      patch.amount = input.amount;
      const baseMoney = await this.resolveBaseMoney({
        amount: input.amount,
        currency: current.currency,
        baseCurrency: current.base_currency,
        occurredOn: current.occurred_on,
        exchangeRate: current.exchange_rate,
        exchangeRateDate: current.exchange_rate_date,
      });
      patch.base_amount = baseMoney.baseAmount;
      patch.base_currency = baseMoney.baseCurrency;
      patch.exchange_rate = baseMoney.exchangeRate;
      patch.exchange_rate_date = baseMoney.exchangeRateDate;
    }

    if (input.status !== undefined) {
      patch.status = input.status;
      patch.confirmed_at = input.status === "confirmed" ? now : null;
      patch.cancelled_at = input.status === "cancelled" ? now : null;
    }

    if (input.description !== undefined) {
      patch.description = input.description;
    }

    if (input.merchant !== undefined) {
      patch.merchant = input.merchant;
    }

    if (input.tags !== undefined) {
      patch.tags = normalizeFinanceTags(input.tags);
    }

    const { data, error } = await this.client
      .from("finance_transactions")
      .update(patch)
      .eq("id", current.id)
      .eq("user_id", input.userId)
      .select("*")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to update finance transaction");
    }

    const transaction = toFinanceTransactionRecord(data, categoryName);

    if (input.tags !== undefined) {
      const { error: deleteTagsError } = await this.client
        .from("finance_transaction_tags")
        .delete()
        .eq("transaction_id", data.id);

      if (deleteTagsError) {
        throwSupabaseError(deleteTagsError, "Failed to replace finance tags");
      }

      await this.syncTransactionTagRows(
        input.userId,
        data.id,
        normalizeFinanceTags(input.tags),
      );
    }

    await this.syncFinanceLifeEntity(transaction);
    return transaction;
  }

  async listFinanceCategories(
    userId: string,
  ): Promise<FinanceCategoryRecord[]> {
    const defaults = await this.ensureFinanceDefaults(userId);
    return defaults.categories.map(toFinanceCategoryRecord);
  }

  async getTmaFinanceSummary(input: {
    userId: string;
    today: string;
  }): Promise<TmaFinanceSummary> {
    const [categories, baseCurrency] = await Promise.all([
      this.listFinanceCategories(input.userId),
      this.getFinanceBaseCurrency(input.userId),
    ]);
    const categoryNames = new Map(
      categories.map((item) => [item.id, item.name]),
    );
    const todayDate = new Date(`${input.today}T00:00:00.000Z`);

    if (Number.isNaN(todayDate.getTime())) {
      throw new Error("Finance summary requires a valid local date");
    }

    const weekDate = new Date(todayDate);
    const weekday = weekDate.getUTCDay() || 7;
    weekDate.setUTCDate(weekDate.getUTCDate() - weekday + 1);
    const monthDate = new Date(todayDate);
    monthDate.setUTCDate(1);
    const weekStart = weekDate.toISOString().slice(0, 10);
    const monthStart = monthDate.toISOString().slice(0, 10);
    const [
      monthExpensesResult,
      monthAllResult,
      recentResult,
      recentExpensesResult,
      recentIncomeResult,
      draftsResult,
    ] = await Promise.all([
      this.client
        .from("finance_transactions")
        .select("*")
        .eq("user_id", input.userId)
        .eq("transaction_type", "expense")
        .eq("status", "confirmed")
        .gte("occurred_on", monthStart)
        .lte("occurred_on", input.today)
        .order("occurred_on", { ascending: false }),
      this.client
        .from("finance_transactions")
        .select("*")
        .eq("user_id", input.userId)
        .eq("status", "confirmed")
        .gte("occurred_on", monthStart)
        .lte("occurred_on", input.today)
        .order("occurred_on", { ascending: false }),
      this.client
        .from("finance_transactions")
        .select("*")
        .eq("user_id", input.userId)
        .eq("status", "confirmed")
        .order("created_at", { ascending: false })
        .limit(10),
      this.client
        .from("finance_transactions")
        .select("*")
        .eq("user_id", input.userId)
        .eq("transaction_type", "expense")
        .eq("status", "confirmed")
        .order("created_at", { ascending: false })
        .limit(5),
      this.client
        .from("finance_transactions")
        .select("*")
        .eq("user_id", input.userId)
        .eq("transaction_type", "income")
        .eq("status", "confirmed")
        .order("created_at", { ascending: false })
        .limit(5),
      this.client
        .from("finance_transactions")
        .select("*")
        .eq("user_id", input.userId)
        .eq("status", "draft")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    if (monthExpensesResult.error) {
      throwSupabaseError(
        monthExpensesResult.error,
        "Failed to load monthly finance",
      );
    }
    if (monthAllResult.error) {
      throwSupabaseError(
        monthAllResult.error,
        "Failed to load monthly finance totals",
      );
    }
    if (recentResult.error) {
      throwSupabaseError(recentResult.error, "Failed to load recent finance");
    }
    if (recentExpensesResult.error) {
      throwSupabaseError(
        recentExpensesResult.error,
        "Failed to load recent expenses",
      );
    }
    if (recentIncomeResult.error) {
      throwSupabaseError(
        recentIncomeResult.error,
        "Failed to load recent income",
      );
    }
    if (draftsResult.error) {
      throwSupabaseError(draftsResult.error, "Failed to load finance drafts");
    }

    const summarizeExpenses = (
      rows: FinanceTransactionRow[],
      since: string,
    ): FinancePeriodSummary => {
      const matching = rows.filter((item) => item.occurred_on >= since);
      return {
        amount: matching.reduce(
          (total, item) => total + Number(item.base_amount ?? item.amount),
          0,
        ),
        count: matching.length,
      };
    };
    const categoryTotals = new Map<
      string,
      { category: string; amount: number; count: number }
    >();

    for (const item of monthExpensesResult.data) {
      const category = item.category_id
        ? (categoryNames.get(item.category_id) ?? "Other")
        : "Other";
      const current = categoryTotals.get(category) ?? {
        category,
        amount: 0,
        count: 0,
      };
      current.amount += Number(item.base_amount ?? item.amount);
      current.count += 1;
      categoryTotals.set(category, current);
    }

    let monthIncome = 0;
    let monthExpense = 0;

    for (const item of monthAllResult.data) {
      const amount = Number(item.base_amount ?? item.amount);

      if (item.transaction_type === "income") {
        monthIncome += amount;
      } else if (item.transaction_type === "expense") {
        monthExpense += amount;
      }
    }

    const budgets = await this.getBudgetSummary({
      userId: input.userId,
      today: input.today,
    });
    const recommendations = buildFinanceReportRecommendations({
      report: {
        totalExpense: monthExpense,
        categoryBreakdown: [...categoryTotals.values()]
          .sort((left, right) => right.amount - left.amount)
          .map((item) => ({
            ...item,
            percentOfTotal:
              monthExpense > 0
                ? Math.round((item.amount / monthExpense) * 100)
                : 0,
          })),
        periodComparison: null,
      },
      budgets,
    }).recommendations;

    const mapTransaction = (item: FinanceTransactionRow) =>
      toFinanceTransactionRecord(
        item,
        item.category_id ? (categoryNames.get(item.category_id) ?? null) : null,
      );
    const [recentReceipts, anomalyTransactions, baseCurrencyForAnomalies] =
      await Promise.all([
        this.listReceipts(input.userId),
        this.client
          .from("finance_transactions")
          .select("*")
          .eq("user_id", input.userId)
          .eq("status", "confirmed")
          .gte("occurred_on", monthStart)
          .lte("occurred_on", input.today)
          .order("occurred_on", { ascending: false }),
        this.getFinanceBaseCurrency(input.userId),
      ]);
    const anomalies = detectFinanceAnomalies({
      transactions: (anomalyTransactions.data ?? []).map((item) => ({
        amount: Number(item.base_amount ?? item.amount),
        currency: item.base_currency ?? baseCurrencyForAnomalies,
        categoryName: item.category_id
          ? (categoryNames.get(item.category_id) ?? null)
          : null,
        transactionType: item.transaction_type,
        occurredOn: item.occurred_on,
        merchant: item.merchant,
        description: item.description,
      })),
      currency: baseCurrencyForAnomalies,
    }).anomalies;

    return {
      currency: baseCurrency,
      baseCurrency,
      today: summarizeExpenses(monthExpensesResult.data, input.today),
      week: summarizeExpenses(monthExpensesResult.data, weekStart),
      month: summarizeExpenses(monthExpensesResult.data, monthStart),
      monthlySummary: {
        income: monthIncome,
        expense: monthExpense,
        net: monthIncome - monthExpense,
      },
      topCategories: [...categoryTotals.values()]
        .sort((left, right) => right.amount - left.amount)
        .slice(0, 5),
      budgets,
      recentTransactions: recentResult.data.map(mapTransaction),
      recentExpenses: recentExpensesResult.data.map(mapTransaction),
      recentIncome: recentIncomeResult.data.map(mapTransaction),
      recentReceipts: recentReceipts.slice(0, 5).map(toTmaReceiptSummary),
      anomalies: anomalies.slice(0, 5),
      recommendations,
      drafts: draftsResult.data.map(mapTransaction),
    };
  }

  async recordFinanceParseRun(input: {
    userId: string;
    inputText: string;
    parsedJson: Json;
    status: string;
    parser: string;
    confidence?: number | null;
    transactionId?: string | null;
    errorMessage?: string | null;
  }): Promise<void> {
    const { error } = await this.client.from("finance_ai_parse_runs").insert({
      user_id: input.userId,
      input_text: redactFinanceText(input.inputText),
      parsed_json: input.parsedJson,
      status: input.status,
      parser: input.parser,
      confidence: input.confidence ?? null,
      transaction_id: input.transactionId ?? null,
      error_message: input.errorMessage ?? null,
    });

    if (error) {
      throwSupabaseError(error, "Failed to record finance parse run");
    }
  }

  // ---------------------------------------------------------------------------
  // Budgets
  // ---------------------------------------------------------------------------

  async createBudget(input: CreateBudgetInput): Promise<FinanceBudgetRecord> {
    if (!Number.isFinite(input.amount) || input.amount < 0) {
      throw new Error("Budget amount must be non-negative");
    }

    const categories = await this.listFinanceCategories(input.userId);
    const categoryLimits = this.normalizeBudgetCategoryLimits(input);
    const categoryName = input.categoryId
      ? (categories.find((category) => category.id === input.categoryId)
          ?.name ?? null)
      : null;
    const amount = categoryLimits.length
      ? categoryLimits.reduce((total, item) => total + item.limit, 0)
      : input.amount;
    const period = input.period ?? "monthly";
    const currency = (input.currency ?? DEFAULT_FINANCE_CURRENCY).toUpperCase();

    const { data, error } = await this.client
      .from("finance_budgets")
      .insert({
        user_id: input.userId,
        category_id: input.categoryId ?? categoryLimits[0]?.categoryId ?? null,
        period,
        period_start: input.periodStart,
        period_end: input.periodEnd ?? null,
        amount,
        currency,
        name: input.name ?? null,
        notes: input.notes ?? null,
      })
      .select("*")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to create budget");
    }

    const limits = categoryLimits.length
      ? categoryLimits
      : input.categoryId
        ? [{ categoryId: input.categoryId, limit: input.amount, currency }]
        : [];
    await this.replaceBudgetCategoryLimits(
      input.userId,
      data.id,
      limits,
      currency,
    );

    return toFinanceBudgetRecord(data, categoryName, limits);
  }

  async updateBudget(input: UpdateBudgetInput): Promise<FinanceBudgetRecord> {
    const patch: Database["public"]["Tables"]["finance_budgets"]["Update"] = {};
    const normalizedLimits =
      input.categoryLimits === undefined
        ? undefined
        : this.normalizeBudgetCategoryLimits({
            amount: input.amount ?? 0,
            categoryLimits: input.categoryLimits,
          });

    if (input.amount !== undefined) {
      if (!Number.isFinite(input.amount) || input.amount < 0) {
        throw new Error("Budget amount must be non-negative");
      }
      patch.amount = input.amount;
    }

    if (normalizedLimits !== undefined) {
      patch.amount = normalizedLimits.reduce(
        (total, item) => total + item.limit,
        0,
      );
      patch.category_id = normalizedLimits[0]?.categoryId ?? null;
    }

    if (input.name !== undefined) patch.name = input.name;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.isActive !== undefined) patch.is_active = input.isActive;
    if (input.periodEnd !== undefined) patch.period_end = input.periodEnd;
    if (input.metadata !== undefined) patch.metadata = input.metadata as Json;

    const { data, error } = await this.client
      .from("finance_budgets")
      .update(patch)
      .eq("id", input.budgetId)
      .eq("user_id", input.userId)
      .select("*")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to update budget");
    }

    if (normalizedLimits !== undefined) {
      await this.replaceBudgetCategoryLimits(
        input.userId,
        data.id,
        normalizedLimits,
        data.currency,
      );
    }

    const categories = await this.listFinanceCategories(input.userId);
    const categoryName = data.category_id
      ? (categories.find((category) => category.id === data.category_id)
          ?.name ?? null)
      : null;
    const limits =
      normalizedLimits ??
      (await this.loadBudgetCategoryLimits(input.userId, [data.id])).get(
        data.id,
      ) ??
      [];

    return toFinanceBudgetRecord(data, categoryName, limits);
  }

  async deleteBudget(userId: string, budgetId: string): Promise<void> {
    const { error } = await this.client
      .from("finance_budgets")
      .delete()
      .eq("id", budgetId)
      .eq("user_id", userId);

    if (error) {
      throwSupabaseError(error, "Failed to delete budget");
    }
  }

  async archiveBudget(
    userId: string,
    budgetId: string,
  ): Promise<FinanceBudgetRecord> {
    const { data, error } = await this.client
      .from("finance_budgets")
      .update({
        archived_at: new Date().toISOString(),
        is_active: false,
      })
      .eq("id", budgetId)
      .eq("user_id", userId)
      .select("*")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to archive budget");
    }

    const categories = await this.listFinanceCategories(userId);
    const categoryName = data.category_id
      ? (categories.find((category) => category.id === data.category_id)
          ?.name ?? null)
      : null;
    const limits =
      (await this.loadBudgetCategoryLimits(userId, [data.id])).get(data.id) ??
      [];

    return toFinanceBudgetRecord(data, categoryName, limits);
  }

  async listBudgets(input: {
    userId: string;
    period?: FinanceBudgetPeriod;
    activeOnly?: boolean;
  }): Promise<FinanceBudgetRecord[]> {
    let query = this.client
      .from("finance_budgets")
      .select("*")
      .eq("user_id", input.userId)
      .order("period_start", { ascending: false });

    if (input.period) {
      query = query.eq("period", input.period);
    }

    if (input.activeOnly !== false) {
      query = query.eq("is_active", true).is("archived_at", null);
    }

    const { data, error } = await query;

    if (error) {
      throwSupabaseError(error, "Failed to list budgets");
    }

    const categories = await this.listFinanceCategories(input.userId);
    const categoryMap = new Map(
      categories.map((category) => [category.id, category.name]),
    );
    const limitsByBudget = await this.loadBudgetCategoryLimits(
      input.userId,
      data.map((row) => row.id),
    );

    return data.map((row) =>
      toFinanceBudgetRecord(
        row,
        row.category_id ? (categoryMap.get(row.category_id) ?? null) : null,
        limitsByBudget.get(row.id) ?? [],
      ),
    );
  }

  async getBudgetSummary(input: {
    userId: string;
    today: string;
  }): Promise<BudgetSummary[]> {
    const budgets = await this.listBudgets({
      userId: input.userId,
      activeOnly: true,
    });

    if (budgets.length === 0) return [];

    const earliestStart = budgets.reduce(
      (min, budget) => (budget.periodStart < min ? budget.periodStart : min),
      input.today,
    );

    const { data: transactions, error } = await this.client
      .from("finance_transactions")
      .select("category_id, amount, base_amount, occurred_on")
      .eq("user_id", input.userId)
      .eq("transaction_type", "expense")
      .eq("status", "confirmed")
      .gte("occurred_on", earliestStart)
      .lte("occurred_on", input.today);

    if (error) {
      throwSupabaseError(error, "Failed to load budget transactions");
    }

    const categories = await this.listFinanceCategories(input.userId);
    const categoryMap = new Map(
      categories.map((category) => [category.id, category.name]),
    );
    const summaries: BudgetSummary[] = [];

    for (const budget of budgets) {
      const periodEnd = financePeriodEnd(
        budget.periodStart,
        budget.period,
        budget.periodEnd,
      );
      const categoryLimits = budget.categoryLimits.length
        ? budget.categoryLimits
        : budget.categoryId
          ? [{ categoryId: budget.categoryId, limit: budget.amount }]
          : [];
      const categorySummaries = categoryLimits.map((limit) => {
        const spent = transactions
          .filter(
            (transaction) =>
              transaction.category_id === limit.categoryId &&
              transaction.occurred_on >= budget.periodStart &&
              transaction.occurred_on <= periodEnd,
          )
          .reduce(
            (sum, transaction) =>
              sum + Number(transaction.base_amount ?? transaction.amount),
            0,
          );
        const remaining = limit.limit - spent;
        const percentUsed =
          limit.limit > 0
            ? Math.round((spent / limit.limit) * 100)
            : spent > 0
              ? 100
              : 0;

        return {
          categoryId: limit.categoryId,
          categoryName: categoryMap.get(limit.categoryId) ?? "Other",
          limit: limit.limit,
          spent,
          remaining,
          percentUsed,
          isOverspent: remaining < 0,
        } satisfies BudgetCategorySummary;
      });
      const planned = categorySummaries.reduce(
        (total, category) => total + category.limit,
        0,
      );
      const spent = categorySummaries.reduce(
        (total, category) => total + category.spent,
        0,
      );
      const remaining = planned - spent;
      const overspent = Math.max(0, spent - planned);
      const percentUsed =
        planned > 0 ? Math.round((spent / planned) * 100) : spent > 0 ? 100 : 0;

      summaries.push({
        budgetId: budget.id,
        name: budget.name,
        period: budget.period,
        periodStart: budget.periodStart,
        periodEnd,
        currency: budget.currency,
        planned,
        spent,
        remaining,
        overspent,
        totalLimit: planned,
        totalSpent: spent,
        totalRemaining: remaining,
        totalPercentUsed: percentUsed,
        isOverspent: overspent > 0,
        categories: categorySummaries,
      });
    }

    return summaries;
  }
  // ---------------------------------------------------------------------------
  // Recurring Rules
  // ---------------------------------------------------------------------------

  async createRecurringRule(
    input: CreateRecurringRuleInput,
  ): Promise<FinanceRecurringRuleRecord> {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new Error("Recurring rule amount must be greater than zero");
    }

    const defaults = await this.ensureFinanceDefaults(input.userId);
    const categories = defaults.categories;
    const category =
      input.categoryId !== undefined
        ? (categories.find((item) => item.id === input.categoryId) ?? null)
        : input.categoryName
          ? (categories.find(
              (item) =>
                item.name.toLocaleLowerCase("en") ===
                input.categoryName!.trim().toLocaleLowerCase("en"),
            ) ?? null)
          : null;

    const { data, error } = await this.client
      .from("finance_recurring_rules")
      .insert({
        user_id: input.userId,
        account_id: defaults.account.id,
        category_id: category?.id ?? null,
        transaction_type: input.transactionType ?? "expense",
        amount: input.amount,
        currency: (input.currency ?? DEFAULT_FINANCE_CURRENCY).toUpperCase(),
        cadence: input.cadence,
        starts_on: input.startsOn,
        ends_on: input.endsOn ?? null,
        next_due_on: input.startsOn,
        merchant: input.merchant ?? null,
        description: input.description ?? null,
      })
      .select("*")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to create recurring rule");
    }

    return toFinanceRecurringRuleRecord(data, category?.name ?? null);
  }

  async updateRecurringRule(input: {
    userId: string;
    ruleId: string;
    amount?: number;
    cadence?: RecurringCadence;
    active?: boolean;
    description?: string | null;
  }): Promise<FinanceRecurringRuleRecord> {
    const patch: Database["public"]["Tables"]["finance_recurring_rules"]["Update"] =
      {};

    if (input.amount !== undefined) {
      if (!Number.isFinite(input.amount) || input.amount <= 0) {
        throw new Error("Recurring rule amount must be greater than zero");
      }
      patch.amount = input.amount;
    }

    if (input.cadence !== undefined) patch.cadence = input.cadence;
    if (input.active !== undefined) patch.active = input.active;
    if (input.description !== undefined) patch.description = input.description;

    const { data, error } = await this.client
      .from("finance_recurring_rules")
      .update(patch)
      .eq("id", input.ruleId)
      .eq("user_id", input.userId)
      .select("*")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to update recurring rule");
    }

    const categories = await this.listFinanceCategories(input.userId);
    const categoryName = data.category_id
      ? (categories.find((c) => c.id === data.category_id)?.name ?? null)
      : null;

    return toFinanceRecurringRuleRecord(data, categoryName);
  }

  async deleteRecurringRule(userId: string, ruleId: string): Promise<void> {
    const { error } = await this.client
      .from("finance_recurring_rules")
      .delete()
      .eq("id", ruleId)
      .eq("user_id", userId);

    if (error) {
      throwSupabaseError(error, "Failed to delete recurring rule");
    }
  }

  async listRecurringRules(
    userId: string,
  ): Promise<FinanceRecurringRuleRecord[]> {
    const { data, error } = await this.client
      .from("finance_recurring_rules")
      .select("*")
      .eq("user_id", userId)
      .eq("active", true)
      .order("next_due_on", { ascending: true });

    if (error) {
      throwSupabaseError(error, "Failed to list recurring rules");
    }

    const categories = await this.listFinanceCategories(userId);
    const categoryMap = new Map(categories.map((c) => [c.id, c.name]));

    return data.map((row) =>
      toFinanceRecurringRuleRecord(
        row,
        row.category_id ? (categoryMap.get(row.category_id) ?? null) : null,
      ),
    );
  }

  async processDueRecurringRules(
    userId: string,
    today: string,
  ): Promise<FinanceTransactionRecord[]> {
    const { data: dueRules, error } = await this.client
      .from("finance_recurring_rules")
      .select("*")
      .eq("user_id", userId)
      .eq("active", true)
      .lte("next_due_on", today);

    if (error) {
      throwSupabaseError(error, "Failed to load due recurring rules");
    }

    const created: FinanceTransactionRecord[] = [];

    for (const rule of dueRules) {
      const transaction = await this.createFinanceTransaction({
        userId,
        transactionType:
          rule.transaction_type === "income" ? "income" : "expense",
        amount: Number(rule.amount),
        currency: rule.currency,
        categoryId: rule.category_id,
        description: rule.description ?? rule.merchant ?? "Recurring",
        merchant: rule.merchant,
        occurredOn: rule.next_due_on ?? today,
        status: "confirmed",
        source: "recurring",
        metadata: { recurring_rule_id: rule.id },
      });

      created.push(transaction);

      // Advance next_due_on
      const cadence = rule.cadence as RecurringCadence;
      const nextDue = advanceNextDueDate(rule.next_due_on ?? today, cadence);
      const shouldDeactivate = rule.ends_on && nextDue > rule.ends_on;

      await this.client
        .from("finance_recurring_rules")
        .update({
          next_due_on: shouldDeactivate ? null : nextDue,
          active: !shouldDeactivate,
        })
        .eq("id", rule.id);
    }

    return created;
  }

  // ---------------------------------------------------------------------------
  // Tags
  // ---------------------------------------------------------------------------

  async createTag(
    userId: string,
    name: string,
    color?: string,
  ): Promise<FinanceTagRecord> {
    const trimmed = name.trim().toLowerCase();

    if (!trimmed) {
      throw new Error("Tag name is required");
    }

    const { data, error } = await this.client
      .from("finance_tags")
      .insert({
        user_id: userId,
        name: trimmed,
        color: color ?? null,
      })
      .select("*")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to create tag");
    }

    return toFinanceTagRecord(data);
  }

  async listTags(userId: string): Promise<FinanceTagRecord[]> {
    const { data, error } = await this.client
      .from("finance_tags")
      .select("*")
      .eq("user_id", userId)
      .order("name", { ascending: true });

    if (error) {
      throwSupabaseError(error, "Failed to list tags");
    }

    return data.map(toFinanceTagRecord);
  }

  async deleteTag(userId: string, tagId: string): Promise<void> {
    const { error } = await this.client
      .from("finance_tags")
      .delete()
      .eq("id", tagId)
      .eq("user_id", userId);

    if (error) {
      throwSupabaseError(error, "Failed to delete tag");
    }
  }

  private async assertFinanceTransactionOwnedByUser(
    userId: string,
    transactionId: string,
  ): Promise<void> {
    const { data, error } = await this.client
      .from("finance_transactions")
      .select("id")
      .eq("id", transactionId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throwSupabaseError(error, "Failed to verify finance transaction owner");
    }

    if (!data) {
      throw new Error("Finance transaction not found");
    }
  }

  private async assertFinanceTagsOwnedByUser(
    userId: string,
    tagIds: string[],
  ): Promise<void> {
    if (!tagIds.length) {
      return;
    }

    const { data, error } = await this.client
      .from("finance_tags")
      .select("id")
      .eq("user_id", userId)
      .in("id", tagIds);

    if (error) {
      throwSupabaseError(error, "Failed to verify finance tag owners");
    }

    if ((data ?? []).length !== tagIds.length) {
      throw new Error("Finance tag not found");
    }
  }

  async addTransactionTags(
    userId: string,
    transactionId: string,
    tagIds: string[],
  ): Promise<void> {
    const uniqueTagIds = [...new Set(tagIds)];

    if (uniqueTagIds.length === 0) return;

    await this.assertFinanceTransactionOwnedByUser(userId, transactionId);
    await this.assertFinanceTagsOwnedByUser(userId, uniqueTagIds);

    const rows = uniqueTagIds.map((tagId) => ({
      transaction_id: transactionId,
      tag_id: tagId,
    }));

    const { error } = await this.client
      .from("finance_transaction_tags")
      .upsert(rows, { onConflict: "transaction_id,tag_id" });

    if (error) {
      throwSupabaseError(error, "Failed to add transaction tags");
    }
  }

  async removeTransactionTags(
    userId: string,
    transactionId: string,
    tagIds: string[],
  ): Promise<void> {
    const uniqueTagIds = [...new Set(tagIds)];

    if (uniqueTagIds.length === 0) return;

    await this.assertFinanceTransactionOwnedByUser(userId, transactionId);
    await this.assertFinanceTagsOwnedByUser(userId, uniqueTagIds);

    const { error } = await this.client
      .from("finance_transaction_tags")
      .delete()
      .eq("transaction_id", transactionId)
      .in("tag_id", uniqueTagIds);

    if (error) {
      throwSupabaseError(error, "Failed to remove transaction tags");
    }
  }

  // ---------------------------------------------------------------------------
  // Reimbursements
  // ---------------------------------------------------------------------------

  async createReimbursement(
    input: CreateReimbursementInput,
  ): Promise<FinanceReimbursementRecord> {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new Error("Reimbursement amount must be greater than zero");
    }

    // Look up the original transaction to get the amount and currency
    const { data: transaction, error: txError } = await this.client
      .from("finance_transactions")
      .select("amount, currency")
      .eq("id", input.transactionId)
      .eq("user_id", input.userId)
      .single();

    if (txError) {
      throwSupabaseError(
        txError,
        "Failed to find transaction for reimbursement",
      );
    }

    const originalAmount = Number(transaction.amount);
    const status = input.amount >= originalAmount ? "completed" : "partial";

    const { data, error } = await this.client
      .from("finance_reimbursements")
      .insert({
        user_id: input.userId,
        transaction_id: input.transactionId,
        original_amount: originalAmount,
        reimbursed_amount: Math.min(input.amount, originalAmount),
        currency: transaction.currency,
        status,
        reimbursed_by: input.reimbursedBy ?? null,
        notes: input.notes ?? null,
        reimbursed_at: new Date().toISOString(),
      })
      .select("*")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to create reimbursement");
    }

    return toFinanceReimbursementRecord(data);
  }

  async listReimbursements(
    userId: string,
    status?: FinanceReimbursementStatus,
  ): Promise<FinanceReimbursementRecord[]> {
    let query = this.client
      .from("finance_reimbursements")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;

    if (error) {
      throwSupabaseError(error, "Failed to list reimbursements");
    }

    return data.map(toFinanceReimbursementRecord);
  }

  // ---------------------------------------------------------------------------
  // Receipts
  // ---------------------------------------------------------------------------

  async uploadReceiptImage(
    input: UploadReceiptImageInput,
  ): Promise<FinanceReceiptRecord> {
    const fileName = input.fileName.trim() || "receipt.jpg";
    const objectPath = `${input.userId}/${crypto.randomUUID()}-${fileName}`;
    const { error: uploadError } = await this.client.storage
      .from(FINANCE_RECEIPTS_BUCKET)
      .upload(objectPath, input.bytes, {
        contentType: input.mimeType,
        upsert: false,
      });

    if (uploadError) {
      throwSupabaseError(uploadError, "Failed to upload receipt image");
    }

    return this.createReceipt({
      userId: input.userId,
      storagePath: objectPath,
      fileName,
      mimeType: input.mimeType,
      metadata: {
        bucket: FINANCE_RECEIPTS_BUCKET,
      },
    });
  }

  async processReceiptImage(
    input: ProcessReceiptImageInput,
  ): Promise<FinanceReceiptRecord> {
    const receipt = await this.uploadReceiptImage(input);
    let ocrText = input.ocrText?.trim() ?? "";

    if (!ocrText && input.ai?.aiEnabled && input.ai.openRouterApiKey) {
      const imageBase64 = Buffer.from(input.bytes).toString("base64");
      ocrText =
        (await extractReceiptOcrText(imageBase64, input.mimeType, input.ai)) ??
        "";
    }

    if (!ocrText) {
      const { data, error } = await this.client
        .from("finance_receipts")
        .update({
          status: "needs_review",
          error_message: "ocr_text_missing",
          processed_at: new Date().toISOString(),
          openrouter_model: input.ai?.model ?? null,
        })
        .eq("id", receipt.id)
        .eq("user_id", input.userId)
        .select("*")
        .single();

      if (error) {
        throwSupabaseError(error, "Failed to mark receipt for review");
      }

      return toFinanceReceiptRecord(data);
    }

    return this.processReceiptOcrText({
      userId: input.userId,
      receiptId: receipt.id,
      ocrText,
      ai: input.ai,
    });
  }

  async createReceipt(
    input: CreateReceiptInput,
  ): Promise<FinanceReceiptRecord> {
    const storagePath = input.storagePath.trim();

    if (!storagePath) {
      throw new Error("Receipt storage path is required");
    }

    const { data, error } = await this.client
      .from("finance_receipts")
      .insert({
        user_id: input.userId,
        storage_path: storagePath,
        file_name: input.fileName ?? null,
        mime_type: input.mimeType ?? null,
        ocr_json: input.ocrJson ?? {},
        metadata: input.metadata ?? {},
      })
      .select("*")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to create receipt");
    }

    return toFinanceReceiptRecord(data);
  }

  async processReceiptOcrText(
    input: ProcessReceiptOcrTextInput,
  ): Promise<FinanceReceiptRecord> {
    const { data: receipt, error: receiptError } = await this.client
      .from("finance_receipts")
      .update({
        status: "processing",
        ocr_text: redactFinanceText(input.ocrText),
      })
      .eq("id", input.receiptId)
      .eq("user_id", input.userId)
      .select("*")
      .single();

    if (receiptError) {
      throwSupabaseError(receiptError, "Failed to load receipt");
    }

    const parsed = await parseReceiptText(input.ocrText, {
      aiEnabled: input.ai?.aiEnabled,
      openRouterApiKey: input.ai?.openRouterApiKey,
      model: input.ai?.model,
      fetchImpl: input.ai?.fetchImpl,
    });
    const validation = validateReceiptParse(parsed);

    if (validation.status === "needs_review" || !validation.result) {
      const { data, error } = await this.client
        .from("finance_receipts")
        .update({
          status: "needs_review",
          parsed_json: (parsed ?? {}) as unknown as Json,
          error_message:
            validation.missingFields.length > 0
              ? `missing:${validation.missingFields.join(",")}`
              : "receipt_parse_failed",
          processed_at: new Date().toISOString(),
          openrouter_model: input.ai?.model ?? null,
        })
        .eq("id", receipt.id)
        .select("*")
        .single();

      if (error) {
        throwSupabaseError(error, "Failed to mark receipt for review");
      }

      await this.recordFinanceAiAnalysisRun({
        userId: input.userId,
        requestType: "receipt_parse",
        prompt: "Parse receipt OCR text",
        inputJson: {
          receiptId: receipt.id,
          missingFields: validation.missingFields,
        } as Json,
        outputJson: { parsed: parsed ?? null, validation } as unknown as Json,
        model: input.ai?.model ?? null,
        status: "failed",
        errorMessage: "receipt_needs_review",
      });

      return toFinanceReceiptRecord(data);
    }

    const receiptData = validation.result;
    const receiptStatus =
      validation.status === "partial" ? "partial" : "linked";
    const transaction = await this.createFinanceTransaction({
      userId: input.userId,
      transactionType: "expense",
      amount: receiptData.amount,
      currency: receiptData.currency,
      category: receiptData.category,
      merchant: receiptData.merchant,
      description: receiptData.merchant,
      occurredOn: receiptData.date,
      source: "receipt_import",
      receiptId: receipt.id,
      confidence: receiptData.confidence,
      status: validation.status === "partial" ? "draft" : "confirmed",
      metadata: {
        receiptId: receipt.id,
        receiptStoragePath: receipt.storage_path,
        receiptValidation: validation.status,
        missingFields: validation.missingFields,
      },
    });

    await this.insertReceiptItems(input.userId, receipt.id, receiptData);

    const { data, error } = await this.client
      .from("finance_receipts")
      .update({
        parsed_json: receiptData as unknown as Json,
        status: receiptStatus,
        transaction_id: transaction.id,
        processed_at: new Date().toISOString(),
        openrouter_model: input.ai?.model ?? null,
        error_message:
          validation.status === "partial"
            ? `missing:${validation.missingFields.join(",")}`
            : null,
      })
      .eq("id", receipt.id)
      .select("*")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to finalize receipt");
    }

    await this.recordFinanceAiAnalysisRun({
      userId: input.userId,
      requestType: "receipt_parse",
      prompt: "Parse receipt OCR text",
      inputJson: { receiptId: receipt.id } as Json,
      outputJson: receiptData as unknown as Json,
      model: input.ai?.model ?? null,
      status: "completed",
    });

    const items =
      (await this.loadReceiptItems(input.userId, [receipt.id])).get(
        receipt.id,
      ) ?? [];

    return toFinanceReceiptRecord(data, items);
  }

  async listReceipts(userId: string): Promise<FinanceReceiptRecord[]> {
    const { data, error } = await this.client
      .from("finance_receipts")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      throwSupabaseError(error, "Failed to list receipts");
    }

    const itemsByReceipt = await this.loadReceiptItems(
      userId,
      data.map((receipt) => receipt.id),
    );

    return data.map((receipt) =>
      toFinanceReceiptRecord(receipt, itemsByReceipt.get(receipt.id) ?? []),
    );
  }

  async syncFinanceExchangeRates(input?: {
    fetchImpl?: typeof fetch;
  }): Promise<number> {
    try {
      const quotes = await fetchDailyExchangeRates(input?.fetchImpl);

      if (!quotes.length) {
        return 0;
      }

      const { error } = await this.client.from("finance_exchange_rates").upsert(
        quotes.map((quote) => ({
          from_currency: quote.fromCurrency,
          to_currency: quote.toCurrency,
          rate: quote.rate,
          rate_date: quote.rateDate,
          source: quote.source,
        })),
        { onConflict: "from_currency,to_currency,rate_date" },
      );

      if (error) {
        throwSupabaseError(error, "Failed to sync finance exchange rates");
      }

      return quotes.length;
    } catch (error) {
      console.error("[finance] exchange rate sync failed", {
        errorType: error instanceof Error ? error.name : typeof error,
      });
      return 0;
    }
  }

  async detectFinanceAnomaliesForUser(input: {
    userId: string;
    today: string;
  }): Promise<FinanceAnomaly[]> {
    const monthBounds = financeReportPeriodBounds("monthly", input.today);
    const categories = await this.listFinanceCategories(input.userId);
    const categoryMap = new Map(categories.map((item) => [item.id, item.name]));
    const baseCurrency = await this.getFinanceBaseCurrency(input.userId);
    const { data, error } = await this.client
      .from("finance_transactions")
      .select("*")
      .eq("user_id", input.userId)
      .eq("status", "confirmed")
      .gte("occurred_on", monthBounds.startDate)
      .lte("occurred_on", input.today)
      .order("occurred_on", { ascending: false });

    if (error) {
      throwSupabaseError(error, "Failed to load finance anomalies");
    }

    const transactions = data.map((item) => ({
      amount: Number(item.base_amount ?? item.amount),
      currency: item.base_currency ?? baseCurrency,
      categoryName: item.category_id
        ? (categoryMap.get(item.category_id) ?? null)
        : null,
      transactionType: item.transaction_type,
      occurredOn: item.occurred_on,
      merchant: item.merchant,
      description: item.description,
    })) satisfies FinanceAssistantContext["recentTransactions"];
    const result = detectFinanceAnomalies({
      transactions,
      currency: baseCurrency,
    });

    await this.recordFinanceAiAnalysisRun({
      userId: input.userId,
      requestType: "anomaly_detection",
      prompt: "Detect finance spending anomalies",
      inputJson: {
        startDate: monthBounds.startDate,
        endDate: input.today,
        transactionCount: transactions.length,
      } as Json,
      outputJson: result as unknown as Json,
      model: null,
      status: "completed",
    });

    return result.anomalies;
  }

  async buildFinanceAssistantContext(input: {
    userId: string;
    today: string;
  }): Promise<FinanceAssistantContext & { anomalies: FinanceAnomaly[] }> {
    const monthBounds = financeReportPeriodBounds("monthly", input.today);
    const [report, budgets, categories, baseCurrency] = await Promise.all([
      this.getFinanceReport({
        userId: input.userId,
        period: "monthly",
        startDate: monthBounds.startDate,
        endDate: monthBounds.endDate,
      }),
      this.getBudgetSummary({ userId: input.userId, today: input.today }),
      this.listFinanceCategories(input.userId),
      this.getFinanceBaseCurrency(input.userId),
    ]);
    const categoryMap = new Map(categories.map((item) => [item.id, item.name]));
    const { data, error } = await this.client
      .from("finance_transactions")
      .select("*")
      .eq("user_id", input.userId)
      .eq("status", "confirmed")
      .gte("occurred_on", monthBounds.startDate)
      .lte("occurred_on", input.today)
      .order("occurred_on", { ascending: false })
      .limit(20);

    if (error) {
      throwSupabaseError(
        error,
        "Failed to load finance assistant transactions",
      );
    }

    const recentTransactions = data.map((item) => ({
      amount: Number(item.base_amount ?? item.amount),
      currency: item.base_currency ?? baseCurrency,
      categoryName: item.category_id
        ? (categoryMap.get(item.category_id) ?? null)
        : null,
      transactionType: item.transaction_type,
      occurredOn: item.occurred_on,
      merchant: item.merchant,
      description: item.description,
    })) satisfies FinanceAssistantContext["recentTransactions"];
    const anomalies = detectFinanceAnomalies({
      transactions: recentTransactions,
      currency: baseCurrency,
    }).anomalies;

    return {
      report,
      budgets,
      recentTransactions,
      anomalies,
    };
  }

  async askFinanceAssistant(input: {
    userId: string;
    question: string;
    today: string;
    ai?: FinanceAssistantOptions;
  }): Promise<FinanceAssistantResult> {
    const context = await this.buildFinanceAssistantContext({
      userId: input.userId,
      today: input.today,
    });
    const deterministic = interpretFinanceQuestion(input.question, {
      ...context,
      today: input.today,
    });

    if (deterministic) {
      await this.recordFinanceAiAnalysisRun({
        userId: input.userId,
        requestType: "assistant_query",
        prompt: input.question,
        inputJson: context as unknown as Json,
        outputJson: deterministic as unknown as Json,
        model: null,
        status: "completed",
      });
      return deterministic;
    }

    return this.answerFinanceQuestion({
      userId: input.userId,
      question: input.question,
      context,
      ai: input.ai,
    });
  }

  // ---------------------------------------------------------------------------
  // Finance Reports
  // ---------------------------------------------------------------------------

  async getFinanceReport(input: {
    userId: string;
    period: FinanceReportPeriod;
    startDate: string;
    endDate: string;
  }): Promise<FinanceReportData> {
    const [categories, baseCurrency] = await Promise.all([
      this.listFinanceCategories(input.userId),
      this.getFinanceBaseCurrency(input.userId),
    ]);
    const categoryMap = new Map(categories.map((c) => [c.id, c.name]));

    const { data: transactions, error } = await this.client
      .from("finance_transactions")
      .select("*")
      .eq("user_id", input.userId)
      .eq("status", "confirmed")
      .gte("occurred_on", input.startDate)
      .lte("occurred_on", input.endDate)
      .order("occurred_on", { ascending: true });

    if (error) {
      throwSupabaseError(error, "Failed to load finance report transactions");
    }

    let totalIncome = 0;
    let totalExpense = 0;
    const categoryTotals = new Map<
      string,
      { category: string; amount: number; count: number }
    >();
    const merchantTotals = new Map<
      string,
      { merchant: string; amount: number; count: number }
    >();
    const dailyMap = new Map<
      string,
      { date: string; income: number; expense: number }
    >();

    for (const tx of transactions) {
      const amount = Number(tx.base_amount ?? tx.amount);

      if (tx.transaction_type === "income") {
        totalIncome += amount;
      } else {
        totalExpense += amount;
      }

      // Category breakdown (expenses only)
      if (tx.transaction_type === "expense") {
        const categoryName = tx.category_id
          ? (categoryMap.get(tx.category_id) ?? "Other")
          : "Other";
        const existing = categoryTotals.get(categoryName) ?? {
          category: categoryName,
          amount: 0,
          count: 0,
        };
        existing.amount += amount;
        existing.count += 1;
        categoryTotals.set(categoryName, existing);
      }

      // Merchant breakdown
      if (tx.merchant) {
        const existing = merchantTotals.get(tx.merchant) ?? {
          merchant: tx.merchant,
          amount: 0,
          count: 0,
        };
        existing.amount += amount;
        existing.count += 1;
        merchantTotals.set(tx.merchant, existing);
      }

      // Daily trend
      const day = tx.occurred_on;
      const dayEntry = dailyMap.get(day) ?? {
        date: day,
        income: 0,
        expense: 0,
      };
      if (tx.transaction_type === "income") {
        dayEntry.income += amount;
      } else {
        dayEntry.expense += amount;
      }
      dailyMap.set(day, dayEntry);
    }

    const sortedCategories = [...categoryTotals.values()]
      .sort((a, b) => b.amount - a.amount)
      .map((c) => ({
        ...c,
        percentOfTotal:
          totalExpense > 0 ? Math.round((c.amount / totalExpense) * 100) : 0,
      }));

    const previousBounds = previousFinanceReportPeriodBounds({
      period: input.period,
      startDate: input.startDate,
      endDate: input.endDate,
    });
    const { data: previousTransactions, error: previousError } =
      await this.client
        .from("finance_transactions")
        .select("base_amount, amount, transaction_type")
        .eq("user_id", input.userId)
        .eq("status", "confirmed")
        .eq("transaction_type", "expense")
        .gte("occurred_on", previousBounds.startDate)
        .lte("occurred_on", previousBounds.endDate);

    if (previousError) {
      throwSupabaseError(
        previousError,
        "Failed to load previous finance report period",
      );
    }

    const previousPeriodExpense = (previousTransactions ?? []).reduce(
      (sum, transaction) =>
        sum + Number(transaction.base_amount ?? transaction.amount),
      0,
    );
    const changePercent =
      previousPeriodExpense > 0
        ? Math.round(
            ((totalExpense - previousPeriodExpense) / previousPeriodExpense) *
              100,
          )
        : totalExpense > 0
          ? 100
          : 0;
    const changeDirection: "up" | "down" | "flat" =
      changePercent > 5 ? "up" : changePercent < -5 ? "down" : "flat";

    const budgets = await this.getBudgetSummary({
      userId: input.userId,
      today: input.endDate,
    });
    const reportBase = {
      period: input.period,
      startDate: input.startDate,
      endDate: input.endDate,
      currency: baseCurrency,
      totalIncome,
      totalExpense,
      netFlow: totalIncome - totalExpense,
      categoryBreakdown: sortedCategories,
      dailyTrend: [...dailyMap.values()],
      topMerchants: [...merchantTotals.values()]
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 10),
      periodComparison: {
        previousPeriodExpense,
        changePercent: Math.abs(changePercent),
        changeDirection,
      },
      overspentBudgets: [] as FinanceReportData["overspentBudgets"],
      recommendations: [] as string[],
    };
    const insights = buildFinanceReportRecommendations({
      report: reportBase,
      budgets,
    });

    return {
      ...reportBase,
      overspentBudgets: insights.overspentBudgets,
      recommendations: insights.recommendations,
    };
  }

  async answerFinanceQuestion(input: {
    userId: string;
    question: string;
    context: FinanceAssistantContext;
    ai?: FinanceAssistantOptions;
  }): Promise<FinanceAssistantResult> {
    const result = await analyzeFinanceQuestion(
      input.question,
      input.context,
      input.ai,
    );

    await this.recordFinanceAiAnalysisRun({
      userId: input.userId,
      requestType: "assistant_query",
      prompt: input.question,
      inputJson: input.context as unknown as Json,
      outputJson: result as unknown as Json,
      model: result.model,
      status: "completed",
    });

    return result;
  }

  async recordFinanceAiAnalysisRun(input: {
    userId: string;
    requestType: string;
    prompt: string;
    inputJson: Json;
    outputJson?: Json;
    model?: string | null;
    status?: "pending" | "completed" | "failed";
    errorMessage?: string | null;
  }): Promise<FinanceAiAnalysisRunRecord> {
    const { data, error } = await this.client
      .from("finance_ai_analysis_runs")
      .insert({
        user_id: input.userId,
        request_type: input.requestType,
        prompt: input.prompt,
        input_json: input.inputJson,
        output_json: input.outputJson ?? {},
        model: input.model ?? null,
        status: input.status ?? "pending",
        error_message: input.errorMessage ?? null,
      })
      .select("*")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to record finance AI analysis run");
    }

    return toFinanceAiAnalysisRunRecord(data);
  }

  async exportFinanceReport(input: {
    userId: string;
    period: FinanceReportPeriod;
    startDate: string;
    endDate: string;
    format: "csv" | "xlsx" | "pdf";
  }): Promise<FinanceExportResult> {
    const report = await this.getFinanceReport(input);
    const baseName = `lifeos-finance-${input.period}-${input.startDate}-${input.endDate}`;

    if (input.format === "csv") {
      return {
        fileName: `${baseName}.csv`,
        contentType: "text/csv; charset=utf-8",
        body: financeReportCsv(report),
      };
    }

    if (input.format === "xlsx") {
      return {
        fileName: `${baseName}.xlsx`,
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        body: financeReportXlsx(report),
      };
    }

    return {
      fileName: `${baseName}.pdf`,
      contentType: "application/pdf",
      body: financeReportPdf(report),
    };
  }

  async generateMonthlyReview(input: {
    userId: string;
    periodMonth: string;
    regenerate?: boolean;
  }): Promise<MonthlyReviewRecord> {
    const bounds = monthlyReviewBounds(input.periodMonth);
    const existing = await this.getMonthlyReview(
      input.userId,
      input.periodMonth,
    );

    if (existing?.status === "generated" && !input.regenerate) {
      return existing;
    }

    const stats = await this.aggregateMonthlyReviewStats(
      input.userId,
      input.periodMonth,
    );
    const reportTitle = `LifeOS Monthly Review — ${input.periodMonth}`;
    const reportMarkdown = buildMonthlyReviewMarkdown(stats);
    const obsidianPath = `Reviews/Monthly/${input.periodMonth}-LifeOS-Review.md`;
    const now = new Date().toISOString();
    const { data, error } = await this.client
      .from("monthly_reviews")
      .upsert(
        {
          user_id: input.userId,
          period_month: input.periodMonth,
          status: "generated",
          report_title: reportTitle,
          report_markdown: reportMarkdown,
          ai_model: null,
          ai_input_json: stats as unknown as Json,
          ai_output_json: { fallback: true },
          stats_json: stats as unknown as Json,
          obsidian_path: obsidianPath,
          generated_at: now,
          error_message: null,
        },
        { onConflict: "user_id,period_month" },
      )
      .select("*")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to upsert monthly review");
    }

    const review = toMonthlyReviewRecord(data);
    await this.syncMonthlyReviewObsidian(review, bounds.startDate);
    return review;
  }

  async getMonthlyReview(
    userId: string,
    periodMonth: string,
  ): Promise<MonthlyReviewRecord | null> {
    const { data, error } = await this.client
      .from("monthly_reviews")
      .select("*")
      .eq("user_id", userId)
      .eq("period_month", periodMonth)
      .maybeSingle();

    if (error) {
      throwSupabaseError(error, "Failed to load monthly review");
    }

    return data ? toMonthlyReviewRecord(data) : null;
  }

  async getLatestMonthlyReview(
    userId: string,
  ): Promise<MonthlyReviewRecord | null> {
    const { data, error } = await this.client
      .from("monthly_reviews")
      .select("*")
      .eq("user_id", userId)
      .order("period_month", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throwSupabaseError(error, "Failed to load latest monthly review");
    }

    return data ? toMonthlyReviewRecord(data) : null;
  }

  async getTmaMonthlyReviewSummary(
    userId: string,
  ): Promise<TmaMonthlyReviewSummary> {
    return {
      latest: await this.getLatestMonthlyReview(userId),
    };
  }

  private async aggregateMonthlyReviewStats(
    userId: string,
    periodMonth: string,
  ): Promise<MonthlyReviewStats> {
    const bounds = monthlyReviewBounds(periodMonth);
    const [
      transactionsResult,
      categoriesResult,
      healthResult,
      remindersResult,
      sourceEventsResult,
    ] = await Promise.all([
      this.client
        .from("finance_transactions")
        .select("*")
        .eq("user_id", userId)
        .gte("occurred_on", bounds.startDate)
        .lt("occurred_on", bounds.nextMonthDate),
      this.client
        .from("finance_categories")
        .select("*")
        .eq("user_id", userId)
        .is("archived_at", null),
      this.client
        .from("health_metrics")
        .select("*")
        .eq("user_id", userId)
        .gte("metric_date", bounds.startDate)
        .lt("metric_date", bounds.nextMonthDate),
      this.client
        .from("reminders")
        .select("*")
        .eq("user_id", userId)
        .gte("created_at", `${bounds.startDate}T00:00:00.000Z`)
        .lt("created_at", `${bounds.nextMonthDate}T00:00:00.000Z`),
      this.client
        .from("source_events")
        .select("*")
        .eq("user_id", userId)
        .gte("created_at", `${bounds.startDate}T00:00:00.000Z`)
        .lt("created_at", `${bounds.nextMonthDate}T00:00:00.000Z`),
    ]);

    if (transactionsResult.error) {
      throwSupabaseError(
        transactionsResult.error,
        "Failed to load monthly finance rows",
      );
    }
    if (categoriesResult.error) {
      throwSupabaseError(
        categoriesResult.error,
        "Failed to load monthly finance categories",
      );
    }
    if (healthResult.error) {
      throwSupabaseError(
        healthResult.error,
        "Failed to load monthly health metrics",
      );
    }
    if (remindersResult.error) {
      throwSupabaseError(
        remindersResult.error,
        "Failed to load monthly reminders",
      );
    }
    if (sourceEventsResult.error) {
      throwSupabaseError(
        sourceEventsResult.error,
        "Failed to load monthly source events",
      );
    }

    const categoryNames = new Map(
      categoriesResult.data.map((item) => [item.id, item.name]),
    );

    return aggregateMonthlyReviewStats({
      periodMonth,
      transactions: transactionsResult.data.map((item) => ({
        amount: Number(item.base_amount ?? item.amount),
        transactionType: item.transaction_type,
        status: item.status,
        category: item.category_id
          ? (categoryNames.get(item.category_id) ?? null)
          : null,
        description: item.description,
        merchant: item.merchant,
        occurredOn: item.occurred_on,
      })),
      healthMetrics: healthResult.data.map((item) => ({
        metricDate: item.metric_date,
        metricType: item.metric_type,
        value: Number(item.value),
      })),
      reminders: remindersResult.data.map((item) => {
        const metadata = jsonObject(item.metadata_json);
        return {
          status: item.status,
          source:
            typeof metadata.source === "string" ? metadata.source : "manual",
          createdAt: item.created_at,
          sentAt: item.sent_at,
        };
      }),
      sourceEvents: sourceEventsResult.data.map((item) => ({
        sourceKey: item.source_key,
        status: item.status,
      })),
    });
  }

  private async syncMonthlyReviewObsidian(
    review: MonthlyReviewRecord,
    occurredAtDate: string,
  ): Promise<void> {
    const { data: existing, error: existingError } = await this.client
      .from("life_entities")
      .select("*")
      .eq("user_id", review.userId)
      .eq("linked_table", "monthly_reviews")
      .eq("linked_id", review.id)
      .maybeSingle();

    if (existingError) {
      throwSupabaseError(
        existingError,
        "Failed to load monthly review life entity",
      );
    }

    const row = {
      user_id: review.userId,
      entity_type: "review" as const,
      domain: "review",
      status: review.status,
      title:
        review.reportTitle ?? `LifeOS Monthly Review — ${review.periodMonth}`,
      body: review.reportMarkdown,
      occurred_at: `${occurredAtDate}T00:00:00.000Z`,
      source: "monthly_review",
      source_command: "/monthly_review",
      linked_table: "monthly_reviews",
      linked_id: review.id,
      metadata: {
        periodMonth: review.periodMonth,
        obsidianPath: review.obsidianPath,
        status: review.status,
      },
      raw_payload_json: {
        stats: review.statsJson,
      },
    };
    const query = existing
      ? this.client.from("life_entities").update(row).eq("id", existing.id)
      : this.client.from("life_entities").insert(row);
    const { data, error } = await query.select("*").single();

    if (error) {
      throwSupabaseError(error, "Failed to upsert monthly review life entity");
    }

    await this.enqueueObsidianSync({
      userId: review.userId,
      lifeEntityId: data.id,
      entityType: "review",
      action: "upsert",
      targetPath: review.obsidianPath,
      payload: {
        periodMonth: review.periodMonth,
        monthlyReviewId: review.id,
      },
    });
  }

  private async resolveBaseMoney(input: {
    amount: number;
    currency: string;
    baseCurrency: string;
    occurredOn: string;
    baseAmount?: number | null;
    exchangeRate?: number | null;
    exchangeRateDate?: string | null;
  }): Promise<{
    baseAmount: number | null;
    baseCurrency: string;
    exchangeRate: number | null;
    exchangeRateDate: string | null;
  }> {
    if (input.baseAmount !== undefined || input.exchangeRate !== undefined) {
      const baseAmount =
        input.baseAmount ??
        (input.exchangeRate === null || input.exchangeRate === undefined
          ? null
          : Math.round(input.amount * input.exchangeRate * 100) / 100);

      return {
        baseAmount,
        baseCurrency: input.baseCurrency,
        exchangeRate: input.exchangeRate ?? null,
        exchangeRateDate: input.exchangeRateDate ?? input.occurredOn,
      };
    }

    if (input.currency === input.baseCurrency) {
      return {
        baseAmount: input.amount,
        baseCurrency: input.baseCurrency,
        exchangeRate: 1,
        exchangeRateDate: input.occurredOn,
      };
    }

    const { data, error } = await this.client
      .from("finance_exchange_rates")
      .select("*")
      .eq("from_currency", input.currency)
      .eq("to_currency", input.baseCurrency)
      .lte("rate_date", input.occurredOn)
      .order("rate_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throwSupabaseError(error, "Failed to resolve finance exchange rate");
    }

    if (!data) {
      return {
        baseAmount: input.amount,
        baseCurrency: input.baseCurrency,
        exchangeRate: 1,
        exchangeRateDate: input.occurredOn,
      };
    }

    const rate = Number(data.rate);

    return {
      baseAmount: Math.round(input.amount * rate * 100) / 100,
      baseCurrency: input.baseCurrency,
      exchangeRate: rate,
      exchangeRateDate: data.rate_date,
    };
  }

  private normalizeBudgetCategoryLimits(input: {
    categoryId?: string | null;
    amount: number;
    currency?: string;
    categoryLimits?: FinanceBudgetCategoryLimit[];
  }): FinanceBudgetCategoryLimit[] {
    const source = input.categoryLimits?.length
      ? input.categoryLimits
      : input.categoryId
        ? [
            {
              categoryId: input.categoryId,
              limit: input.amount,
              currency: input.currency,
            },
          ]
        : [];

    return source.map((item) => {
      if (!item.categoryId) {
        throw new Error("Budget category id is required");
      }

      if (!Number.isFinite(item.limit) || item.limit < 0) {
        throw new Error("Budget category limit must be non-negative");
      }

      return {
        categoryId: item.categoryId,
        limit: item.limit,
        currency: item.currency?.toUpperCase(),
      };
    });
  }

  private async loadBudgetCategoryLimits(
    userId: string,
    budgetIds: string[],
  ): Promise<Map<string, FinanceBudgetCategoryLimit[]>> {
    if (!budgetIds.length) {
      return new Map();
    }

    const { data, error } = await this.client
      .from("finance_budget_categories")
      .select("*")
      .eq("user_id", userId)
      .in("budget_id", budgetIds);

    if (error) {
      throwSupabaseError(error, "Failed to load budget category limits");
    }

    const grouped = new Map<string, FinanceBudgetCategoryLimit[]>();

    for (const row of data) {
      const current = grouped.get(row.budget_id) ?? [];
      current.push(toFinanceBudgetCategoryLimit(row));
      grouped.set(row.budget_id, current);
    }

    return grouped;
  }

  private async replaceBudgetCategoryLimits(
    userId: string,
    budgetId: string,
    limits: FinanceBudgetCategoryLimit[],
    defaultCurrency: string,
  ): Promise<void> {
    const { error: deleteError } = await this.client
      .from("finance_budget_categories")
      .delete()
      .eq("user_id", userId)
      .eq("budget_id", budgetId);

    if (deleteError) {
      throwSupabaseError(deleteError, "Failed to replace budget categories");
    }

    if (!limits.length) {
      return;
    }

    const { error: insertError } = await this.client
      .from("finance_budget_categories")
      .insert(
        limits.map((limit) => ({
          user_id: userId,
          budget_id: budgetId,
          category_id: limit.categoryId,
          limit_amount: limit.limit,
          currency: (limit.currency ?? defaultCurrency).toUpperCase(),
        })),
      );

    if (insertError) {
      throwSupabaseError(insertError, "Failed to insert budget categories");
    }
  }

  private async insertReceiptItems(
    userId: string,
    receiptId: string,
    parsed: ReceiptParseResult,
  ): Promise<void> {
    if (!parsed.items.length) {
      return;
    }

    const { error } = await this.client.from("finance_receipt_items").insert(
      parsed.items.map((item) => ({
        user_id: userId,
        receipt_id: receiptId,
        name: item.name,
        quantity: item.quantity,
        unit_price: item.quantity > 0 ? item.price / item.quantity : item.price,
        total_amount: item.price,
        currency: parsed.currency,
      })),
    );

    if (error) {
      throwSupabaseError(error, "Failed to insert receipt items");
    }
  }

  private async loadReceiptItems(
    userId: string,
    receiptIds: string[],
  ): Promise<Map<string, FinanceReceiptItemRecord[]>> {
    if (!receiptIds.length) {
      return new Map();
    }

    const { data, error } = await this.client
      .from("finance_receipt_items")
      .select("*")
      .eq("user_id", userId)
      .in("receipt_id", receiptIds)
      .order("created_at", { ascending: true });

    if (error) {
      throwSupabaseError(error, "Failed to load receipt items");
    }

    const grouped = new Map<string, FinanceReceiptItemRecord[]>();

    for (const row of data) {
      const current = grouped.get(row.receipt_id) ?? [];
      current.push(toFinanceReceiptItemRecord(row));
      grouped.set(row.receipt_id, current);
    }

    return grouped;
  }

  private async syncTransactionTagRows(
    userId: string,
    transactionId: string,
    tagNames: string[],
  ): Promise<void> {
    const normalized = normalizeFinanceTags(tagNames);

    if (!normalized.length) {
      return;
    }

    const { error: upsertError } = await this.client
      .from("finance_tags")
      .upsert(
        normalized.map((name) => ({
          user_id: userId,
          name,
        })),
        { onConflict: "user_id,name" },
      );

    if (upsertError) {
      throwSupabaseError(upsertError, "Failed to upsert finance tags");
    }

    const { data: tags, error: loadError } = await this.client
      .from("finance_tags")
      .select("id")
      .eq("user_id", userId)
      .in("name", normalized);

    if (loadError) {
      throwSupabaseError(loadError, "Failed to load finance tags");
    }

    const { error: linkError } = await this.client
      .from("finance_transaction_tags")
      .upsert(
        tags.map((tag) => ({
          transaction_id: transactionId,
          tag_id: tag.id,
        })),
        { onConflict: "transaction_id,tag_id" },
      );

    if (linkError) {
      throwSupabaseError(linkError, "Failed to link finance tags");
    }
  }

  private async ensureFinanceDefaults(userId: string): Promise<{
    account: FinanceAccountRow;
    categories: FinanceCategoryRow[];
  }> {
    const { data: existingAccount, error: accountError } = await this.client
      .from("finance_accounts")
      .select("*")
      .eq("user_id", userId)
      .is("archived_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (accountError) {
      throwSupabaseError(accountError, "Failed to load finance account");
    }

    let account = existingAccount;

    if (!account) {
      const baseCurrency = await this.getFinanceBaseCurrency(userId);
      const { data, error } = await this.client
        .from("finance_accounts")
        .insert({
          user_id: userId,
          name: "Main",
          account_type: "cash",
          currency: baseCurrency,
          is_default: true,
          metadata: { is_default: true },
        })
        .select("*")
        .single();

      if (error) {
        throwSupabaseError(error, "Failed to create default finance account");
      }

      account = data;
    }

    const { data: existingCategories, error: categoriesError } =
      await this.client
        .from("finance_categories")
        .select("*")
        .eq("user_id", userId)
        .is("archived_at", null);

    if (categoriesError) {
      throwSupabaseError(categoriesError, "Failed to load finance categories");
    }

    const missing = DEFAULT_FINANCE_CATEGORIES.filter(
      (name) => !existingCategories.some((item) => item.name === name),
    );

    if (missing.length) {
      const { error } = await this.client.from("finance_categories").insert(
        missing.map((name, index) => ({
          user_id: userId,
          name,
          transaction_type: (name === "Income" ? "income" : "expense") as
            | "income"
            | "expense",
          metadata: {
            is_default: true,
            sort_order: (existingCategories.length + index + 1) * 10,
          },
        })),
      );

      if (error) {
        throwSupabaseError(error, "Failed to seed finance categories");
      }
    }

    const { data: categories, error: refreshedError } = await this.client
      .from("finance_categories")
      .select("*")
      .eq("user_id", userId)
      .is("archived_at", null)
      .order("created_at", { ascending: true });

    if (refreshedError) {
      throwSupabaseError(
        refreshedError,
        "Failed to refresh finance categories",
      );
    }

    return {
      account,
      categories,
    };
  }

  private async syncFinanceLifeEntity(
    transaction: FinanceTransactionRecord,
  ): Promise<void> {
    const { data: entity, error: entityError } = await this.client
      .from("life_entities")
      .select("*")
      .eq("user_id", transaction.userId)
      .eq("linked_table", "finance_transactions")
      .eq("linked_id", transaction.id)
      .maybeSingle();

    if (entityError) {
      throwSupabaseError(entityError, "Failed to load finance life entity");
    }

    if (!entity) {
      return;
    }

    const previousMetadata =
      typeof entity.metadata === "object" &&
      entity.metadata !== null &&
      !Array.isArray(entity.metadata)
        ? entity.metadata
        : {};
    const { error } = await this.client
      .from("life_entities")
      .update({
        status: transaction.status,
        metadata: {
          ...previousMetadata,
          amount: transaction.amount,
          currency: transaction.currency,
          category: transaction.categoryName,
          transactionType: transaction.transactionType,
          financeStatus: transaction.status,
          occurredOn: transaction.occurredOn,
          shortId: transaction.shortId,
        },
      })
      .eq("id", entity.id);

    if (error) {
      throwSupabaseError(error, "Failed to update finance life entity");
    }

    await this.enqueueObsidianSync({
      userId: transaction.userId,
      lifeEntityId: entity.id,
      entityType: "finance",
      action: "update",
      payload: {
        transactionId: transaction.id,
        status: transaction.status,
      },
    });
  }

  async ingestHealthPayload(
    payload: HealthIngestPayload,
  ): Promise<HealthIngestResult> {
    const startedAt = new Date().toISOString();
    const computed = calculateHealthIngestDaily(payload);
    const metrics = payload.metrics;
    const rawPayload = (payload.raw ?? {
      metrics: payload.metrics,
      workouts: payload.workouts,
      samples: payload.samples,
      missing: payload.missing,
    }) as Json;
    const missingMetrics = payload.missing as Json;

    const { data: healthDaily, error: healthDailyError } = await this.client
      .from("health_daily")
      .upsert(
        {
          user_id: payload.userId,
          log_date: payload.date,
          sync_reason: payload.syncReason,
          recovery_mode: computed.recoveryMode,
          data_completeness_score: computed.dataCompletenessScore,
          sleep_minutes: metrics.sleepMinutes,
          sleep_score: metrics.sleepScore,
          deep_sleep_minutes: metrics.deepSleepMinutes,
          rem_sleep_minutes: metrics.remSleepMinutes,
          awake_minutes: metrics.awakeMinutes,
          resting_heart_rate: metrics.restingHeartRate,
          hrv_ms: metrics.hrvMs,
          spo2_avg: metrics.spo2Avg,
          steps: metrics.steps,
          calories_burned: metrics.caloriesBurned,
          active_energy_kcal: metrics.activeEnergyKcal,
          workout_minutes: metrics.workoutMinutes,
          weight_kg: metrics.weightKg,
          mood_score: metrics.moodScore,
          energy_score: metrics.energyScore,
          stress_score: metrics.stressScore,
          source: payload.source,
          timezone: payload.timezone,
          missing_metrics: missingMetrics,
          metadata: {
            syncReason: payload.syncReason,
            workoutsCount: payload.workouts.length,
            samplesCount: payload.samples.length,
            missing: payload.missing,
          },
          raw_payload: rawPayload,
        },
        {
          onConflict: "user_id,log_date",
        },
      )
      .select("id")
      .single();

    if (healthDailyError) {
      throwSupabaseError(healthDailyError, "Failed to upsert health daily");
    }

    const workoutRows = payload.workouts.map((workout) => ({
      user_id: payload.userId,
      health_daily_id: healthDaily.id,
      external_id: workout.externalId,
      workout_date: payload.date,
      started_at: workout.startedAt,
      ended_at: workout.endedAt,
      workout_type: workout.workoutType,
      title: workout.title,
      duration_minutes: workout.durationMinutes,
      calories_kcal: workout.caloriesKcal,
      distance_meters: workout.distanceMeters,
      source: workout.source ?? payload.source ?? "health_ingest",
      metadata: (workout.metadata ?? {}) as Json,
    }));
    const workoutsWithExternalId = workoutRows.filter((row) => row.external_id);
    const workoutsWithoutExternalId = workoutRows.filter(
      (row) => !row.external_id,
    );

    if (workoutsWithExternalId.length > 0) {
      const { error } = await this.client
        .from("health_workouts")
        .upsert(workoutsWithExternalId, {
          onConflict: "user_id,source,external_id",
        });

      if (error) {
        throwSupabaseError(error, "Failed to upsert health workouts");
      }
    }

    if (workoutsWithoutExternalId.length > 0) {
      const { error } = await this.client
        .from("health_workouts")
        .insert(workoutsWithoutExternalId);

      if (error) {
        throwSupabaseError(error, "Failed to insert health workouts");
      }
    }

    if (payload.samples.length > 0) {
      const { error } = await this.client.from("health_samples").insert(
        payload.samples.map((sample) => ({
          user_id: payload.userId,
          health_daily_id: healthDaily.id,
          sample_type: sample.sampleType,
          sampled_at: sample.sampledAt,
          value: sample.value,
          unit: sample.unit,
          source: sample.source ?? payload.source ?? "health_ingest",
          metadata: (sample.metadata ?? {}) as Json,
        })),
      );

      if (error) {
        throwSupabaseError(error, "Failed to insert health samples");
      }
    }

    const lifeEntity = await this.upsertHealthDailyLifeEntity({
      userId: payload.userId,
      healthDailyId: healthDaily.id,
      date: payload.date,
      source: payload.source ?? "health_ingest",
      syncReason: payload.syncReason,
      recoveryMode: computed.recoveryMode,
      dataCompletenessScore: computed.dataCompletenessScore,
      workoutsCount: payload.workouts.length,
      samplesCount: payload.samples.length,
      missingMetrics: payload.missing,
    });

    await this.enqueueObsidianSync({
      userId: payload.userId,
      lifeEntityId: lifeEntity.id,
      payload: {
        entityType: "health_daily",
        date: payload.date,
        recoveryMode: computed.recoveryMode,
        dataCompletenessScore: computed.dataCompletenessScore,
        missingMetrics: payload.missing,
      },
    });

    const { data: syncRun, error: syncRunError } = await this.client
      .from("health_sync_runs")
      .insert({
        user_id: payload.userId,
        health_daily_id: healthDaily.id,
        life_entity_id: lifeEntity.id,
        sync_date: payload.date,
        sync_reason: payload.syncReason,
        status: "success",
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        workouts_upserted: payload.workouts.length,
        samples_inserted: payload.samples.length,
        data_completeness_score: computed.dataCompletenessScore,
        recovery_mode: computed.recoveryMode,
        source: payload.source ?? "health_ingest",
        missing_metrics: missingMetrics,
        metadata: {
          timezone: payload.timezone,
          missing: payload.missing,
        },
      })
      .select("id")
      .single();

    if (syncRunError) {
      throwSupabaseError(syncRunError, "Failed to insert health sync run");
    }

    return {
      healthDailyId: healthDaily.id,
      lifeEntityId: lifeEntity.id,
      syncRunId: syncRun.id,
      date: payload.date,
      recoveryMode: computed.recoveryMode,
      dataCompletenessScore: computed.dataCompletenessScore,
      workoutsUpserted: payload.workouts.length,
      samplesInserted: payload.samples.length,
    };
  }

  private async findExternalSource(
    userId: string,
    sourceKey: string,
  ): Promise<SourceRecord | null> {
    const { data, error } = await this.client
      .from("external_sources")
      .select("*")
      .eq("user_id", userId)
      .eq("source_key", sourceKey)
      .maybeSingle();

    if (error) {
      throwSupabaseError(error, "Failed to load external source");
    }

    return data ? toSourceRecord(data) : null;
  }

  private async listRecentSyncRuns(
    userId: string,
    limit: number,
  ): Promise<SyncRunRecord[]> {
    const { data, error } = await this.client
      .from("sync_runs")
      .select("*")
      .eq("user_id", userId)
      .order("started_at", { ascending: false })
      .limit(limit);

    if (error) {
      throwSupabaseError(error, "Failed to list sync runs");
    }

    return data.map(toSyncRunRecord);
  }

  private async getNextSeasonTransition(
    userId: string,
    today: string,
  ): Promise<LifeSeasonRecord | null> {
    const { data, error } = await this.client
      .from("life_seasons")
      .select("*")
      .eq("user_id", userId)
      .gt("starts_on", today)
      .order("starts_on", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      throwSupabaseError(error, "Failed to load next life season");
    }

    return data ? toLifeSeasonRecord(data) : null;
  }

  private async getStudyCourseByCode(
    userId: string,
    code: string,
  ): Promise<StudyCourseRecord | null> {
    const { data, error } = await this.client
      .from("study_courses")
      .select("*")
      .eq("user_id", userId)
      .eq("code", code)
      .maybeSingle();

    if (error) {
      throwSupabaseError(error, "Failed to load study course");
    }

    return data ? toStudyCourseRecord(data) : null;
  }

  private async findAcademicRecordBySourceEvent(
    input: UpsertAcademicRecordInput,
  ): Promise<AcademicRecord | null> {
    if (!input.sourceEventId) {
      return null;
    }

    const { data, error } = await this.client
      .from("academic_records")
      .select("*")
      .eq("user_id", input.userId)
      .eq("source_event_id", input.sourceEventId)
      .eq("record_type", input.recordType)
      .eq("title", input.title)
      .maybeSingle();

    if (error) {
      throwSupabaseError(error, "Failed to load academic record");
    }

    return data ? toAcademicRecord(data) : null;
  }

  private async listActiveLifeModes(input: {
    userId: string;
    source: LifeModeRecord["source"];
    now: string;
  }): Promise<LifeModeRecord[]> {
    const { data, error } = await this.client
      .from("life_modes")
      .select("*")
      .eq("user_id", input.userId)
      .eq("source", input.source)
      .eq("is_active", true)
      .lte("active_from", input.now)
      .or(`active_until.is.null,active_until.gt.${input.now}`)
      .order("active_from", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) {
      throwSupabaseError(error, "Failed to load active life modes");
    }

    return data.map(toLifeModeRecord);
  }

  private async listActiveLifeSeasons(input: {
    userId: string;
    today: string;
  }): Promise<LifeSeasonRecord[]> {
    const { data, error } = await this.client
      .from("life_seasons")
      .select("*")
      .eq("user_id", input.userId)
      .lte("starts_on", input.today)
      .gte("ends_on", input.today)
      .order("starts_on", { ascending: false })
      .limit(10);

    if (error) {
      throwSupabaseError(error, "Failed to load active life seasons");
    }

    return data.map(toLifeSeasonRecord);
  }

  private async getConfiguredSprintMode(input: {
    userId: string;
    now: string;
  }): Promise<LifeModeProjectSprint | null> {
    const sprintModes = await this.listActiveLifeModes({
      userId: input.userId,
      source: "sprint",
      now: input.now,
    });
    const sprint = sprintModes.at(0);

    if (!sprint) {
      return null;
    }

    return {
      id: sprint.id,
      userId: sprint.userId,
      name: sprint.reason ?? getModeLabel("project_sprint"),
      startsOn: sprint.activeFrom?.slice(0, 10) ?? null,
      endsOn: sprint.activeUntil?.slice(0, 10) ?? null,
      priorityJson: sprint.priorityJson,
    };
  }

  private async getConfiguredProjectSprint(input: {
    userId: string;
    today: string;
  }): Promise<LifeModeProjectSprint | null> {
    const { data, error } = await this.client
      .from("projects")
      .select("*")
      .eq("user_id", input.userId)
      .eq("status", "active")
      .or(`starts_on.is.null,starts_on.lte.${input.today}`)
      .or(`due_on.is.null,due_on.gte.${input.today}`)
      .order("starts_on", { ascending: false, nullsFirst: false })
      .limit(20);

    if (error) {
      throwSupabaseError(error, "Failed to load project sprint");
    }

    return (
      data
        .map((project) => projectSprintFromProject(project))
        .find((project): project is LifeModeProjectSprint =>
          Boolean(project),
        ) ?? null
    );
  }

  private async ensureDefaultWorkoutPlan(
    userId: string,
    workoutId: string,
    mode?: LifeMode,
  ): Promise<void> {
    const { count, error: countError } = await this.client
      .from("workout_sets")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("workout_id", workoutId);

    if (countError) {
      throwSupabaseError(countError, "Failed to count workout sets");
    }

    if ((count ?? 0) > 0) {
      return;
    }

    for (const exercise of workoutPlanForMode(mode)) {
      const exerciseId = await this.getOrCreateExercise({
        userId,
        name: exercise.name,
        category: exercise.category,
        equipment: exercise.equipment,
      });

      const { error } = await this.client.from("workout_sets").insert(
        exercise.sets.map((set, index) => ({
          user_id: userId,
          workout_id: workoutId,
          exercise_id: exerciseId,
          set_index: index + 1,
          reps: set.reps,
          weight_kg: set.weightKg,
          rest_seconds: set.restSeconds,
          completed: false,
          completed_at: null,
          metadata: {
            source: "default_strength_template",
          },
        })),
      );

      if (error) {
        throwSupabaseError(error, "Failed to create default workout sets");
      }
    }
  }

  private async getOrCreateExercise(input: {
    userId: string;
    name: string;
    category: string;
    equipment: string;
  }): Promise<string> {
    const { data: existing, error: existingError } = await this.client
      .from("fitness_exercises")
      .select("id")
      .eq("user_id", input.userId)
      .eq("name", input.name)
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throwSupabaseError(existingError, "Failed to load exercise");
    }

    if (existing) {
      return existing.id;
    }

    const { data, error } = await this.client
      .from("fitness_exercises")
      .insert({
        user_id: input.userId,
        name: input.name,
        category: input.category,
        equipment: input.equipment,
        metadata: {
          source: "default_strength_template",
        },
      })
      .select("id")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to create exercise");
    }

    return data.id;
  }

  private async buildWorkoutSummary(
    workout: WorkoutRow,
  ): Promise<CurrentWorkoutSummary> {
    const { data: sets, error: setsError } = await this.client
      .from("workout_sets")
      .select("*")
      .eq("user_id", workout.user_id)
      .eq("workout_id", workout.id)
      .order("created_at", { ascending: true })
      .order("set_index", { ascending: true });

    if (setsError) {
      throwSupabaseError(setsError, "Failed to load workout sets");
    }

    const exerciseIds = [
      ...new Set(sets.map((set) => set.exercise_id).filter(Boolean)),
    ] as string[];
    const exerciseById = await this.loadExercises(exerciseIds);
    const grouped = new Map<string, WorkoutExerciseSummary>();

    for (const set of sets) {
      const exercise = set.exercise_id
        ? exerciseById.get(set.exercise_id)
        : null;
      const exerciseKey = set.exercise_id ?? "unassigned";
      const existing = grouped.get(exerciseKey);
      const summarySet: WorkoutSetSummary = {
        id: set.id,
        index: set.set_index,
        targetReps: set.reps,
        targetWeightKg: numberOrNull(set.weight_kg),
        completed: set.completed,
        completedAt: set.completed_at,
      };

      if (existing) {
        existing.sets.push(summarySet);
      } else {
        grouped.set(exerciseKey, {
          id: exerciseKey,
          name: exercise?.name ?? "Exercise",
          note: exercise?.category ?? null,
          sets: [summarySet],
        });
      }
    }

    const totalSets = sets.length;
    const completedSets = sets.filter((set) => set.completed).length;
    const latestCompleted = sets
      .filter((set) => set.completed_at && set.rest_seconds)
      .sort((a, b) =>
        String(b.completed_at).localeCompare(String(a.completed_at)),
      )
      .at(0);

    return {
      id: workout.id,
      title: workout.title ?? "Workout",
      mode: workout.ended_at ? "completed" : "active",
      startedAt: workout.started_at,
      progressPercent: totalSets
        ? Math.round((completedSets / totalSets) * 100)
        : 0,
      completedSets,
      totalSets,
      restTimerEndsAt:
        latestCompleted?.completed_at && latestCompleted.rest_seconds
          ? addSeconds(
              latestCompleted.completed_at,
              latestCompleted.rest_seconds,
            )
          : null,
      exercises: [...grouped.values()],
    };
  }

  private async loadExercises(
    exerciseIds: string[],
  ): Promise<Map<string, FitnessExerciseRow>> {
    if (exerciseIds.length === 0) {
      return new Map();
    }

    const { data, error } = await this.client
      .from("fitness_exercises")
      .select("*")
      .in("id", exerciseIds);

    if (error) {
      throwSupabaseError(error, "Failed to load exercises");
    }

    return new Map(data.map((exercise) => [exercise.id, exercise]));
  }

  private async getLatestHealthDaily(
    userId: string,
  ): Promise<HealthDailyRow | null> {
    const { data, error } = await this.client
      .from("health_daily")
      .select("*")
      .eq("user_id", userId)
      .order("log_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throwSupabaseError(error, "Failed to load latest health daily");
    }

    return data;
  }

  private async getHealthSampleCount(healthDailyId: string): Promise<number> {
    const { count, error } = await this.client
      .from("health_samples")
      .select("id", { count: "exact", head: true })
      .eq("health_daily_id", healthDailyId);

    if (error) {
      throwSupabaseError(error, "Failed to count health samples");
    }

    return count ?? 0;
  }

  private async getOpenTaskCount(userId: string): Promise<number> {
    const { count, error } = await this.client
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .not("status", "in", "(done,cancelled)");

    if (error) {
      throwSupabaseError(error, "Failed to count open tasks");
    }

    return count ?? 0;
  }

  private async upsertWorkoutLifeEntity(input: {
    userId: string;
    workout: CurrentWorkoutSummary;
    completedAt: string;
  }): Promise<LifeEntityRecord> {
    const metadata = {
      workoutId: input.workout.id,
      mode: input.workout.mode,
      completedAt: input.completedAt,
      progressPercent: input.workout.progressPercent,
      completedSets: input.workout.completedSets,
      totalSets: input.workout.totalSets,
      exercises: input.workout.exercises,
    } as unknown as Json;
    const body = workoutBody(input.workout);
    const { data: existing, error: existingError } = await this.client
      .from("life_entities")
      .select("id")
      .eq("user_id", input.userId)
      .eq("entity_type", "workout")
      .eq("linked_table", "workouts")
      .eq("linked_id", input.workout.id)
      .maybeSingle();

    if (existingError) {
      throwSupabaseError(existingError, "Failed to load workout life entity");
    }

    if (existing) {
      const { data, error } = await this.client
        .from("life_entities")
        .update({
          title: input.workout.title,
          body,
          source: "tma",
          source_command: "POST /api/tma/workout/:workoutId/complete",
          metadata,
        })
        .eq("id", existing.id)
        .select("*")
        .single();

      if (error) {
        throwSupabaseError(error, "Failed to update workout life entity");
      }

      return toLifeEntityRecord(data);
    }

    const { data, error } = await this.client
      .from("life_entities")
      .insert({
        user_id: input.userId,
        entity_type: "workout",
        title: input.workout.title,
        body,
        source: "tma",
        source_command: "POST /api/tma/workout/:workoutId/complete",
        linked_table: "workouts",
        linked_id: input.workout.id,
        metadata,
      })
      .select("*")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to create workout life entity");
    }

    return toLifeEntityRecord(data);
  }

  private async upsertHealthDailyLifeEntity(input: {
    userId: string;
    healthDailyId: string;
    date: string;
    source: string;
    syncReason: string;
    recoveryMode: string;
    dataCompletenessScore: number;
    workoutsCount: number;
    samplesCount: number;
    missingMetrics: Record<string, boolean>;
  }): Promise<LifeEntityRecord> {
    const missingMetricNames = Object.entries(input.missingMetrics)
      .filter(([, missing]) => missing)
      .map(([name]) => name);
    const metadata = {
      date: input.date,
      syncReason: input.syncReason,
      recoveryMode: input.recoveryMode,
      recoveryModeLabel: healthModeLabel(input.recoveryMode as HealthMode),
      dataCompletenessScore: input.dataCompletenessScore,
      workoutsCount: input.workoutsCount,
      samplesCount: input.samplesCount,
      missingMetrics: input.missingMetrics,
    };
    const title = `Health daily ${input.date}`;
    const body = [
      `Recovery mode: ${healthModeLabel(input.recoveryMode as HealthMode)}`,
      `Data completeness: ${input.dataCompletenessScore}`,
      `Workouts: ${input.workoutsCount}`,
      `Samples: ${input.samplesCount}`,
      `Missing metrics: ${missingMetricNames.length ? missingMetricNames.join(", ") : "none"}`,
    ].join("\n");
    const { data: existing, error: existingError } = await this.client
      .from("life_entities")
      .select("id")
      .eq("user_id", input.userId)
      .eq("entity_type", "health_daily")
      .eq("linked_table", "health_daily")
      .eq("linked_id", input.healthDailyId)
      .maybeSingle();

    if (existingError) {
      throwSupabaseError(
        existingError,
        "Failed to load health daily life entity",
      );
    }

    if (existing) {
      const { data, error } = await this.client
        .from("life_entities")
        .update({
          title,
          body,
          source: input.source,
          source_command: "POST /health/ingest",
          metadata,
        })
        .eq("id", existing.id)
        .select("*")
        .single();

      if (error) {
        throwSupabaseError(error, "Failed to update health daily life entity");
      }

      return toLifeEntityRecord(data);
    }

    const { data, error } = await this.client
      .from("life_entities")
      .insert({
        user_id: input.userId,
        entity_type: "health_daily",
        title,
        body,
        source: input.source,
        source_command: "POST /health/ingest",
        linked_table: "health_daily",
        linked_id: input.healthDailyId,
        metadata,
      })
      .select("*")
      .single();

    if (error) {
      throwSupabaseError(error, "Failed to create health daily life entity");
    }

    return toLifeEntityRecord(data);
  }

  async getTelegramUserId(userId: string): Promise<number | null> {
    const { data, error } = await this.client
      .from("profiles")
      .select("telegram_user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throwSupabaseError(error, "Failed to get telegram user id");
    }

    return data?.telegram_user_id ?? null;
  }

  async processFinanceAlerts(userId: string, today: string): Promise<string[]> {
    const alerts: string[] = [];

    // 1. Check budgets and category limits
    const budgets = await this.getBudgetSummary({ userId, today });
    const dbBudgets = await this.listBudgets({ userId, activeOnly: true });

    for (const budget of budgets) {
      const dbBudget = dbBudgets.find((b) => b.id === budget.budgetId);
      if (!dbBudget) continue;

      const budgetMeta = jsonObject((dbBudget.metadata || {}) as Json);
      const lastNotifiedPeriodStart = budgetMeta.lastNotifiedPeriodStart;
      const notifiedCategories = jsonObject(
        budgetMeta.notifiedCategories as Json,
      );

      let budgetMetaChanged = false;

      // Check budget overspent
      if (budget.isOverspent) {
        if (lastNotifiedPeriodStart !== budget.periodStart) {
          alerts.push(
            `⚠️ Бюджет "${budget.name || "Основной"}" превышен!\nЛимит: ${budget.totalLimit} ${budget.currency}\nПотрачено: ${budget.totalSpent} ${budget.currency}`,
          );
          budgetMeta.lastNotifiedPeriodStart = budget.periodStart;
          budgetMetaChanged = true;
        }
      }

      // Check category limits
      for (const cat of budget.categories) {
        if (cat.isOverspent) {
          if (notifiedCategories[cat.categoryId] !== budget.periodStart) {
            alerts.push(
              `⚠️ Лимит категории "${cat.categoryName}" в бюджете "${budget.name || "Основной"}" превышен!\nЛимит: ${cat.limit} ${budget.currency}\nПотрачено: ${cat.spent} ${budget.currency}`,
            );
            notifiedCategories[cat.categoryId] = budget.periodStart;
            budgetMetaChanged = true;
          }
        }
      }

      if (budgetMetaChanged) {
        budgetMeta.notifiedCategories = notifiedCategories;
        const { error: updateError } = await this.client
          .from("finance_budgets")
          .update({ metadata: budgetMeta as Json })
          .eq("id", budget.budgetId)
          .eq("user_id", userId);
        if (updateError) {
          console.error(
            "[finance] failed to update budget metadata in alerts check",
            updateError,
          );
        }
      }
    }

    // 2. Check anomalies
    try {
      const anomalies = await this.detectFinanceAnomaliesForUser({
        userId,
        today,
      });
      if (anomalies.length > 0) {
        const { data: settingsData, error: settingsError } = await this.client
          .from("user_settings")
          .select("settings")
          .eq("user_id", userId)
          .maybeSingle();

        if (!settingsError) {
          const currentSettings = jsonObject(settingsData?.settings);
          const notifiedAnomalies = Array.isArray(
            currentSettings.notified_anomalies,
          )
            ? (currentSettings.notified_anomalies as string[])
            : [];

          let settingsChanged = false;

          for (const anomaly of anomalies) {
            const key = `${anomaly.type}:${anomaly.occurredOn}:${anomaly.amount}:${anomaly.categoryName ?? ""}:${anomaly.merchant ?? ""}`;
            if (!notifiedAnomalies.includes(key)) {
              alerts.push(
                `🔍 Зафиксирована аномалия:\n${anomaly.reason}\nСтепень: ${anomaly.severity}`,
              );
              notifiedAnomalies.push(key);
              settingsChanged = true;
            }
          }

          if (settingsChanged) {
            const updatedSettings = {
              ...currentSettings,
              notified_anomalies: notifiedAnomalies,
            };
            const { error: updateSettingsError } = await this.client
              .from("user_settings")
              .upsert({ user_id: userId, settings: updatedSettings as Json });
            if (updateSettingsError) {
              console.error(
                "[finance] failed to update user settings in anomalies check",
                updateSettingsError,
              );
            }
          }
        }
      }
    } catch (anomalyError) {
      console.error(
        "[finance] anomaly checking failed in alerts check",
        anomalyError,
      );
    }

    return alerts;
  }

  async backfillFinanceBaseAmounts(input?: {
    userId?: string;
  }): Promise<number> {
    let query = this.client.from("finance_transactions").select("*");

    if (input?.userId) {
      query = query.eq("user_id", input.userId);
    }

    const { data: transactions, error } = await query;
    if (error) {
      throwSupabaseError(error, "Failed to load transactions for backfill");
    }

    let updatedCount = 0;
    const userBaseCurrencies = new Map<string, string>();

    for (const tx of transactions) {
      const hasBaseCurrency =
        tx.base_currency && tx.base_currency.trim().length > 0;
      const hasBaseAmount =
        tx.base_amount !== null && tx.base_amount !== undefined;

      if (hasBaseCurrency && hasBaseAmount) {
        continue;
      }

      let baseCurrency = tx.base_currency;
      if (!baseCurrency) {
        baseCurrency = userBaseCurrencies.get(tx.user_id) ?? "";
        if (!baseCurrency) {
          baseCurrency = await this.getFinanceBaseCurrency(tx.user_id);
          userBaseCurrencies.set(tx.user_id, baseCurrency);
        }
      }

      const baseMoney = await this.resolveBaseMoney({
        amount: tx.amount,
        currency: tx.currency,
        baseCurrency,
        occurredOn: tx.occurred_on,
      });

      const { error: updateError } = await this.client
        .from("finance_transactions")
        .update({
          base_currency: baseCurrency,
          base_amount: baseMoney.baseAmount,
          exchange_rate: baseMoney.exchangeRate,
          exchange_rate_date: baseMoney.exchangeRateDate,
        })
        .eq("id", tx.id);

      if (updateError) {
        throwSupabaseError(
          updateError,
          `Failed to update transaction ${tx.id} in backfill`,
        );
      }

      updatedCount++;
    }

    return updatedCount;
  }

  async getReceipt(
    userId: string,
    receiptId: string,
  ): Promise<FinanceReceiptRecord | null> {
    const { data, error } = await this.client
      .from("finance_receipts")
      .select("*")
      .eq("id", receiptId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throwSupabaseError(error, "Failed to load receipt");
    }

    if (!data) {
      return null;
    }

    const itemsByReceipt = await this.loadReceiptItems(userId, [data.id]);
    return toFinanceReceiptRecord(data, itemsByReceipt.get(data.id) ?? []);
  }

  async downloadReceiptImage(
    userId: string,
    receiptId: string,
  ): Promise<{ bytes: Buffer; mimeType: string }> {
    const { data: receipt, error: rxError } = await this.client
      .from("finance_receipts")
      .select("storage_path, mime_type")
      .eq("id", receiptId)
      .eq("user_id", userId)
      .single();

    if (rxError || !receipt) {
      throwSupabaseError(
        rxError || new Error("Receipt not found"),
        "Failed to find receipt for image download",
      );
    }

    const { data, error } = await this.client.storage
      .from(FINANCE_RECEIPTS_BUCKET)
      .download(receipt.storage_path);

    if (error || !data) {
      throwSupabaseError(
        error || new Error("Failed to download image"),
        "Failed to download receipt image",
      );
    }

    const arrayBuffer = await data.arrayBuffer();
    return {
      bytes: Buffer.from(arrayBuffer),
      mimeType: receipt.mime_type ?? "image/jpeg",
    };
  }

  async reviewFinanceReceipt(input: {
    userId: string;
    receiptId: string;
    amount: number;
    currency: CurrencyCode;
    merchant: string;
    date: string;
    category: string;
  }): Promise<FinanceReceiptRecord> {
    const { data: receipt, error: rxError } = await this.client
      .from("finance_receipts")
      .select("*")
      .eq("id", input.receiptId)
      .eq("user_id", input.userId)
      .single();

    if (rxError || !receipt) {
      throwSupabaseError(
        rxError || new Error("Receipt not found"),
        "Failed to load receipt for review",
      );
    }

    const defaults = await this.ensureFinanceDefaults(input.userId);
    const categoryName = normalizeFinanceCategory(input.category) ?? "Other";
    const categoryObj =
      defaults.categories.find(
        (item) =>
          item.name.toLocaleLowerCase("en") ===
            categoryName.toLocaleLowerCase("en") &&
          item.transaction_type === "expense",
      ) ??
      defaults.categories.find(
        (item) => item.name === "Other" && item.transaction_type === "expense",
      );

    let transactionId = receipt.transaction_id;
    if (transactionId) {
      const baseCurrency = await this.getFinanceBaseCurrency(input.userId);
      const baseMoney = await this.resolveBaseMoney({
        amount: input.amount,
        currency: input.currency,
        baseCurrency,
        occurredOn: input.date,
      });

      const { error: txError } = await this.client
        .from("finance_transactions")
        .update({
          amount: input.amount,
          currency: input.currency,
          base_amount: baseMoney.baseAmount,
          base_currency: baseMoney.baseCurrency,
          exchange_rate: baseMoney.exchangeRate,
          exchange_rate_date: baseMoney.exchangeRateDate,
          merchant: input.merchant,
          description: input.merchant,
          occurred_on: input.date,
          category_id: categoryObj?.id ?? null,
          status: "confirmed",
          confirmed_at: new Date().toISOString(),
        })
        .eq("id", transactionId)
        .eq("user_id", input.userId);

      if (txError) {
        throwSupabaseError(
          txError,
          "Failed to update transaction during receipt review",
        );
      }
    } else {
      const transaction = await this.createFinanceTransaction({
        userId: input.userId,
        transactionType: "expense",
        amount: input.amount,
        currency: input.currency,
        category: categoryName,
        merchant: input.merchant,
        description: input.merchant,
        occurredOn: input.date,
        source: "receipt_import",
        receiptId: receipt.id,
        status: "confirmed",
      });
      transactionId = transaction.id;
    }

    const updatedParsedJson = {
      ...(typeof receipt.parsed_json === "object" &&
      receipt.parsed_json !== null
        ? receipt.parsed_json
        : {}),
      amount: input.amount,
      currency: input.currency,
      merchant: input.merchant,
      date: input.date,
      category: categoryName,
    };

    const { data: updatedReceipt, error: updateError } = await this.client
      .from("finance_receipts")
      .update({
        status: "linked",
        parsed_json: updatedParsedJson as unknown as Json,
        transaction_id: transactionId,
        error_message: null,
        processed_at: new Date().toISOString(),
      })
      .eq("id", receipt.id)
      .select("*")
      .single();

    if (updateError) {
      throwSupabaseError(updateError, "Failed to update receipt status");
    }

    const items =
      (await this.loadReceiptItems(input.userId, [receipt.id])).get(
        receipt.id,
      ) ?? [];

    return toFinanceReceiptRecord(updatedReceipt, items);
  }

  // -------------------------------------------------------------------------
  // Finance V2 — Bank line reconciliation
  // -------------------------------------------------------------------------

  async listUnmatchedBankLines(
    userId: string,
    _tenantId: string,
  ): Promise<BankLineRecord[]> {
    try {
      const { data, error } = await this.client
        .from("finance_transactions")
        .select(
          "id, user_id, amount, currency, description, merchant, occurred_on, status, receipt_id, source, created_at",
        )
        .eq("user_id", userId)
        .eq("status", "draft")
        .is("receipt_id", null)
        .order("occurred_on", { ascending: false })
        .limit(50);

      if (error) {
        throwSupabaseError(error, "Failed to list unmatched bank lines");
      }

      return (data ?? []).map(
        (row): BankLineRecord => ({
          id: row.id,
          userId: row.user_id,
          amount: Number(row.amount),
          currency: row.currency,
          description: row.description,
          bookingDate: row.occurred_on,
          status: "unmatched" as const,
          matchedEntityId: null,
          shortId: row.id.slice(0, 8),
          merchant: row.merchant,
          source: row.source,
          createdAt: row.created_at,
        }),
      );
    } catch (err) {
      console.error(
        "[CRITICAL] listUnmatchedBankLines failed:",
        err instanceof Error ? err.message : err,
      );
      throw err;
    }
  }

  async reconcileBankLine(
    userId: string,
    lineId: string,
    entityId: string,
  ): Promise<void> {
    try {
      const fullId =
        lineId.length < 36
          ? await this.resolveTransactionFullId(userId, lineId)
          : lineId;

      if (!fullId) {
        throw new Error(`No unmatched bank line matches short ID: ${lineId}`);
      }

      const { data: bankLine, error: bankLineError } = await this.client
        .from("finance_transactions")
        .select("id")
        .eq("id", fullId)
        .eq("user_id", userId)
        .eq("status", "draft")
        .maybeSingle();

      if (bankLineError) {
        throwSupabaseError(bankLineError, "Failed to verify bank line owner");
      }

      if (!bankLine) {
        throw new Error(`No unmatched bank line matches short ID: ${lineId}`);
      }

      const { data: receipt, error: receiptError } = await this.client
        .from("finance_receipts")
        .select("id")
        .eq("id", entityId)
        .eq("user_id", userId)
        .maybeSingle();

      if (receiptError) {
        throwSupabaseError(
          receiptError,
          "Failed to verify matched receipt owner",
        );
      }

      if (!receipt) {
        throw new Error(`No receipt matches ID for this user: ${entityId}`);
      }

      const { error } = await this.client
        .from("finance_transactions")
        .update({
          status: "confirmed" as FinanceTransactionStatus,
          receipt_id: entityId,
          confirmed_at: new Date().toISOString(),
        })
        .eq("id", fullId)
        .eq("user_id", userId)
        .eq("status", "draft");

      if (error) {
        throwSupabaseError(error, "Failed to reconcile bank line");
      }
    } catch (err) {
      console.error(
        "[CRITICAL] reconcileBankLine failed:",
        err instanceof Error ? err.message : err,
      );
      throw err;
    }
  }

  private async resolveTransactionFullId(
    userId: string,
    shortId: string,
  ): Promise<string | null> {
    const { data, error } = await this.client
      .from("finance_transactions")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "draft")
      .like("id", `${shortId}%`)
      .limit(2);

    if (error) {
      throwSupabaseError(error, "Failed to resolve transaction ID");
    }

    if (!data || data.length === 0) {
      return null;
    }

    if (data.length > 1) {
      throw new Error(
        `Ambiguous short ID: ${shortId} matches ${data.length} transactions`,
      );
    }

    return data[0]!.id;
  }

  // -------------------------------------------------------------------------
  // Finance V2 — Budget periods with rollover
  // -------------------------------------------------------------------------

  async getActiveBudgetsWithPeriods(
    userId: string,
    _tenantId: string,
    currentDate: string,
  ): Promise<BudgetSummaryPayload[]> {
    try {
      const summaries = await this.getBudgetSummary({
        userId,
        today: currentDate,
      });

      const payloads: BudgetSummaryPayload[] = [];

      for (const summary of summaries) {
        for (const cat of summary.categories) {
          payloads.push({
            budgetId: summary.budgetId,
            name: summary.name,
            category: cat.categoryName,
            period: summary.period,
            periodStart: summary.periodStart,
            periodEnd: summary.periodEnd,
            limitAmount: cat.limit,
            actualSpent: cat.spent,
            remainingBalance: cat.remaining,
            percentUsed: cat.percentUsed,
            isOverspent: cat.isOverspent,
            rolloverEnabled: false,
            currency: summary.currency,
          });
        }

        if (summary.categories.length === 0) {
          payloads.push({
            budgetId: summary.budgetId,
            name: summary.name,
            category: summary.name ?? "General",
            period: summary.period,
            periodStart: summary.periodStart,
            periodEnd: summary.periodEnd,
            limitAmount: summary.planned,
            actualSpent: summary.spent,
            remainingBalance: summary.remaining,
            percentUsed: summary.totalPercentUsed,
            isOverspent: summary.isOverspent,
            rolloverEnabled: false,
            currency: summary.currency,
          });
        }
      }

      return payloads;
    } catch (err) {
      console.error(
        "[CRITICAL] getActiveBudgetsWithPeriods failed:",
        err instanceof Error ? err.message : err,
      );
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Finance V2 — Receipt scan jobs
  // -------------------------------------------------------------------------

  async createReceiptScanJob(
    userId: string,
    _tenantId: string,
    storagePath: string,
  ): Promise<ReceiptScanRecord> {
    try {
      const trimmedPath = storagePath.trim();

      if (!trimmedPath) {
        throw new Error("Receipt scan storage path is required");
      }

      const { data, error } = await this.client
        .from("finance_receipts")
        .insert({
          user_id: userId,
          storage_path: trimmedPath,
          status: "processing" as FinanceReceiptStatus,
          metadata: { source: "telegram_photo", scan_job: true },
        })
        .select(
          "id, user_id, storage_path, status, file_name, mime_type, parsed_json, created_at",
        )
        .single();

      if (error) {
        throwSupabaseError(error, "Failed to create receipt scan job");
      }

      const parsedJson =
        typeof data.parsed_json === "object" && data.parsed_json !== null
          ? (data.parsed_json as Record<string, unknown>)
          : {};

      return {
        id: data.id,
        userId: data.user_id,
        storagePath: data.storage_path,
        status: data.status as FinanceReceiptStatus,
        extractedAmount:
          typeof parsedJson.amount === "number" ? parsedJson.amount : null,
        extractedCurrency:
          typeof parsedJson.currency === "string" ? parsedJson.currency : null,
        extractedCategory:
          typeof parsedJson.category === "string" ? parsedJson.category : null,
        matchedEntityId: null,
        fileName: data.file_name,
        mimeType: data.mime_type,
        createdAt: data.created_at,
      };
    } catch (err) {
      console.error(
        "[CRITICAL] createReceiptScanJob failed:",
        err instanceof Error ? err.message : err,
      );
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Finance V2 — Budget limit management
  // -------------------------------------------------------------------------

  async updateBudgetLimit(
    userId: string,
    _tenantId: string,
    category: string,
    amount: number,
    periodType: string,
  ): Promise<void> {
    try {
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Budget amount must be a positive finite number");
      }

      const validPeriods: FinanceBudgetPeriod[] = [
        "weekly",
        "monthly",
        "quarterly",
        "yearly",
        "custom",
      ];
      const period = validPeriods.includes(periodType as FinanceBudgetPeriod)
        ? (periodType as FinanceBudgetPeriod)
        : "monthly";

      const categories = await this.listFinanceCategories(userId);
      const normalizedCategoryName = category.trim().toLowerCase();
      const matchedCategory = categories.find(
        (cat) => cat.name.toLowerCase() === normalizedCategoryName,
      );

      let categoryId: string;

      if (matchedCategory) {
        categoryId = matchedCategory.id;
      } else {
        const { data: newCategory, error: catError } = await this.client
          .from("finance_categories")
          .insert({
            user_id: userId,
            name: category.trim(),
            transaction_type: "expense",
          })
          .select("id")
          .single();

        if (catError) {
          throwSupabaseError(catError, "Failed to create budget category");
        }

        categoryId = newCategory.id;
      }

      const today = new Date().toISOString().slice(0, 10);
      const periodStart = financePeriodStart(today, period);

      const existingBudgets = await this.listBudgets({
        userId,
        period,
        activeOnly: true,
      });

      const existingBudget = existingBudgets.find(
        (budget) =>
          budget.periodStart === periodStart &&
          budget.categoryLimits.some(
            (limit) => limit.categoryId === categoryId,
          ),
      );

      if (existingBudget) {
        const { error: updateError } = await this.client
          .from("finance_budget_categories")
          .update({ limit_amount: amount })
          .eq("user_id", userId)
          .eq("budget_id", existingBudget.id)
          .eq("category_id", categoryId);

        if (updateError) {
          throwSupabaseError(
            updateError,
            "Failed to update budget category limit",
          );
        }

        const { error: budgetUpdateError } = await this.client
          .from("finance_budgets")
          .update({ amount })
          .eq("id", existingBudget.id)
          .eq("user_id", userId);

        if (budgetUpdateError) {
          throwSupabaseError(
            budgetUpdateError,
            "Failed to update budget amount",
          );
        }
      } else {
        await this.createBudget({
          userId,
          categoryId,
          categoryLimits: [{ categoryId, limit: amount }],
          period,
          periodStart,
          amount,
          name: category.trim(),
        });
      }
    } catch (err) {
      console.error(
        "[CRITICAL] updateBudgetLimit failed:",
        err instanceof Error ? err.message : err,
      );
      throw err;
    }
  }
}
