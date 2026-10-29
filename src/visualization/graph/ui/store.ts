/**
 * Central UI state for the graph page. Low-frequency, user-meaningful state
 * lives here (filters, selection, hover, search, toggles); camera motion and
 * animation stay in the renderer loop so they never trigger UI updates.
 */
export interface GraphUIState {
  activeNodeKinds: Set<string>;
  activeEdgeKinds: Set<string>;
  selected: number;
  hovered: number;
  searchQuery: string;
  /** Search candidates highlighted on the canvas; null when no search is active. */
  searchMatches: Set<number> | null;
  labels: boolean;
  fullscreen: boolean;
  sidebarOpen: boolean;
}

export type StateKey = keyof GraphUIState;
type Listener = (changed: ReadonlySet<StateKey>, state: Readonly<GraphUIState>) => void;

export class GraphStore {
  private listeners: Listener[] = [];
  private pending = new Set<StateKey>();
  private scheduled = false;

  constructor(public state: GraphUIState) {}

  subscribe(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  /** Apply a patch; listeners run once per microtask with every key that changed. */
  set(patch: Partial<GraphUIState>): void {
    for (const [key, value] of Object.entries(patch) as [StateKey, never][]) {
      if (Object.is(this.state[key], value)) continue;
      (this.state as unknown as Record<string, unknown>)[key] = value;
      this.pending.add(key);
    }
    if (!this.pending.size || this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      const changed = this.pending;
      this.pending = new Set();
      for (const l of this.listeners) l(changed, this.state);
    });
  }
}

export interface PersistedView {
  /** Active kinds at save time. */
  nodeKinds?: string[];
  edgeKinds?: string[];
  /** Every kind present at save time, so kinds added later are not treated as switched off. */
  knownNodeKinds?: string[];
  knownEdgeKinds?: string[];
  selectedId?: string;
  camera?: [number, number, number];
  labels?: boolean;
}

/** Session-scoped memory of the view, per project root. Failures are ignored. */
export function loadView(root: string): PersistedView {
  try {
    const raw = sessionStorage.getItem(`fehm.graph:${root}`);
    return raw ? (JSON.parse(raw) as PersistedView) : {};
  } catch {
    return {};
  }
}

export function saveView(root: string, view: PersistedView): void {
  try {
    sessionStorage.setItem(`fehm.graph:${root}`, JSON.stringify(view));
  } catch {
    // Storage unavailable (private mode, quota): the view simply is not remembered.
  }
}
