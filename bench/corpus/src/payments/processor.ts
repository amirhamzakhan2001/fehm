import type { DatabaseConnection } from "../db/connection";
import { StripeGateway, type PaymentGateway } from "./gateway";
import { AppError } from "../util/errors";

export interface Receipt { paymentId: string; amount: number }

const gateway: PaymentGateway = new StripeGateway();

/** Charge an order through the payment gateway and record the payment. */
export async function processPayment(db: DatabaseConnection, orderId: string, amount: number): Promise<Receipt> {
  if (!(amount > 0)) throw new AppError("invalid amount", 400);
  const paymentId = await gateway.charge(Math.round(amount * 100), orderId);
  await db.query("insert into payments values ($1, $2)", [paymentId, amount]);
  return { paymentId, amount };
}

/** Refund a previously processed payment. */
export async function refundPayment(db: DatabaseConnection, paymentId: string): Promise<{ refunded: boolean }> {
  await gateway.refund(paymentId);
  await db.query("update payments set refunded = true where id = $1", [paymentId]);
  return { refunded: true };
}
