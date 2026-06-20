-- Keep finance budget date ranges consistent even for partial PATCH updates.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'finance_budgets_period_end_valid'
      AND conrelid = 'public.finance_budgets'::regclass
  ) THEN
    ALTER TABLE public.finance_budgets
      ADD CONSTRAINT finance_budgets_period_end_valid
      CHECK (period_end IS NULL OR period_end >= period_start);
  END IF;
END;
$$;
