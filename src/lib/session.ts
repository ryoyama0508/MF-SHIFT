import type { ReviewPayload } from "./types";

export const REVIEW_STORAGE_KEY = "mf-shift-review-payload";

export function saveReviewPayload(payload: ReviewPayload): void {
  sessionStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(payload));
}

export function loadReviewPayload(): ReviewPayload | null {
  const raw = sessionStorage.getItem(REVIEW_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ReviewPayload;
  } catch {
    return null;
  }
}
