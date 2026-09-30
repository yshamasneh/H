import { Logger } from "@nestjs/common";
import { ApiException } from "../common/api.exception";
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

/**
 * Our reading of why a send did not succeed. **Diagnostic only.**
 *
 *  REFUSED      a rejection we have specific provider evidence for, such as credentials the
 *               gateway will not accept. Our best reading of "this cannot have been queued".
 *  UNCONFIRMED  everything else: a timeout, a network error, any HTTP error, an unrecognised
 *               provider code, a body we cannot interpret.
 *
 * This value must never be used to relax an OTP control. We cannot see the gateway's billing or
 * its queue, so even REFUSED is an inference, and a caller that skipped a cooldown or a send budget
 * on the strength of it would be granting a bypass on the basis of a guess. Callers bound every
 * provider attempt identically, whatever the outcome says; the classification exists so an operator
 * reading the logs can tell a wrong API key from a timeout.
 */
export type OtpDeliveryOutcome = "REFUSED" | "UNCONFIRMED";

/**
 * Raised by every OtpProvider when a code was not accepted for delivery.
 *
 * `outcome`, `reason` and `providerCode` are for the server's own logs. They are all drawn from
 * closed sets or from a strict numeric parse — never from provider-supplied text — so that nothing
 * a gateway chooses to echo back can reach a log line. The body the client receives is the plain
 * sanitized ApiException payload, with no provider detail in it at all.
 */
export class OtpDeliveryError extends ApiException {
  constructor(
    readonly outcome: OtpDeliveryOutcome,
    /** Closed-set internal failure reason, e.g. "TIMEOUT". Never provider text. */
    readonly reason: string,
    /** The provider's own status code, strictly numeric as a string, or "NONE". */
    readonly providerCode: string = "NONE"
  ) {
    super(503, "OTP_DELIVERY_FAILED", "The verification code could not be sent. Please try again.");
  }
}

/** Enough of a number to correlate a delivery failure with a report, and no more. */
export function maskPhoneForLogs(phone: string): string {
  return phone.length <= 7 ? "***" : `${phone.slice(0, 4)}***${phone.slice(-3)}`;
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
      throw new OtpDeliveryError("UNCONFIRMED", "NETWORK_ERROR");
    }

    if (!response.ok) {
      // Only a rejected credential is evidence that the bridge stopped before doing anything. Any
      // other status — a 400 the bridge returned after already handing the message on, a 5xx from
      // halfway through — leaves the outcome genuinely unknown.
      const authRejected = response.status === 401 || response.status === 403;
      throw new OtpDeliveryError(
        authRejected ? "REFUSED" : "UNCONFIRMED",
        authRejected ? "AUTH_REJECTED" : "HTTP_ERROR",
        String(response.status)
      );
    }
  }
}
