/**
 * The HTTP methods the API answers cross-origin.
 *
 * This list is the browser's permission slip: a method missing here is refused at the preflight, so
 * the request never reaches Nest and no server-side log records it. That is how PUT went missing —
 * the driver presence heartbeat (PUT /driver/me/presence, the only PUT in the API) was blocked in
 * every browser client while curl kept working, which left web drivers with an expired presence
 * lease and therefore no new-delivery alerts.
 *
 * Kept beside a test that checks it against the verbs the controllers actually declare, so adding a
 * route with a new verb cannot silently go unreachable from the apps.
 */
export const corsAllowedMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
