import type { DatabaseConnection } from "../db/connection";
import { authenticateUser } from "../auth/authenticate";
import { processPayment, refundPayment } from "../payments/processor";

export interface Request { body: Record<string, string>; headers: Record<string, string> }
export interface Response { json(body: unknown): void }
type App = { post(path: string, handler: (req: Request, res: Response) => Promise<void>): void };

/** Register all API request handlers. */
export function registerRoutes(app: App, db: DatabaseConnection): void {
  app.post("/login", (req, res) => loginRoute(req, res, db));
  app.post("/checkout", (req, res) => checkoutRoute(req, res, db));
  app.post("/refund", (req, res) => refundRoute(req, res, db));
}

/** Handle a login request. */
export async function loginRoute(req: Request, res: Response, db: DatabaseConnection): Promise<void> {
  const session = await authenticateUser(db, req.body.email ?? "", req.headers.authorization ?? "");
  res.json({ session: session.id });
}

/** Handle a checkout request by charging the customer. */
export async function checkoutRoute(req: Request, res: Response, db: DatabaseConnection): Promise<void> {
  const receipt = await processPayment(db, req.body.orderId ?? "", Number(req.body.amount));
  res.json(receipt);
}

export async function refundRoute(req: Request, res: Response, db: DatabaseConnection): Promise<void> {
  res.json(await refundPayment(db, req.body.paymentId ?? ""));
}
