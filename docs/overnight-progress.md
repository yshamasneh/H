# JOVO implementation progress

Branch: `agent/phase-15-and-jovo-brand`. Scope: Trial/Development only. Preserve `codexReviewJovo.md` and `products/`.

## Planned groups

1. Admin product image upload and safe replacement.
2. Exact `missingProducts.jpg` fallback and image dimensions.
3. Closed-store cart and checkout behavior.
4. Delivery fee agreement from quote through saved order and driver view.
5. Driver foreground location and map destination lifecycle.
6. Expo background location with foreground fallback.
7. Admin driver location view with scoped REST endpoint.
8. Cash collection and admin-confirmed driver settlement.
9. Connected review and repairs, then one final full verification.

## Completed

- Group 1: product upload remains SAS → direct Blob PUT → complete → persistent `imageUrl`; save and old-image cleanup are now ordered safely. File upload is primary; an external HTTPS URL is under an advanced control and signed URLs are refused.
- Group 2: copied the exact untracked `products/missingProducts.jpg` into tracked Mobile and Admin assets without moving or deleting the source. Product images now use it for absent, invalid, and failed URLs; cart emoji fallback removed. Checkout and order summaries show product images. Cards crop to square, and product detail contains the full image.

## In progress

- Group 2: commit, push, and monitor deployment.

## Remaining

- Groups 3–9 and final verification.

## Checks, commits, and Actions

| Group | Focused checks | Commit | Actions run | Result |
| --- | --- | --- | --- | --- |
| 1 | Image upload tests 6/6; Admin typecheck passed; `git diff --check` passed | `e97369d6b72b5926b22a7b8fa8063fd3ccd7e776` | https://github.com/yshamasneh/H/actions/runs/35489471407 | Deployment and readiness passed |
| 2 | Mobile image UI 7/7, cart/checkout UI 8/8, cart storage 15/15, Admin image tests 6/6; Mobile/Admin typechecks and `git diff --check` passed | Pending | Pending | Pending |

## New issues and decisions

- The existing admin uploader completes SAS → Blob PUT → publish, but product saving uses a helper that treats a successful write followed by a failed list refresh as a failed save. That can delete the new blob after the product already references it. Fix before release.
- Keep the current upload purpose/restaurant ownership checks. Do not delete external or other-store blobs.
- The UI did not expose logo or offer image fields, so upload integration remains on product create/edit rather than adding new unrelated forms.
- The admin file limit matches the API's current maximum and Trial default: 5,242,880 bytes. The API remains authoritative if the runtime setting is lower.
- The source image and both new tracked copies have SHA-256 `D793010543458AE231DD92A2E7C601203C9F2788C593CA6BA255E47E94F57E77`. Existing compressed assets were left untouched.
- Mobile UI tests cover square, wide, and tall image load events with `cover`/`contain` props; actual device visual inspection remains unverified.
- Local `node_modules` lacked Jest; `npm ci` restored it from the lockfile. The focused UI suite passes, though existing Icon tests print React `act(...)` warnings. The install reported 27 dependency advisories; dependency upgrades are outside this image task.
