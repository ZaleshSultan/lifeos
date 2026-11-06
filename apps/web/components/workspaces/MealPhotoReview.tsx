"use client";
import type { IdealHumanMeal } from "../../../../packages/core/src/ideal-human.js";
import { MealPhotoReview as SharedMealPhotoReview } from "../../../tma/src/components/ideal-human/MealPhotoReview";
import { webRequest, webErrorMessage } from "@/lib/web-client";
export function MealPhotoReview(props: {
  disabled: boolean;
  onConfirm: (meals: IdealHumanMeal[]) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  draftScope?: string;
}) {
  return (
    <SharedMealPhotoReview
      {...props}
      requestFn={webRequest}
      errorMessage={webErrorMessage}
    />
  );
}
