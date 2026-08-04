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
