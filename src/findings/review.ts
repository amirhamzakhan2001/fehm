import { join } from "node:path";
import { readJson, writeJsonAtomic } from "../persistence.js";
import type { Finding, FindingReview, ReviewStatus } from "./model.js";

/**
 * Finding review state, shared by 3.5 and 3.6: what a person decided about a
 * finding (reviewed, false positive, accepted risk, suppressed). Stored in the
 * state directory by finding id; a finding whose id no longer occurs simply
 * stops matching (it was fixed or changed), so the file never needs pruning
 * for correctness.
 */

export const REVIEW_FILE = "findings-review.json";
const STATUSES: readonly ReviewStatus[] = ["reviewed", "false-positive", "accepted-risk", "suppressed"];

interface ReviewStore {
  version: 1;
  reviews: Record<string, FindingReview>;
}

export function isReviewStatus(s: string): s is ReviewStatus {
  return (STATUSES as readonly string[]).includes(s);
}

export function readReviews(stateDirectory: string): Record<string, FindingReview> {
  const r = readJson<ReviewStore>(join(stateDirectory, REVIEW_FILE));
  if (!r.ok || typeof r.value?.reviews !== "object" || r.value.reviews === null) return {};
  const out: Record<string, FindingReview> = {};
  for (const [id, v] of Object.entries(r.value.reviews)) if (v && isReviewStatus(v.status) && typeof v.at === "string") out[id] = v;
  return out;
}

/** Set (or with `status: null`, clear) the review of one finding. */
export function writeReview(stateDirectory: string, id: string, status: ReviewStatus | null, note?: string): Record<string, FindingReview> {
  const reviews = readReviews(stateDirectory);
  if (status === null) delete reviews[id];
  else reviews[id] = { status, at: new Date().toISOString(), ...(note ? { note: note.slice(0, 500) } : {}) };
  writeJsonAtomic(join(stateDirectory, REVIEW_FILE), { version: 1, reviews } satisfies ReviewStore);
  return reviews;
}

export function applyReviews(findings: Finding[], reviews: Record<string, FindingReview>): void {
  for (const f of findings) {
    const r = reviews[f.id];
    if (r) f.review = r;
    else delete f.review;
  }
}
