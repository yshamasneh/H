import { Logger } from "@nestjs/common";
import type { OtpPurpose } from "../generated/prisma/enums";

export const OTP_PROVIDER = Symbol("OTP_PROVIDER");

export type OtpDelivery = {
  phone: string;
  purpose: OtpPurpose;
  code: string;
};

export interface OtpProvider {
  send(delivery: OtpDelivery): Promise<void>;
}

export class DevelopmentOtpProvider implements OtpProvider {
  private readonly logger = new Logger("DevelopmentOtpProvider");

  async send(delivery: OtpDelivery): Promise<void> {
    this.logger.log(`[DEV OTP] ${delivery.purpose} ${delivery.phone} => ${delivery.code}`);
  }
}

type FetchImplementation = typeof fetch;

/**
 * Vendor-neutral production adapter. The receiving HTTPS endpoint owns the final
 * SMS/WhatsApp provider integration and must return any 2xx status after accepting
 * the message. OTP values are never written to application logs by this provider.
 */
export class WebhookOtpProvider implements OtpProvider {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly timeoutMs: number,
    private readonly fetchImplementation: FetchImplementation = fetch
  ) {}

  async send(delivery: OtpDelivery): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchImplementation(this.url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          phone: delivery.phone,
          purpose: delivery.purpose,
          code: delivery.code
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch {
      throw new Error("The OTP delivery service is unavailable.");
    }

    if (!response.ok) {
      throw new Error(`The OTP delivery service rejected the request with status ${response.status}.`);
    }
  }
}
