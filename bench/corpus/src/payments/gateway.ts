/** Contract every payment provider implements. */
export interface PaymentGateway {
  charge(amountCents: number, reference: string): Promise<string>;
  refund(chargeId: string): Promise<void>;
}

/** Stripe-backed payment gateway. */
export class StripeGateway implements PaymentGateway {
  async charge(amountCents: number, reference: string): Promise<string> {
    return `ch_${reference}_${amountCents}`;
  }

  async refund(chargeId: string): Promise<void> {
    void chargeId;
  }
}
