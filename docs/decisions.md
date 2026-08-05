# Decisions

## 2026-08-04: Persist authentication in PostgreSQL

The earlier Express demo and in-memory users/sessions were replaced by NestJS, Prisma, and PostgreSQL. Database uniqueness on normalized phone is the final duplicate-account protection, with serializable transactions handling signup races.

## 2026-08-04: Phone-only customer identity

Customer registration and login use only `+970` or `+972` phone numbers. The country prefix and local number are separate in the app and normalized with `libphonenumber-js` in both client and server. Public clients cannot choose a role; self-registration always creates `CUSTOMER`.

## 2026-08-04: Free terminal OTP for development

OTP delivery is behind a provider interface. The current provider prints the code only in the NestJS terminal, while PostgreSQL stores an HMAC bound to challenge, phone, and purpose. Production startup rejects this provider. A real WhatsApp Business or SMS implementation can replace the provider without changing auth flow code.

## 2026-08-04: Stateful refresh and reset credentials

Access tokens are short-lived JWTs. Refresh and reset tokens are opaque random values whose hashes are persisted so they can be rotated, revoked, and consumed once. A successful password reset increments the access-token version and revokes all refresh sessions.

## 2026-08-04: Keep the existing native mobile setup

The Expo SDK 54 development-client, checked-in Android project, three-second branded splash, logo asset, SecureStore use, and VS Code tasks were preserved. Authentication screens use the project's existing lightweight conditional navigation style.

The checked-in Android project is the native source of truth. Expo Doctor's app-config synchronization warning is disabled explicitly for that reason; native configuration changes must be applied to Android Studio files as well as app config when applicable. The existing square Android launcher icons remain unchanged, while the wide TasawaQ asset remains the in-app and splash logo.

## 2026-08-04: Use npm workspaces locally

The repository keeps `pnpm-workspace.yaml` for compatibility with the original specification, while exact local commands use the installed npm workspace setup.

## 2026-08-04: Restaurant status names diverge from the original spec

The spec's own `Restaurant` table design (§9) uses `status: PENDING | ACTIVE | SUSPENDED`. Phase 3 instead implements `RestaurantStatus: PENDING | APPROVED | REJECTED`, matching an explicit approval-workflow requirement given for this phase. `APPROVED` plays the role the spec gave `ACTIVE`; there is no `SUSPENDED` state yet because no endpoint changes an already-approved restaurant's status in this phase. Admin suspension of a live restaurant is left for a later phase and will need its own decision about whether to reuse or extend this enum.

## 2026-08-04: Restaurant owner accounts self-register without OTP, then use the existing login endpoint

Customer signup verifies phone ownership through an OTP challenge before the account exists. Restaurant onboarding in Phase 3 skips that: `POST /api/v1/restaurants/register` creates a `RESTAURANT`-role `User` and a `PENDING` `Restaurant` in one transaction, with `phoneVerifiedAt` set immediately (self-attested, not SMS-verified) so the existing, unmodified `POST /api/v1/auth/login` works for the new role without any changes to the auth module. This was chosen over building a second OTP flow or a JWT-issuing registration response because it reaches a working restaurant-onboarding path with the least new surface area, and it leaves the auth module exactly as it was validated in the customer-auth phase. It also means a restaurant owner can log in and manage their profile/menu before an admin approves the restaurant — only the public catalog is gated on `status = APPROVED`. Registration does not accept a role from the client; it always creates `RESTAURANT`, matching the "public clients cannot choose a role" rule from Phase 2.

## 2026-08-04: Menu category and item ownership is resolved from the authenticated user, never from a client-sent restaurant id

Every `/api/v1/restaurant/me/...` endpoint looks up the caller's restaurant via `Restaurant.ownerUserId = request.user.id` — the restaurant id itself never appears in the URL or body for the owner-portal routes. For category/item mutation endpoints where a resource id *is* in the URL (e.g. `PATCH /restaurant/me/menu/items/:itemId`), the service re-checks that the resource's `restaurantId` matches the caller's own restaurant before allowing the change, and returns a generic `404` (not `403`) on mismatch so a restaurant cannot learn that another restaurant's item id exists. A `RolesGuard` (`common/guards/roles.guard.ts`) plus `@Roles()` decorator were added to enforce `RESTAURANT`/`ADMIN` role checks on top of the existing `JwtAuthGuard`, reused as-is.

## 2026-08-04: Admin approval is a minimal, dedicated pair of endpoints

`POST /api/v1/admin/restaurants/:id/approve` and `.../reject` only work on a restaurant currently in `PENDING` status (`RESTAURANT_NOT_PENDING` otherwise) — no free-form status endpoint. A full admin panel, an `AuditLog`, and a rejection-reason field are out of scope for Phase 3 and were deliberately not added; the spec's own admin section is deferred to a later phase. An `ADMIN` seed account (`+970590000001` / `Test@12345`) was added so the approval flow is testable locally without a real admin panel.
