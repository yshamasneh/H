# JOVO — متطلبات: صلاحيات الأدمن، Landmarks، والموقع (Location)

**السياق:** JOVO (React Native/Expo + NestJS API + Vite super-admin panel). الإطلاق الأول (JOVO MARKET) سوبرماركت بس، بدون مطاعم — الفيتشرز المتعلقة بالمطاعم هون هي تحضير/بنية تحتية بس، مش جزء من هاد الإطلاق.

الوثيقة دي مقسّمة لأولويات (P1 → P5)، كل فيتشر إلها وصف عربي + نقاط لازم تتأكد منها + برومبت جاهز بالإنجليزي تحطه مباشرة لـ Claude Code CLI.

---

## P1 — تأكيد/تثبيت آلية موافقة الأدمن على حسابات المطاعم الجديدة

**المطلوب:** التأكد إذا كان إنشاء حساب مطعم جديد بيظهر طوالي لليوزر، أو لازم موافقة الأدمن الأول. إذا ما في gate حالياً، لازم يتضاف.

**نقاط لازم تتأكد منها بعد الفحص:**
- هل في حقل status (زي `pending` / `approved` / `rejected`) على entity المطعم (والسوبرماركت كمان، للتناسق)؟
- إذا موجود، هل الـ API endpoints يلي بترجع المطاعم لليوزر (`GET /restaurants` أو المكافئ) بتفلتر على `approved` بس؟
- هل في شاشة بالـ super-admin panel لمراجعة/موافقة/رفض الحسابات الجديدة الـ pending؟
- هل صاحب المطعم بياخد إشعار (notification) لما الأدمن يوافق أو يرفض؟

```
Audit and fix the restaurant onboarding approval flow in the JOVO codebase.

1. Investigate: when a new restaurant account is created (registration flow — API + DB schema), does it become visible to customers immediately, or is there an approval gate? Trace the full path: restaurant entity/schema, the creation endpoint, and the customer-facing listing endpoint(s) that fetch restaurants (and supermarkets, for consistency).

2. Report back clearly what the CURRENT behavior is before making changes.

3. If there is no approval gate: add a `status` field to the restaurant (and supermarket, for parity) entity with values `pending | approved | rejected`, defaulting new accounts to `pending`. Update all customer-facing queries/endpoints that list restaurants/supermarkets to filter to `approved` only. Add an admin panel screen (or extend an existing one) in the Vite super-admin panel to list pending accounts and approve/reject them, with a reason field for rejection. Notify the restaurant/supermarket owner (in-app notification, matching however other status-change notifications are already sent in this codebase) when their account is approved or rejected.

4. If an approval gate already exists, just confirm it explicitly and note any gaps (e.g. supermarkets missing the same gate, or the admin screen missing reject reasons).

Keep changes consistent with existing patterns in the codebase (naming, folder structure, admin panel component style). Add/adjust tests for the new filtering logic and the admin approve/reject endpoints.
```

---

## P2 — موقع (Location) للسوبرماركت والمطعم + تحكم الأدمن بإظهاره

**الوضع الحالي:** الموقع بيظهر بس وقت التوصيل (Order Tracking)، أثناء تتبع الطلب.

**المطلوب:**
- إضافة حقل موقع (lat/lng + عنوان، مع UI لاختيار الموقع على الخريطة — زي شاشة الـ landmarks الموجودة) لكل سوبرماركت ومطعم، مش بس للدليفري.
- من الـ admin panel، لكل سوبرماركت/مطعم على حدا (independent toggle)، الأدمن يقدر يفعّل أو يعطّل إظهار الموقع لليوزر (مو إعداد عام واحد لكل التطبيق — قرار لكل متجر لحاله).
- لو الموقع معطّل لمتجر معيّن، اليوزر ما بشوفه أبداً بغض النظر عن حالة الطلب (لازم يتأكد هل هادا بيأثر أو لأ على موقع التتبع وقت التوصيل الفعلي، أو هادول شغلتين منفصلتين).

```
Add store location management to the JOVO codebase.

1. Extend the restaurant and supermarket entities/schema with a location field (lat/lng + address string), reusing the existing map-picker UI pattern already built for the public landmarks admin CRUD screen if one exists.

2. Add a per-store boolean flag, e.g. `showLocationToCustomer` (default false, or whatever the team decides as sensible default — flag this as an open decision), independently settable per restaurant/supermarket from the super-admin panel — NOT a single global toggle. Each store's flag is controlled separately.

3. On the customer-facing app, expose the store's location (e.g. on the store detail page, and optionally a "get directions" action) only when that store's `showLocationToCustomer` flag is true.

4. Clarify and preserve the existing behavior: the current delivery-tracking flow (showing location during an active order) is presumably a *separate* concern — the customer's live driver-tracking map — from this new "show the store's static location on its profile page" feature. Confirm this codebase separation exists, and make sure this new toggle does NOT interfere with delivery/order tracking, which should keep working as before regardless of this flag.

5. Add an admin UI control (a toggle per store, in the store edit/detail screen in the super-admin panel) to flip this flag.

Add tests covering: the flag defaulting correctly on new store creation, the customer API respecting the flag, and that delivery tracking is unaffected by the flag's value.
```

---

## P3 — صلاحيات أدمن كاملة (Full CRUD) على منتجات السوبرماركت والمطاعم

**المطلوب:** الأدمن يقدر يضيف/يعدّل/يحذف/يشوف منتجات أي سوبرماركت وأي مطعم من الـ super-admin panel — مو بس صاحب المتجر.

**سؤال مفتوح لازم تحدده قبل ما تعطي البرومبت:** "full access بكل اشي" — هل قصدك منتجات بس (زي ما وضحت بالأمثلة)، ولا كمان طلبات/يوزرز/دليفري accounts؟ البرومبت تحت مبني على "منتجات" بس متل ما وضحت بالأمثلة. إذا بدك أوسع، وسّع البرومبت.

```
Add full admin CRUD access over products for both restaurants and supermarkets in the JOVO super-admin panel.

1. Audit current admin permissions: can an admin currently view/add/edit/delete products belonging to any restaurant/supermarket, or is product management currently restricted to the store owner only? Report the current state first.

2. If restricted: add admin-level endpoints (or extend existing owner-scoped endpoints with an admin bypass, following whatever RBAC/permission pattern already exists in the NestJS API — e.g. an `isAdmin` guard) so an admin can list, create, edit, and delete products for ANY store, not just their own.

3. Add the corresponding UI in the super-admin panel: a way to browse stores, drill into a store's product catalog, and perform full CRUD there — reusing the store owner's existing product-management UI components where practical rather than duplicating them.

4. Make sure permission checks are enforced server-side (not just hidden in the UI) — a non-admin hitting these endpoints for a store they don't own should still be rejected.

Add tests for the new admin-scoped endpoints, including a negative test confirming non-admins still can't touch other stores' products.
```

---

## P4 — إظهار الـ Landmarks لحساب الدليفري

**الوضع الحالي (حسب آخر معرفة عندي):** فيتشر الـ public landmarks متكامل مع شاشة admin CRUD وخريطة satellite لتحديد مكانها، بس حساب الدليفري (driver app) مش شايفهم حالياً.

```
Expose the existing public landmarks feature on the driver app's map view.

1. Locate the existing landmarks data model, admin CRUD screen, and marker rendering logic (brand-orange flag+label icon, rendered only past a set zoom threshold) that were already implemented for the public-facing map.

2. Confirm why the driver app's map does not currently render these landmarks — likely the driver map view simply isn't fetching/rendering the landmarks layer that the customer map already uses.

3. Wire the same landmarks data + marker rendering into the driver app's active-delivery map view (the one already showing the driver's own position, pickup store, and customer destination), reusing the existing rendering logic/component rather than reimplementing it.

4. Verify this works across the driver app's map (native + web/PWA if applicable), respecting the existing zoom threshold behavior.
```

---

## P5 — فحص جاهزية التطبيق كامل للنشر (Launch Readiness Audit)

**المطلوب:** تقييم شامل: هل التطبيق جاهز للنشر (لإطلاق JOVO MARKET — سوبرماركت بس) ولا لسا في نواقص.

```
Run a launch-readiness audit of the JOVO app for the JOVO MARKET (supermarket-only) launch scope.

Check and report status (Ready / Needs work / Blocked) for each:
1. Core customer flow: browse supermarket → add to cart → checkout → payment → order placed, end to end, no console/runtime errors.
2. Driver flow: receive order → pickup → live tracking → delivery confirmation.
3. Admin panel: store management, order oversight, and (if implemented per the requirements above) the account-approval and product-CRUD flows.
4. Auth: signup/login/logout/password-reset for customer, driver, and store-owner roles.
5. Notifications (push/in-app) firing correctly for order status changes.
6. Payment integration (if any) working against a real or sandbox provider, not just mocked.
7. Environment/config: production env vars set correctly on Azure App Service, DB migrations applied to production Postgres, no leftover dev/test config or secrets committed to the repo.
8. Outstanding test failures or known bugs from the most recent QA pass — list anything still open from the "Go with fixes" QA verdict and the M-1..M-8 fix sequence, and confirm which of those are actually done vs still pending.
9. Basic load handling: has any load/stress testing (k6/JMeter/Artillery) actually been run, or is it still just planned?
10. Dark mode completeness: confirmed done for customer/shared screens, still pending for driver/restaurant/admin — flag this explicitly as a known gap if not addressed since.
11. App branding: still "TasawaQ" vs "Jovo" rename — confirm this is intentionally deferred and won't cause a broken/inconsistent user-facing experience at launch (mixed branding visible to users would be a blocker; deferred internal-only naming is not).

Produce a prioritized punch list: what's a hard blocker for launch vs what can ship as a known gap and be fixed post-launch.
```

---

## ملاحظات عامة

- كل البرومبتات فوق مبنية على افتراض إنه في نمط موجود بالكود (RBAC، map components، إلخ) وبتطلب من الـ agent يعيد استخدامه — إذا ما كان موجود، الـ agent المفروض يبلغك قبل ما يبني شي من الصفر بطريقة مختلفة عن باقي الكودبيس.
- رتبتهم حسب أولوية مقترحة (P1 لأنه بيأثر عالأمان/السلوك الحالي فوراً، P5 آخر شي كمراجعة نهائية) — بس رتبهم إنت حسب اللي بدك تشتغل عليه أول.
- لو "full access بكل اشي" يلي قصدته بالأدمن أوسع من المنتجات (زي طلبات، يوزرز، حسابات دليفري)، خبرني/وسّع P3 قبل ما تشغله.
