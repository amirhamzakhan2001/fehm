/** Bounded work queue; output order is independent of completion order. */
export async function mapConcurrent<T, R>(items: readonly T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Concurrency must be a positive integer");
  const results = new Array<R>(items.length);
  let cursor = 0;
  let failed = false;
  async function worker(): Promise<void> {
    while (!failed && cursor < items.length) {
      const index = cursor++;
      try { results[index] = await work(items[index]!, index); }
      catch (error) { failed = true; throw error; }
    }
  }
  // Await in-flight work before returning an error to avoid background mutations.
  const settled = await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, worker));
  for (const result of settled) if (result.status === "rejected") throw result.reason;
  return results;
}
