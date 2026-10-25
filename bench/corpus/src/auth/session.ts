export interface Session { id: string; userId: string; createdAt: number }

/** In-memory session store. */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  save(session: Session): void {
    this.sessions.set(session.id, session);
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }
}

const store = new SessionStore();

/** Create and persist a new session for a user. */
export function createSession(userId: string): Session {
  const session = { id: `${userId}-${Date.now()}`, userId, createdAt: Date.now() };
  store.save(session);
  return session;
}
