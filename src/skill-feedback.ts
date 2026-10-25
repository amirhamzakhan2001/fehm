import { join } from "node:path";
import { readJson, stateDir, writeJsonAtomic } from "./persistence.js";
import type { SkillFeedbackEntry, SkillFeedbackValue, TaskProfile } from "./skill-model.js";
import { profileTask } from "./skill-profile.js";

/**
 * Skill memory: which skills were useful for which kinds of task. A small,
 * local, inspectable ranking signal — never an authority. The router bounds
 * its weight and only applies it to candidates that current task evidence has
 * already admitted, so history can reorder near-ties but cannot select an
 * irrelevant skill or outvote the task.
 */
interface FeedbackStore {
  version: 1;
  entries: SkillFeedbackEntry[];
}

export const FEEDBACK_VALUES: readonly SkillFeedbackValue[] = ["useful", "neutral", "irrelevant", "conflicting", "too-verbose", "missing"];

const feedbackPath = (root: string, dir?: string): string => join(stateDir(root, dir), "skill-feedback.json");

export function loadSkillFeedback(root: string, dir?: string): SkillFeedbackEntry[] {
  const read = readJson<FeedbackStore>(feedbackPath(root, dir));
  return read.ok && Array.isArray(read.value?.entries) ? read.value.entries : [];
}

export function recordSkillFeedback(
  root: string,
  input: { task: string; skillId: string; feedback: SkillFeedbackValue; outcome?: SkillFeedbackEntry["outcome"] },
  dir?: string,
  now = new Date(),
): SkillFeedbackEntry {
  if (!FEEDBACK_VALUES.includes(input.feedback)) throw new Error(`feedback must be one of ${FEEDBACK_VALUES.join(", ")}`);
  const task = input.task.trim();
  if (!task) throw new Error("feedback needs the task it refers to");
  const profile = profileTask(task);
  const entry: SkillFeedbackEntry = { task: task.slice(0, 500), terms: profile.terms, intents: profile.intents, skillId: input.skillId, feedback: input.feedback, at: now.toISOString() };
  if (input.outcome) entry.outcome = input.outcome;
  const entries = loadSkillFeedback(root, dir);
  entries.push(entry);
  writeJsonAtomic(feedbackPath(root, dir), { version: 1, entries: entries.slice(-2000) } satisfies FeedbackStore);
  return entry;
}

/*
 * ── Upstream adaptation ───────────────────────────────────────────────────
 * Upstream: rohitg00/agentmemory @ bcf4f0d00d1c71e9221287a4778e4122ce2d7574
 * File:     src/functions/lessons.ts (Apache-2.0; attribution in THIRD_PARTY_NOTICES.md)
 * Kept:     reinforceLesson's bounded update `c + 0.1·(1 − c)` and the
 *           lesson-search recency boost `1 / (1 + days·0.01)`.
 * Changed:  - a "lesson" is a (similar task → skill) association built on the
 *             fly from feedback entries instead of a stored record
 *           - negative feedback weakens symmetrically, `c − 0.1·c` (upstream
 *             only weakens through time decay)
 *           - starting confidence 0.5 = no opinion; the signal is (c − 0.5)·2
 *           - relevance is task similarity (terms + intents), not BM25
 *           - no persistence of confidence, decay sweep or soft delete
 */
const REINFORCE = 0.1;
const RECENCY_PER_DAY = 0.01;

const reinforce = (c: number): number => Math.min(1, c + REINFORCE * (1 - c));
const weaken = (c: number): number => Math.max(0, c - REINFORCE * c);

const POLARITY: Record<SkillFeedbackValue, 1 | 0 | -1> = {
  useful: 1,
  missing: 1,
  neutral: 0,
  irrelevant: -1,
  conflicting: -1,
  "too-verbose": 0,
};

const jaccard = (a: readonly string[], b: readonly string[]): number => {
  if (!a.length && !b.length) return 0;
  const sa = new Set(a);
  const inter = b.filter((x) => sa.has(x)).length;
  return inter / (sa.size + new Set(b).size - inter);
};

export interface HistoricalSignal {
  /** −1 … 1: net evidence that this skill helps tasks like the current one. */
  signal: number;
  confidence: number;
  similarTasks: number;
  /** Similar tasks reported the skill as too verbose: prefer a lower level. */
  preferShorter: boolean;
}

/** Minimum task similarity for feedback to count at all. */
export const FEEDBACK_SIMILARITY = 0.3;

export function historicalSignals(entries: readonly SkillFeedbackEntry[], profile: TaskProfile, now = new Date()): Map<string, HistoricalSignal> {
  const bySkill = new Map<string, { entry: SkillFeedbackEntry; similarity: number }[]>();
  for (const entry of entries) {
    const similarity = 0.6 * jaccard(entry.terms, profile.terms) + 0.4 * jaccard(entry.intents, profile.intents);
    if (similarity < FEEDBACK_SIMILARITY) continue;
    const list = bySkill.get(entry.skillId) ?? [];
    list.push({ entry, similarity });
    bySkill.set(entry.skillId, list);
  }
  const out = new Map<string, HistoricalSignal>();
  for (const [skillId, list] of [...bySkill.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    list.sort((a, b) => (a.entry.at < b.entry.at ? -1 : a.entry.at > b.entry.at ? 1 : 0));
    let confidence = 0.5;
    let weight = 0;
    let verbose = 0;
    for (const { entry, similarity } of list) {
      const polarity = POLARITY[entry.feedback];
      if (polarity > 0) confidence = reinforce(confidence);
      else if (polarity < 0) confidence = weaken(confidence);
      if (entry.feedback === "too-verbose") verbose += 1;
      const days = Math.max(0, (now.getTime() - new Date(entry.at).getTime()) / 86_400_000);
      weight = Math.max(weight, similarity / (1 + days * RECENCY_PER_DAY));
    }
    out.set(skillId, {
      signal: Math.round((confidence - 0.5) * 2 * weight * 1e4) / 1e4,
      confidence: Math.round(confidence * 1e4) / 1e4,
      similarTasks: list.length,
      preferShorter: verbose > 0 && verbose * 2 >= list.length,
    });
  }
  return out;
}
