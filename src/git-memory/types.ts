export type HistoryCategory = 'code' | 'architecture' | 'api' | 'database' | 'ai' | 'prompts' | 'security' | 'tests' | 'dependencies' | 'documentation' | 'configuration';
export interface MemoryEvent {
  id: string; commit: string; category: HistoryCategory; type: string; path: string;
  entity: string; before: string | null; after: string | null;
  provenance: 'git' | 'ast' | 'heuristic'; confidence: number; evidence: string;
}
export interface FileChange { path: string; oldPath?: string; status: string; additions: number | null; deletions: number | null }
export interface MemoryCommit {
  id: string; parents: string[]; author: string; email: string; at: string; message: string;
  files: FileChange[]; events: MemoryEvent[]; classifications: string[]; warnings: string[];
  revertOf: string | null;
}
export interface GitMemoryReport {
  schemaVersion: 1; generatedAt: string; root: string; available: boolean; head: string | null;
  branch: string | null; defaultBranch: string | null; refs: { name: string; commit: string }[];
  shallow: boolean; dirty: boolean; totalCommits: number; commits: MemoryCommit[];
  coverage: { limit: number; indexed: number; reused: number; analyzed: number; truncated: boolean; warnings: string[] };
  churn: { path: string; changes: number; additions: number; deletions: number; contributors: string[]; testsTogether: number }[];
  clusters: { month: string; category: string; commits: string[]; events: number }[];
}
export interface HistoryOptions { limit?: number; ref?: string; stateDirectory?: string; dryRun?: boolean; force?: boolean }
export interface HistoryFilter { query?: string; path?: string; entity?: string; category?: string; author?: string; since?: string; until?: string; limit?: number }
