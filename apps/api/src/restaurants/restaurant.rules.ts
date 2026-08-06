import { RestaurantStatus } from "../generated/prisma/client";

export const restaurantModerationTransitions: Record<"suspend" | "reactivate", RestaurantStatus> = {
  suspend: RestaurantStatus.APPROVED,
  reactivate: RestaurantStatus.SUSPENDED
};
