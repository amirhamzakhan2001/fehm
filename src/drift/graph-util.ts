/** Graph helpers shared by the drift detectors. */

/** Tarjan's SCCs of size > 1, members in input order. */
export function stronglyConnected(ids: string[], next: (id: string) => string[]): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const on = new Set<string>();
  const out: string[][] = [];
  const known = new Set(ids);
  let i = 0;
  const visit = (v: string): void => {
    index.set(v, i);
    low.set(v, i);
    i += 1;
    stack.push(v);
    on.add(v);
    for (const w of next(v)) {
      if (!known.has(w)) continue;
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (on.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        on.delete(w);
        scc.push(w);
      } while (w !== v);
      if (scc.length > 1) out.push(ids.filter((x) => scc.includes(x)));
    }
  };
  for (const v of ids) if (!index.has(v)) visit(v);
  return out;
}
