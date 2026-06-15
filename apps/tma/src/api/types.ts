export type RecoveryMode = "recovery" | "maintenance" | "baseline" | "growth";

export type LifeMode =
  | "exam_war"
  | "practice"
  | "recovery_setup"
  | "summer_term"
  | "summer"
  | "trimester"
  | "recovery"
  | "project_sprint"
  | "maintenance";

export type LifeModeSource =
  | "manual"
  | "auto"
  | "health"
  | "season"
  | "sprint"
  | "default";

export const recoveryModeLabels: Record<RecoveryMode, string> = {
  recovery: "Recovery Mode",
  maintenance: "Normal-Light",
  baseline: "Normal",
  growth: "High Performance",
};

export interface ApiEnvelope<T> {
  data: T;
}

export interface HomeSummary {
  displayName?: string;
  localDate: string;
  mode: LifeMode;
  modeLabel: string;
  modeReason: string;
  recoveryMode: RecoveryMode;
  focusScore: number | null;
  activeWorkout?: {
    id: string;
    title: string;
    startedAt: string;
    progressPercent: number;
  } | null;
  healthCompletenessScore?: number | null;
  pendingSyncCount?: number;
  obsidianStatus?: {
    enabled: boolean;
    status: "disconnected" | "connected" | "error";
    mode: "local_vault" | "agent";
    configured: boolean;
    updatedAt: string | null;
    pendingSyncCount: number;
  };
}

export interface WorkoutSet {
  id: string;
  index: number;
  targetReps?: number | null;
  targetWeightKg?: number | null;
  completed: boolean;
  completedAt?: string | null;
}

export interface WorkoutExercise {
  id: string;
  name: string;
  note?: string | null;
  sets: WorkoutSet[];
}

export interface CurrentWorkout {
  id: string;
  title: string;
  mode: string;
  startedAt: string;
  progressPercent: number;
  completedSets: number;
  totalSets: number;
  restTimerEndsAt?: string | null;
  exercises: WorkoutExercise[];
}

export interface SourceRecord {
  id: string;
  userId: string;
  sourceKey: string;
  sourceType: string;
  displayName: string;
  status: "disabled" | "connected" | "error";
  configJson?: Record<string, unknown>;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
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
  rawJson?: Record<string, unknown>;
  normalizedEntityId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderRecord {
  id: string;
  userId: string;
  lifeEntityId: string | null;
  sourceEventId: string | null;
  channel: string;
  remindAt: string;
  status: "pending" | "processing" | "sent" | "cancelled" | "failed";
  message: string;
  metadataJson?: Record<string, unknown>;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncRunRecord {
  id: string;
  userId: string;
  sourceId: string | null;
  sourceKey: string;
  status: "running" | "success" | "partial" | "failed";
  startedAt: string;
  finishedAt: string | null;
  recordsSeen: number;
  recordsCreated: number;
  recordsUpdated: number;
  errorMessage: string | null;
  metadataJson?: Record<string, unknown>;
}

export interface SourcesSummary {
  sources: SourceRecord[];
  sourceEvents: SourceEventRecord[];
  reminders: ReminderRecord[];
  syncRuns: SyncRunRecord[];
}

export interface RemindersResponse {
  reminders: ReminderRecord[];
}

export interface FinanceCategory {
  id: string;
  name: string;
  transactionType: "income" | "expense" | "transfer" | "adjustment";
}

export interface FinanceTransaction {
  id: string;
  shortId: string;
  userId: string;
  accountId: string;
  categoryId: string | null;
  categoryName: string | null;
  transactionType: "income" | "expense" | "transfer" | "adjustment";
  status: "draft" | "confirmed" | "cancelled";
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

export interface BudgetCategorySummary {
  categoryId: string;
  categoryName: string;
  limit: number;
  spent: number;
  remaining: number;
  percentUsed: number;
  isOverspent: boolean;
}

export interface BudgetSummary {
  budgetId: string;
  name: string | null;
  period: "weekly" | "monthly" | "quarterly" | "yearly" | "custom";
  periodStart: string;
  periodEnd: string;
  currency: string;
  planned: number;
  spent: number;
  remaining: number;
  overspent: number;
  totalLimit: number;
  totalSpent: number;
  totalRemaining: number;
  totalPercentUsed: number;
  isOverspent: boolean;
  categories: BudgetCategorySummary[];
}

export interface FinanceSummary {
  currency: string;
  baseCurrency: string;
  today: { amount: number; count: number };
  week: { amount: number; count: number };
  month: { amount: number; count: number };
  monthlySummary: {
    income: number;
    expense: number;
    net: number;
  };
  topCategories: Array<{
    category: string;
    amount: number;
    count: number;
  }>;
  budgets: BudgetSummary[];
  recentTransactions: FinanceTransaction[];
  recentExpenses: FinanceTransaction[];
  recentIncome: FinanceTransaction[];
  recentReceipts: FinanceReceiptSummary[];
  anomalies: FinanceAnomalySummary[];
  recommendations: string[];
  drafts: FinanceTransaction[];
}

export interface FinanceReceiptSummary {
  id: string;
  status: string;
  displayStatus: "processing" | "partial" | "needs_review" | "completed" | "failed";
  fileName: string | null;
  amount: number | null;
  currency: string | null;
  merchant: string | null;
  transactionId: string | null;
  errorMessage: string | null;
  createdAt: string;
  processedAt: string | null;
}

export interface FinanceReceiptItemDetail {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number | null;
  totalAmount: number | null;
  currency: string;
}

export interface FinanceReceiptDetail {
  id: string;
  userId: string;
  storagePath: string;
  fileName: string | null;
  mimeType: string | null;
  ocrText: string | null;
  parsedJson: any;
  status: string;
  transactionId: string | null;
  errorMessage: string | null;
  items: FinanceReceiptItemDetail[];
  createdAt: string;
  processedAt: string | null;
}

export interface ReviewReceiptInput {
  amount: number;
  currency: string;
  merchant: string;
  date: string;
  category: string;
}

export interface FinanceAnomalySummary {
  transactionId: string | null;
  categoryName: string | null;
  merchant: string | null;
  amount: number;
  currency: string;
  occurredOn: string;
  type: string;
  severity: "low" | "medium" | "high";
  reason: string;
}

export interface FinanceSettings {
  baseCurrency: string;
}

export interface CreateFinanceTransactionInput {
  amount: number;
  category: string;
  description?: string | null;
  tags?: string[];
  merchant?: string | null;
  transactionType?: "expense" | "income";
}

export interface CreateBudgetInput {
  name?: string | null;
  amount: number;
  period?: BudgetSummary["period"];
  periodStart: string;
  periodEnd?: string | null;
  categoryId?: string | null;
  categoryLimits?: Array<{ categoryId: string; limit: number }>;
}

export interface UpdateBudgetInput {
  name?: string | null;
  amount?: number;
  periodEnd?: string | null;
  categoryLimits?: Array<{ categoryId: string; limit: number }>;
}

export interface MonthlyReviewRecord {
  id: string;
  userId: string;
  periodMonth: string;
  status: "draft" | "generated" | "failed";
  reportTitle: string | null;
  reportMarkdown: string;
  aiModel: string | null;
  aiInputJson?: Record<string, unknown>;
  aiOutputJson?: Record<string, unknown>;
  statsJson?: Record<string, unknown>;
  obsidianPath: string | null;
  generatedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MonthlyReviewSummary {
  latest: MonthlyReviewRecord | null;
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
  rawJson?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AcademicSummary {
  currentMode: ModeSummary;
  nextAcademicEvent: SourceEventRecord | null;
  finals: SourceEventRecord[];
  examfx: SourceEventRecord[];
  activeCourse: StudyCourse | null;
  summerCourse: StudyCourse | null;
  nextTransition: {
    id?: string;
    userId: string;
    name: string;
    mode: LifeMode;
    startsOn: string;
    endsOn: string;
    priorityJson?: Record<string, number>;
    createdAt?: string | null;
  } | null;
  academicRecords: AcademicRecord[];
}

export interface CreateReminderInput {
  message: string;
  remindAt: string;
}

export interface HealthSummary {
  date: string;
  lifeMode: LifeMode;
  lifeModeLabel: string;
  recommendation: string;
  recoveryMode: RecoveryMode;
  dataCompletenessScore: number;
  sleepMinutes?: number | null;
  deepSleepMinutes?: number | null;
  remSleepMinutes?: number | null;
  awakeMinutes?: number | null;
  restingHeartRate?: number | null;
  hrvMs?: number | null;
  spo2Avg?: number | null;
  steps?: number | null;
  activeEnergyKcal?: number | null;
  missingMetrics?: Record<string, boolean>;
  samplesCount?: number;
  hasMetrics?: boolean;
  sourceLabel?: string | null;
  latestSource?: string | null;
  averageHeartRate?: number | null;
  totalEnergyKcal?: number | null;
  workoutMinutes?: number | null;
  distanceM?: number | null;
  weightKg?: number | null;
  sleepScore?: number | null;
  stressScore?: number | null;
  moodScore?: number | null;
  energyScore?: number | null;
  weekly?: {
    startDate: string;
    endDate: string;
    avgSteps: number | null;
    avgSleepMinutes: number | null;
    avgRestingHeartRate: number | null;
    totalWorkoutMinutes: number;
    missingDays: string[];
  };
  trends?: Array<{
    date: string;
    steps: number | null;
    sleepMinutes: number | null;
    restingHeartRate: number | null;
    activeEnergyKcal: number | null;
    workoutMinutes: number | null;
  }>;
  sources?: Array<{
    source: string;
    label: string;
    latestMetricAt: string | null;
  }>;
}

export interface FocusSummary {
  score: number;
  band: "low" | "medium" | "high";
  mode: RecoveryMode;
  lifeMode: LifeMode;
  lifeModeLabel: string;
  lifeModeReason: string;
  reasons: string[];
  nextBestAction?: string | null;
  openTaskCount?: number;
  topItems?: Array<{
    id: string;
    title: string;
    modeScore: number;
    modePriorityDelta: number;
    modePriorityMatches: string[];
  }>;
  priorityWeights?: Record<string, number>;
}

export interface ModeSummary {
  userId: string;
  mode: LifeMode;
  label: string;
  source: LifeModeSource;
  reason: string;
  activeUntil: string | null;
  priorityWeights: Record<string, number>;
  resolvedAt: string;
}

export type StudyCourseStatus =
  | "planned"
  | "active"
  | "paused"
  | "completed"
  | "archived";

export interface StudyCourse {
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
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateCourseProgressInput {
  progressPercent: number;
}

export interface SaveModeInput {
  mode: LifeMode | "auto";
  duration?: "today" | "7_days" | "until_date" | "permanent";
  untilDate?: string;
}
