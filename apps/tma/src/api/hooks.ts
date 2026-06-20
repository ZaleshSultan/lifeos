import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { telegram } from "../telegram";
import { api } from "./client";

export const queryKeys = {
  session: ["session"] as const,
  home: ["home"] as const,
  workout: ["workout", "current"] as const,
  health: ["health"] as const,
  focus: ["focus"] as const,
  sources: ["sources"] as const,
  reminders: ["reminders"] as const,
  finance: ["finance"] as const,
  financeCategories: ["finance", "categories"] as const,
  monthlyReview: ["monthly-review"] as const,
  academic: ["academic"] as const,
  mode: ["mode"] as const,
  activeCourse: ["course", "active"] as const,
  receipt: (id: string) => ["finance", "receipt", id] as const,
};

export function useSessionQuery() {
  return useQuery({
    queryKey: queryKeys.session,
    queryFn: api.getSession,
  });
}

export function useRegisterSessionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.registerSession,
    onSuccess(data) {
      telegram.hapticImpact("medium");
      queryClient.setQueryData(queryKeys.session, data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    },
  });
}

export function useStartGoogleOAuthMutation() {
  return useMutation({
    mutationFn: api.startGoogleOAuth,
    onSuccess(data) {
      telegram.hapticImpact("medium");
      window.location.assign(data.url);
    },
  });
}

export function useDisconnectGoogleOAuthMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.disconnectGoogleOAuth,
    onSuccess(data) {
      telegram.hapticImpact("light");
      queryClient.setQueryData(queryKeys.session, data);
    },
  });
}

export function useHomeQuery() {
  return useQuery({
    queryKey: queryKeys.home,
    queryFn: api.getHome,
  });
}

export function useWorkoutQuery() {
  return useQuery({
    queryKey: queryKeys.workout,
    queryFn: api.getCurrentWorkout,
  });
}

export function useHealthQuery() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: api.getHealth,
  });
}

export function useFocusQuery() {
  return useQuery({
    queryKey: queryKeys.focus,
    queryFn: api.getFocus,
  });
}

export function useSourcesQuery() {
  return useQuery({
    queryKey: queryKeys.sources,
    queryFn: api.getSources,
  });
}

export function useRemindersQuery() {
  return useQuery({
    queryKey: queryKeys.reminders,
    queryFn: api.getReminders,
  });
}

export function useFinanceQuery() {
  return useQuery({
    queryKey: queryKeys.finance,
    queryFn: api.getFinance,
  });
}

export function useFinanceCategoriesQuery() {
  return useQuery({
    queryKey: queryKeys.financeCategories,
    queryFn: api.getFinanceCategories,
  });
}

export function useCreateFinanceTransactionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.createFinanceTransaction,
    onSuccess(data) {
      telegram.hapticImpact("medium");
      queryClient.setQueryData(queryKeys.finance, data);
    },
  });
}

export function useCreateBudgetMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.createBudget,
    onSuccess(data) {
      telegram.hapticImpact("medium");
      queryClient.setQueryData(queryKeys.finance, data);
    },
  });
}

export function useUpdateBudgetMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      budgetId,
      input,
    }: {
      budgetId: string;
      input: Parameters<typeof api.updateBudget>[1];
    }) => api.updateBudget(budgetId, input),
    onSuccess(data) {
      telegram.hapticImpact("light");
      queryClient.setQueryData(queryKeys.finance, data);
    },
  });
}

export function useArchiveBudgetMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.archiveBudget,
    onSuccess(data) {
      telegram.hapticImpact("light");
      queryClient.setQueryData(queryKeys.finance, data);
    },
  });
}

export function useSaveFinanceSettingsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.saveFinanceSettings,
    onSuccess(data) {
      telegram.hapticImpact("medium");
      queryClient.setQueryData(queryKeys.finance, data);
    },
  });
}

export function useUploadFinanceReceiptMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.uploadFinanceReceipt,
    onSuccess(data) {
      telegram.hapticImpact("medium");
      queryClient.setQueryData(queryKeys.finance, data);
    },
  });
}

export function useMonthlyReviewQuery() {
  return useQuery({
    queryKey: queryKeys.monthlyReview,
    queryFn: api.getMonthlyReview,
  });
}

export function useGenerateMonthlyReviewMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.generateMonthlyReview,
    onSuccess(data) {
      telegram.hapticImpact("medium");
      queryClient.setQueryData(queryKeys.monthlyReview, data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    },
  });
}

export function useAcademicQuery() {
  return useQuery({
    queryKey: queryKeys.academic,
    queryFn: api.getAcademic,
  });
}

export function useModeQuery() {
  return useQuery({
    queryKey: queryKeys.mode,
    queryFn: api.getMode,
  });
}

export function useActiveCourseQuery() {
  return useQuery({
    queryKey: queryKeys.activeCourse,
    queryFn: api.getActiveCourse,
  });
}

export function useSaveModeMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.saveMode,
    onSuccess(data) {
      telegram.hapticImpact("medium");
      queryClient.setQueryData(queryKeys.mode, data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
      void queryClient.invalidateQueries({ queryKey: queryKeys.focus });
      void queryClient.invalidateQueries({ queryKey: queryKeys.workout });
    },
  });
}

export function useClearModeMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.clearMode,
    onSuccess(data) {
      telegram.hapticImpact("light");
      queryClient.setQueryData(queryKeys.mode, data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
      void queryClient.invalidateQueries({ queryKey: queryKeys.focus });
      void queryClient.invalidateQueries({ queryKey: queryKeys.workout });
    },
  });
}

export function useUpdateActiveCourseProgressMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.updateActiveCourseProgress,
    onSuccess(data) {
      telegram.hapticImpact("light");
      queryClient.setQueryData(queryKeys.activeCourse, data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.focus });
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    },
  });
}

export function useCreateReminderMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.createReminder,
    onSuccess(data) {
      telegram.hapticImpact("light");
      queryClient.setQueryData(queryKeys.sources, data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
      void queryClient.invalidateQueries({ queryKey: queryKeys.reminders });
    },
  });
}

export function useCancelReminderMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.cancelReminder,
    onSuccess() {
      telegram.hapticImpact("light");
      void queryClient.invalidateQueries({ queryKey: queryKeys.reminders });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sources });
    },
  });
}

export function useStartWorkoutMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.startWorkout,
    onSuccess(data) {
      telegram.hapticImpact("medium");
      queryClient.setQueryData(queryKeys.workout, data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    },
  });
}

export function useCompleteSetMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.completeSet,
    onSuccess(data) {
      telegram.hapticImpact("light");
      queryClient.setQueryData(queryKeys.workout, data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    },
  });
}

export function useUndoSetMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.undoSet,
    onSuccess(data) {
      telegram.hapticImpact("light");
      queryClient.setQueryData(queryKeys.workout, data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    },
  });
}

export function useCompleteWorkoutMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.completeWorkout,
    onSuccess() {
      telegram.hapticImpact("medium");
      queryClient.setQueryData(queryKeys.workout, null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    },
  });
}

export function useReceiptQuery(receiptId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.receipt(receiptId),
    queryFn: () => api.getReceipt(receiptId),
    enabled: !!receiptId && enabled,
  });
}

export function useReviewReceiptMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      receiptId,
      input,
    }: {
      receiptId: string;
      input: Parameters<typeof api.reviewReceipt>[1];
    }) => api.reviewReceipt(receiptId, input),
    onSuccess(data) {
      telegram.hapticImpact("medium");
      void queryClient.invalidateQueries({ queryKey: queryKeys.finance });
      if (data.id) {
        queryClient.setQueryData(queryKeys.receipt(data.id), data);
      }
    },
  });
}

export function useBackfillMutation() {
  return useMutation({
    mutationFn: api.backfillFinanceBaseAmounts,
    onSuccess() {
      telegram.hapticImpact("medium");
    },
  });
}
