import { request } from "./api";
import type { OfferBody, OfferView } from "./offer-form";

/** Platform-wide promotions. The server guards these with the ADMIN role and MANAGE_OFFERS. */
const base = "/api/v1/admin/offers";

export const listOffers = () => request<OfferView[]>(base);
export const createOffer = (body: OfferBody) => request<OfferView>(base, { method: "POST", body });
/** A full replace: send every field the offer should keep (see `offer-form.ts`). */
export const updateOffer = (offerId: string, body: OfferBody) =>
  request<OfferView>(`${base}/${offerId}`, { method: "PATCH", body });
