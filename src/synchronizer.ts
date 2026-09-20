import type { FehmConfig } from "./config.js";
import { buildIndex, writeIndex } from "./indexer.js";
import type { CodeGraph } from "./model.js";

export interface SynchronizerOptions {
  intervalMs?: number;
  onSync?: (graph: CodeGraph) => void | Promise<void>;
  onError?: (error: Error) => void | Promise<void>;
}

export interface ProjectSynchronizer {
  runNow(): Promise<CodeGraph>;
  stop(): void;
  readonly running: boolean;
}

export function startProjectSynchronizer(config: FehmConfig, options: SynchronizerOptions = {}): ProjectSynchronizer {
  const intervalMs = Math.max(250, options.intervalMs ?? 1_500);
  let stopped = false;
  let active: Promise<CodeGraph> | undefined;
  let timer: NodeJS.Timeout | undefined;

  const runNow = async (): Promise<CodeGraph> => {
    if (active) return active;
    active = (async () => {
      const graph = await buildIndex(config);
      await writeIndex(graph, config.outputDirectory);
      await options.onSync?.(graph);
      return graph;
    })();
    try {
      return await active;
    } finally {
      active = undefined;
    }
  };

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(async () => {
      try {
        await runNow();
      } catch (error) {
        await options.onError?.(error instanceof Error ? error : new Error(String(error)));
      } finally {
        schedule();
      }
    }, intervalMs);
  };

  schedule();
  return {
    runNow,
    stop(): void {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
    get running(): boolean { return !stopped; },
  };
}
