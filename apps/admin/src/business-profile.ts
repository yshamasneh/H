/**
 * The store owner's profile form: name, description, address, delivery-origin coordinates, and the
 * weekly opening hours.
 *
 * The logo is deliberately absent — image handling is a separate piece of work — and because the
 * server applies this as a partial update (an omitted field is left alone), never sending `logoUrl`
 * is exactly "leave the logo as it is".
 *
 * Only fields that actually changed are sent. That keeps the audit trail honest and, more
 * practically, avoids re-submitting coordinates the owner never touched: latitude and longitude
 * must travel together, and a stale half of the pair would be refused.
 */

export type ProfileFields = {
  name: string;
  description: string | null;
  addressLine: string;
  latitude: number | null;
  longitude: number | null;
  opensAt?: string | null;
  closesAt?: string | null;
};

export type ProfileDraft = {
  name: string;
  description: string;
  addressLine: string;
  latitude: number | null;
  longitude: number | null;
  /** "HH:mm" (24h) or empty for no schedule. */
  opensAt: string;
  closesAt: string;
};

export type ProfileBody = Partial<{
  name: string;
  description: string;
  addressLine: string;
  latitude: number;
  longitude: number;
  opensAt: string;
  closesAt: string;
}>;

export type ProfileError =
  | "nameInvalid"
  | "descriptionTooLong"
  | "addressInvalid"
  | "coordinatesInvalid"
  | "hoursIncomplete"
  | "hoursInvalid"
  | "hoursSame";

export type ProfileResult =
  | { ok: true; body: ProfileBody; changed: boolean }
  | { ok: false; error: ProfileError; field: keyof ProfileDraft };

export function profileToDraft(profile: ProfileFields): ProfileDraft {
  return {
    name: profile.name,
    description: profile.description ?? "",
    addressLine: profile.addressLine,
    latitude: profile.latitude,
    longitude: profile.longitude,
    opensAt: profile.opensAt ?? "",
    closesAt: profile.closesAt ?? ""
  };
}

const timeOfDay = /^([01]\d|2[0-3]):[0-5]\d$/;

export function buildProfileUpdate(draft: ProfileDraft, original: ProfileFields): ProfileResult {
  const name = draft.name.trim();
  if (name.length < 2 || name.length > 120) return { ok: false, error: "nameInvalid", field: "name" };
  const description = draft.description.trim();
  if (description.length > 500) return { ok: false, error: "descriptionTooLong", field: "description" };
  const addressLine = draft.addressLine.trim();
  if (addressLine.length < 3 || addressLine.length > 200) {
    return { ok: false, error: "addressInvalid", field: "addressLine" };
  }

  const latitude = draft.latitude;
  const longitude = draft.longitude;
  if ((latitude === null) !== (longitude === null)) return { ok: false, error: "coordinatesInvalid", field: "latitude" };
  if (
    latitude !== null &&
    longitude !== null &&
    (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180)
  ) {
    return { ok: false, error: "coordinatesInvalid", field: "latitude" };
  }

  const opensAt = draft.opensAt.trim();
  const closesAt = draft.closesAt.trim();
  if ((opensAt === "") !== (closesAt === "")) return { ok: false, error: "hoursIncomplete", field: "opensAt" };
  if (opensAt !== "") {
    if (!timeOfDay.test(opensAt) || !timeOfDay.test(closesAt)) return { ok: false, error: "hoursInvalid", field: "opensAt" };
    if (opensAt === closesAt) return { ok: false, error: "hoursSame", field: "closesAt" };
  }

  const body: ProfileBody = {};
  if (name !== original.name) body.name = name;
  if (description !== (original.description ?? "")) body.description = description;
  if (addressLine !== original.addressLine) body.addressLine = addressLine;
  if (latitude !== null && longitude !== null && (latitude !== original.latitude || longitude !== original.longitude)) {
    body.latitude = latitude;
    body.longitude = longitude;
  }
  if (opensAt !== (original.opensAt ?? "") || closesAt !== (original.closesAt ?? "")) {
    // An empty string is how the API clears a schedule; both bounds always travel together.
    body.opensAt = opensAt;
    body.closesAt = closesAt;
  }
  return { ok: true, body, changed: Object.keys(body).length > 0 };
}
