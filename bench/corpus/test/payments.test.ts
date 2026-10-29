import { processPayment } from "../src/payments/processor";
import { createConnection } from "../src/db/connection";

export async function testCheckoutCharges(): Promise<void> {
  await processPayment(createConnection("postgres://test"), "o1", 10);
}
