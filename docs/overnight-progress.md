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
- Group 3: the cart and Checkout query the current supermarket status by ID on entry. Closed and network failure have distinct messages; the cart remains visible and stored. Checkout rechecks immediately before order creation, and the API still rejects a closure inside the transaction before stock or order writes. A retry enables checkout after reopening.
- Group 4: Checkout invalidates stale quotes and automatically requotes after address, saved location, pin, or label changes. The client submits the delivery fee and total the customer saw; the API recalculates both inside the order transaction and returns `ORDER_PRICE_CHANGED` with the current quote before reserving stock if either differs. The customer reviews the updated amount and confirms in a separate action. Driver delivery views already read the saved order `totalMinor`.

## In progress

- Group 5: driver route display and foreground tracking lifecycle.

## Remaining

- Groups 5–9 and final verification.

## Checks, commits, and Actions

| Group | Focused checks | Commit | Actions run | Result |
| --- | --- | --- | --- | --- |
| 1 | Image upload tests 6/6; Admin typecheck passed; `git diff --check` passed | `e97369d6b72b5926b22a7b8fa8063fd3ccd7e776` | https://github.com/yshamasneh/H/actions/runs/35489471407 | Deployment and readiness passed |
| 2 | Mobile image UI 7/7, cart/checkout UI 8/8, cart storage 15/15, Admin image tests 6/6; Mobile/Admin typechecks and `git diff --check` passed | `e5c29bcfada1a06a9f61e652f17ccdd727ee5a93` | https://github.com/yshamasneh/H/actions/runs/35490180598 | Build, migration status, and image update passed; verification timed out before Azure reported the new container running. Repair pending. |
| Deploy repair 1 | Workflow YAML parsed and `git diff --check` passed | `c79b74d249fcab1908bb92a0d5f566bc577e6c7c` | https://github.com/yshamasneh/H/actions/runs/35490717780 | Run passed, but a concurrent manual stop/start left the site briefly stopped; a later explicit start restored stable readiness. |
| Deploy repair 2 | Workflow YAML parsed and `git diff --check` passed | `8e1f093f226f3223f698f94c2ff58de8d9602d76` | https://github.com/yshamasneh/H/actions/runs/35491336857 | Deployment passed; Azure image matched commit; readiness HTTP 200 and database connected. |
| 3 | API focused service tests 119/119; Mobile cart/Checkout UI 12/12; API/Mobile typechecks and `git diff --check` passed | `a7c044c4b42e09399d86ba3d68f23a0e3096d98b` | https://github.com/yshamasneh/H/actions/runs/35498874685 | Deployment passed; Trial readiness HTTP 200 and database connected. |
| 4 | API order/pricing tests 87/87 plus changed-product-price test 1/1; Mobile cart/Checkout UI 15/15; API/Mobile typechecks and `git diff --check` passed | Pending | Pending | Pending |

## New issues and decisions

- The existing admin uploader completes SAS → Blob PUT → publish, but product saving uses a helper that treats a successful write followed by a failed list refresh as a failed save. That can delete the new blob after the product already references it. Fix before release.
- Keep the current upload purpose/restaurant ownership checks. Do not delete external or other-store blobs.
- The UI did not expose logo or offer image fields, so upload integration remains on product create/edit rather than adding new unrelated forms.
- The admin file limit matches the API's current maximum and Trial default: 5,242,880 bytes. The API remains authoritative if the runtime setting is lower.
- The source image and both new tracked copies have SHA-256 `D793010543458AE231DD92A2E7C601203C9F2788C593CA6BA255E47E94F57E77`. Existing compressed assets were left untouched.
- Mobile UI tests cover square, wide, and tall image load events with `cover`/`contain` props; actual device visual inspection remains unverified.
- Local `node_modules` lacked Jest; `npm ci` restored it from the lockfile. The focused UI suite passes, though existing Icon tests print React `act(...)` warnings. The install reported 27 dependency advisories; dependency upgrades are outside this image task.
- Trial deployment verification used 18 image-status polls and timed out while App Service still reported the new image as `NeverStarted`. Increased the bounded wait to 48 polls and allowed image-setting propagation before restart; no data or Production resources changed.
- Azure's [deployment guidance](https://learn.microsoft.com/en-us/azure/app-service/deploy-best-practices) says changing the image property automatically restarts the app and pulls the new image. An immediate explicit restart can cancel that startup. Removed the redundant restart while retaining 48 bounded image-status polls and one readiness request after the new image is running. Current Trial readiness returned HTTP 200 with `ready` and `database: connected` on `c79b74d` after restoring the site.
- The new public supermarket status endpoint returns only `isOpenNow` for approved stores. The API's existing `RESTAURANT_CLOSED` error remains the final checkout guard. Existing carts are not modified when a store closes, an item becomes unavailable, or a network request fails.
- Local API generated Prisma client was stale after `npm ci`; `prisma generate` fixed typecheck without touching Trial. The first direct API test invocation was from the wrong directory and missed its decorator configuration; rerunning from `apps/api` passed.
- The API still owns distance, delivery fee, promotions, and saved order snapshots; client expected amounts are only a guard against a surprise charge. Existing driver screens use the saved order total for collection. `ORDER_PRICE_CHANGED` is additive and accepts older clients that omit expected amounts, while the updated Checkout always sends them.
