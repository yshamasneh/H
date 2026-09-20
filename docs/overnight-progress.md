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

## In progress

- Group 1: commit, push, and monitor deployment.

## Remaining

- Groups 2–9 and final verification.

## Checks, commits, and Actions

| Group | Focused checks | Commit | Actions run | Result |
| --- | --- | --- | --- | --- |
| 1 | Image upload tests 6/6; Admin typecheck passed; `git diff --check` passed | Pending | Pending | Pending |

## New issues and decisions

- The existing admin uploader completes SAS → Blob PUT → publish, but product saving uses a helper that treats a successful write followed by a failed list refresh as a failed save. That can delete the new blob after the product already references it. Fix before release.
- Keep the current upload purpose/restaurant ownership checks. Do not delete external or other-store blobs.
- The UI did not expose logo or offer image fields, so upload integration remains on product create/edit rather than adding new unrelated forms.
- The admin file limit matches the API's current maximum and Trial default: 5,242,880 bytes. The API remains authoritative if the runtime setting is lower.
