import { DeliveryStatus } from "../generated/prisma/client";
import type { DriverDeliveryStatusAction } from "./drivers.dto";

export const deliveryStatusTransitions: Record<DriverDeliveryStatusAction, DeliveryStatus> = {
  PICKED_UP: DeliveryStatus.PICKED_UP,
  ON_THE_WAY: DeliveryStatus.ON_THE_WAY,
  DELIVERED: DeliveryStatus.DELIVERED
};

export const allowedDeliveryTransitions: Record<DeliveryStatus, DeliveryStatus[]> = {
  [DeliveryStatus.PENDING_ASSIGNMENT]: [],
  [DeliveryStatus.ASSIGNED]: [DeliveryStatus.PICKED_UP],
  [DeliveryStatus.PICKED_UP]: [DeliveryStatus.ON_THE_WAY],
  [DeliveryStatus.ON_THE_WAY]: [DeliveryStatus.DELIVERED],
  [DeliveryStatus.DELIVERED]: [],
  [DeliveryStatus.CANCELLED]: []
};
