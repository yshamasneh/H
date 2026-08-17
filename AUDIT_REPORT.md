# تقرير فحص شامل — تطبيق التوصيل JOVO / `wasel`

| | |
|---|---|
| **المستودع / الفرع** | `yshamasneh/H` · `agent/phase-15-and-jovo-brand` |
| **تاريخ الفحص** | 2026-08-16 |
| **آخر commit** | `c2b5d9b` — Complete phase 15 catalogue and JOVO brand updates |
| **النطاق** | فحص شامل (بنية، أمان، منطق عمل، أداء، أخطاء، جودة، اختبارات، اعتماديات) + تركيز خاص على فيتشر "Coming Soon" للمطاعم |
| **المنهجية** | تحليل ساكن (قراءة كود) + **تشغيل فعلي للاختبارات** (وحدة + e2e ضد Postgres) + `npm audit` + `typecheck` |

---

## 0. ملخّص تنفيذي

الكود **ناضج وعالي الجودة بشكل لافت**: تحقّق مدخلات صارم، تعامل ذرّي مع التزامن (compare‑and‑swap في كل العمليات الحرجة)، RBAC بالصلاحيات، إخفاء الأخطاء بلا تسريب، وفهرسة قاعدة بيانات ممتازة. جميع الاختبارات تمرّ (229 اختبار).

**المشكلة المركزية الوحيدة الخطيرة هي بالضبط محور قلقك:** حاجز **"Coming Soon" للمطاعم مبني على الواجهة (UI) فقط**، والـ API الخاص بإنشاء الطلبات وقوائم المطاعم **مكشوف وشغّال بالكامل**. يمكن لعميل بتوكن صالح أن يطلب من مطعم حقيقي عبر `POST /api/v1/orders` متجاوزاً الحاجز.

### جدول النتائج حسب الأولوية

| المعرّف | الخطورة | العنوان | الملف الرئيسي |
|--------|---------|---------|---------------|
| **C‑1** | 🔴 Critical | حاجز "Coming Soon" غير مفروض على السيرفر — يمكن الطلب من المطاعم عبر الـ API | `orders/orders.service.ts:730` |
| **C‑2** | 🔴 Critical | Endpoints عامة للمطاعم مكشوفة بلا auth أثناء "Coming Soon" | `restaurants/restaurants.controller.ts:23` |
| **H‑1** | 🟠 High | الـ seed ينشئ أدمن ببيانات معروفة وبدون حماية إنتاج | `prisma/seed.ts:18` |
| **M‑1** | 🟡 Medium | حساب إيرادات المطعم يحمّل كل الطلبات للذاكرة (أداء) | `restaurants/restaurants.service.ts:406` |
| **M‑2** | 🟡 Medium | الخصم لا يُعاد حسابه بعد الموافقة على استبدال سوبرماركت | `orders/orders.service.ts:456` |
| **M‑3** | 🟡 Medium | تحذير `pg`: استعلامات متوازية على نفس اتصال المعاملة | ظهر وقت تشغيل الـ e2e |
| **M‑4** | 🟡 Medium | تسريب PII للسائقين قبل قبول التوصيل | `drivers/drivers.service.ts:108` |
| **M‑5** | 🟡 Medium | 27 ثغرة اعتماديات (غالبها tooling Expo، وواحدة dev‑only على السيرفر) | `apps/mobile`, `@nestjs/swagger` |
| **L‑1..6** | 🟢 Low | تحسينات جودة/متانة (تفاصيل أدناه) | — |

---

## 1. البنية العامة (Architecture)

Monorepo (`npm workspaces`) باسم `wasel`، ثلاث حزم:

- **`apps/api`** — NestJS 11 + Prisma 7.9 / PostgreSQL. معماري نظيف: كل دومين معزول في module/controller/service/dto (`auth`, `orders`, `restaurants`, `drivers`, `inventory`, `offers`, `notifications`, `admin`, `realtime`, `observability`).
- **`apps/admin`** — React + Vite (لوحة تحكّم الويب).
- **`apps/mobile`** — Expo 54 / React Native 0.81 / React 19 (تطبيق العميل/السائق/المطعم/الأدمن).

**الفصل بين السوبرماركت والمطاعم:** الاثنان يتشاركان نفس موديل `Restaurant` + `MenuItem`، مميّزين بحقل `businessType` (`RESTAURANT` / `SUPERMARKET`). قرار **ذكي وقابل للتوسّع** — نفس محرّك الكتالوج/الطلبات/المخزون يخدم القطاعين، وفتح المطاعم لاحقاً لا يتطلب دوماً جديداً.

**قابلية التوسّع:** جاهزة فعلياً — دومين المطاعم كامل وشغّال ومُختبَر. فتح الخدمة للعميل = إعادة ربط نقاط الدخول بالواجهة فقط.

**التكرار (duplication):** قليل ومُدار بوعي (مثال: `adminCreateBusiness` يفوّض لـ `register` بدل التكرار — `restaurants.service.ts:97`). التكرار الوحيد الملحوظ: دالة `requireOwnRestaurant` مكرّرة بين `orders.service.ts:717` و`restaurants.service.ts:147` → مرشّح توحيد (L‑5).

---

## 2. فيتشر "Coming Soon" للمطاعم (الفحص المُركّز)

**الخلاصة: القسم مخفي بالواجهة فقط، وليس معطّلاً. الـ API يقبل طلبات المطاعم بالكامل.**

### ما يتم بشكل صحيح (طبقة الواجهة)
- شاشة العميل تعرض بطاقة "قريباً" بدل المطاعم — `mobile/src/features/customer/home-screen.tsx:305‑312` (والتعليق التوثيقي `:50‑63`).
- دوال التنقل `goToRestaurants` / `goToRestaurantMenu` **ميتة فعلاً** — مستدعاة فقط داخل `navigation.ts:128‑146` والاختبار، ولا شاشة عميل تستدعيها (تم التحقق بالبحث الشامل). لا يوجد خطر crash من هذا الـ dead code.
- الواجهة تفلتر العروض لتُظهر عروض السوبرماركت/المنصّة فقط — `home-screen.tsx:124‑126`.

### الثغرات المكشوفة (طبقة الـ API لا تزال حيّة)

| Endpoint | Auth | الحالة |
|----------|------|--------|
| `POST /api/v1/orders` | CUSTOMER فقط | **يقبل طلباً من مطعم حقيقي** — لا فحص `businessType` |
| `POST /api/v1/orders/quote` | CUSTOMER فقط | يسعّر طلبات المطاعم |
| `GET /api/v1/restaurants` | **عام** | يسرد كل المطاعم المعتمدة والمفتوحة |
| `GET /api/v1/restaurants/:id/menu` | **عام** | يكشف قوائم الطعام كاملة |
| `GET /api/v1/restaurants/offers/active` | **عام** | يكشف عروض المطاعم |

### مسار الاستغلال
عميل بتوكن صالح → `GET /restaurants` (عام) → `GET /restaurants/:id/menu` (عام) → `POST /orders` بمعرّفات الأصناف → **طلب مطعم حقيقي يُنشأ**. الشرط الوحيد: وجود مطعم `APPROVED` + `isOpen=true` — وهو ممكن لأن بوّابة المطعم شغّالة بالكامل (تسجيل → موافقة أدمن → فتح متجر).

### دليل تجريبي (من الكود والاختبارات)
- `orders.service.ts:730‑736` (`calculateOrderQuote`) يفحص فقط: `status === APPROVED`، `isOpen`، وجود موقع. **لا فحص `businessType`**.
- الفحص الوحيد لـ `businessType` في مسار الطلب هو `orders.service.ts:241` (ميزة استبدال سوبرماركت) — وليس لمنع المطاعم.
- **`FakeOrdersPrisma.seedRestaurant()` الافتراضي `businessType: RESTAURANT`** (`orders/testing/fake-prisma.ts:536`)، ما يعني أن **اختبارات موجودة أصلاً تنشئ طلبات من نوع RESTAURANT وتنجح** — الثغرة مخبوزة في السلوك الحالي.

> راجع **C‑1** و**C‑2** أدناه للحل. أُضيف ملف اختبار توثيقي: `apps/api/src/orders/coming-soon-restaurant-gap.test.ts` (تفاصيل في القسم 11).

---

## 3. النتائج التفصيلية مرتّبة حسب الأولوية

### 🔴 Critical

#### C‑1 · حاجز "Coming Soon" غير مفروض على السيرفر
- **الملف/السطر:** `apps/api/src/orders/orders.service.ts:730‑736` (داخل `calculateOrderQuote`)؛ نقطة الدخول `orders/orders.controller.ts:14‑23`.
- **المشكلة:** إنشاء الطلب والتسعير لا يفحصان `businessType` إطلاقاً. النتيجة: طلبات لمطاعم "غير مُطلقة" تدخل النظام، مع مخاطر تشغيلية (طلبات لا يمكن تنفيذها) والتزامات دفع/COD.
- **الحل المقترح:** بوّابة صريحة في `calculateOrderQuote` بعد جلب `restaurant`، خلف مفتاح بيئة قابل للتحكّم:
  ```ts
  if (restaurant.businessType !== BusinessType.SUPERMARKET) {
    throw new ApiException(409, "RESTAURANT_ORDERING_DISABLED",
      "Restaurant ordering is not available yet.");
  }
  ```
  تُطبّق تلقائياً على `create` و`quote`. أضف `RESTAURANT_ORDERING_ENABLED` في `config/environment.ts` ليصبح إعادة الفتح تبديل قيمة. **يوجد اختبار `todo` جاهز** يؤكّد هذا السلوك (القسم 11).

#### C‑2 · Endpoints عامة للمطاعم مكشوفة بلا حاجة
- **الملف/السطر:** `apps/api/src/restaurants/restaurants.controller.ts:23‑45` (`list`, `getOne`, `getMenu`, `listOffers`) — بلا guard؛ `restaurants.service.ts:199‑211` (`listPublicRestaurants`).
- **المشكلة:** بيانات المطاعم/القوائم/العروض متاحة علناً رغم أن الخدمة "قريباً" — يناقض قرار العمل ويسرّب بيانات الشركاء قبل الإطلاق.
- **الحل المقترح:** خلف نفس مفتاح `RESTAURANT_ORDERING_ENABLED`، أرجِع 404/قائمة فارغة لمسارات المطاعم العامة (مع إبقاء مسارات السوبرماركت). بديل أدنى: اجعل `listPublicRestaurants` تُرجع فارغاً عند إغلاق الميزة.

### 🟠 High

#### H‑1 · الـ seed ينشئ أدمن ببيانات معروفة وبدون حماية إنتاج
- **الملف/السطر:** `apps/api/prisma/seed.ts:18` (كلمة `Test@12345`)، `:45‑63` (حساب `ADMIN` على `+970590000001`).
- **المشكلة:** لا يوجد حارس `NODE_ENV`، و`upsert` **يعيد تعيين كلمة السر** لقيمة معروفة كل تشغيل. تشغيل `npm run prisma:seed` بالخطأ على الإنتاج ينشئ/يعيد ضبط أدمن بصلاحيات كاملة بكلمة سر معروفة.
- **الحل المقترح:** في بداية `main()`:
  ```ts
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed in production");
  }
  ```

### 🟡 Medium

#### M‑1 · حساب إيرادات المطعم يحمّل كل الطلبات للذاكرة
- **الملف/السطر:** `apps/api/src/restaurants/restaurants.service.ts:406‑410`.
- **المشكلة:** `order.findMany({ status: DELIVERED })` ثم `reduce` في JS — يحمّل آلاف الصفوف لمطعم مزدحم.
- **الحل:** `prisma.order.aggregate({ _sum: { totalMinor: true }, where: { restaurantId, status: DELIVERED } })`.

#### M‑2 · الخصم لا يُعاد حسابه بعد الموافقة على استبدال سوبرماركت
- **الملف/السطر:** `apps/api/src/orders/orders.service.ts:456‑464` (مسار `APPROVED` في `decideFulfillmentAdjustment`).
- **المشكلة:** عند تغيّر `subtotalMinor` بسبب استبدال، تُعاد `totalMinor` باستخدام `order.discountMinor` القديم دون إعادة تشغيل منطق العروض (مثلاً `ORDER_PERCENTAGE` كان يجب أن يتغيّر مع المجموع). خطأ في حالات حافّة.
- **الحل:** أعد تشغيل `calculatePromotionDiscounts` على العناصر المعدّلة داخل نفس المعاملة، أو وثّق أن الخصم مجمّد وقت الإنشاء.

#### M‑3 · تحذير `pg`: استعلامات متوازية على نفس اتصال المعاملة
- **المصدر:** ظهر أثناء تشغيل الـ e2e:
  > `pg` DeprecationWarning: Calling client.query() when the client is already executing a query
- **المشكلة:** استعلامات متوازية (`Promise.all`) على اتصال معاملة Prisma المثبّت الذي لا يشغّل استعلامين معاً. سيصير **خطأً** في `pg@9.0`.
- **الحل:** ابحث عن `Promise.all` داخل `$transaction` واجعل الاستعلامات متسلسلة داخل المعاملة.

#### M‑4 · تسريب PII للسائقين قبل قبول التوصيل
- **الملف/السطر:** `apps/api/src/drivers/drivers.service.ts:108‑115` (`listAvailableDeliveries`).
- **المشكلة:** كل سائق يرى عنوان العميل + المبلغ لكل التوصيلات المعلّقة (غير المُسندة). شائع في تطبيقات التوصيل لكنه تعريض للبيانات.
- **الحل:** أخفِ العنوان الدقيق حتى القبول (اعرض المنطقة/المسافة فقط)، واكشف العنوان الكامل بعد الإسناد.

#### M‑5 · ثغرات الاعتماديات (`npm audit`)
- **الإجمالي:** 27 ثغرة (14 high، 13 moderate) — بيانات فعلية من `npm audit`.
- **السياق المهم:** ~23 منها في **أدوات بناء/تطوير Expo/React Native** (`metro`, `@expo/cli`, `@expo/config`, `expo-dev-client`, `expo-dev-launcher`, `xcode`, `@expo/ngrok`) — **ليست كوداً يُشحن للمستخدم**.
- **على السيرفر (API): ثغرة واحدة فقط** — `@nestjs/swagger → js-yaml` (high)، وهي **dev‑only** لأن Swagger معطّل بالإنتاج (`main.ts:67` خلف `if (!isProduction)`). فالـ runtime الإنتاجي للسيرفر نظيف عملياً.
- **الحل:** `npm audit fix` لغير الكاسر؛ ترقية Expo SDK لاحقاً تغطّي الباقي. (التفصيل الكامل في القسم 9.)

### 🟢 Low
- **L‑1 · N+1 بسيط في الإشعارات:** `notifications/notification.util.ts:61‑68` تنشئ صفاً لكل عضو بـ awaits متتالية. محصور بعدد الأعضاء (صغير) — يمكن تحويله لـ `createMany`.
- **L‑2 · رسوم التوصيل بمسافة الخط المستقيم:** `orders/pricing.ts:27‑50` (haversine) تُقدّر أقل من المسار الحقيقي. قرار عمل — يُوثّق.
- **L‑3 · Leaflet من CDN بلا SRI:** `mobile/src/components/location-map.web.tsx:64‑69` تحمّل JS/CSS من `unpkg.com` — اعتبار supply‑chain لبناء الويب. أضف `integrity` أو استضافة ذاتية.
- **L‑4 · توكنات الويب في `sessionStorage`:** `mobile/src/core/session.ts:46‑52` (الموبايل يستخدم SecureStore المشفّر — ممتاز؛ الويب معرّض لـ XSS). مقبول، يُراجع مع سياسة CSP.
- **L‑5 · تكرار `requireOwnRestaurant`** بين `orders.service.ts:717` و`restaurants.service.ts:147` — وحّدها في util مشترك.
- **L‑6 · لا قفل حساب بعد محاولات فاشلة** — الاعتماد على throttling (login 10/دقيقة، `auth/auth.controller.ts:34‑35`) + argon2. كافٍ عملياً؛ قفل تصاعدي لكل رقم يضيف طبقة.

---

## 4–9. تغطية المحاور المطلوبة (مع نقاط القوة المُتحقّق منها)

| المحور | التقييم | الدليل |
|--------|---------|--------|
| **3. الأمان — التحقق من المدخلات** | ✅ ممتاز | `ValidationPipe` عام مع `whitelist` + `forbidNonWhitelisted` (`main.ts:50‑64`)؛ حدود UUID/كمية(1‑50)/إحداثيات/أطوال نصوص (`orders/orders.dto.ts`)؛ helmet؛ CORS مُقيّد HTTPS بالإنتاج؛ secrets ≥32 حرف ومنع placeholders (`config/environment.ts`). |
| **3. الأمان — Auth/IDOR** | ✅ قوي | `JwtAuthGuard` يتحقق من الجلسة بقاعدة البيانات + `tokenVersion` + `isActive` + `phoneVerifiedAt` (`auth/jwt-auth.guard.ts`). كل مسار عميل يفحص الملكية (`order.customerId !== customerId`)، المطعم يفحص `restaurantId`، السائق يفحص `driverId` (`drivers.service.ts:201`). RBAC بالصلاحيات (`PermissionsGuard` + `@RequirePermission`). لا SQL injection (Prisma بارامتري). |
| **4. منطق العمل — التسعير/الخصومات** | ✅ سليم | المال `Int` (minor units، لا floats). الخصم محصور بشكل صحيح (`offers/offers.service.ts:170‑175`): merchandise ≤ subtotal، delivery ≤ deliveryFee ⇒ لا total سالب. **لا ضريبة إطلاقاً** (قرار منتج مقصود — `pricing.ts:10`). راجع M‑2 لحالة حافّة. |
| **4. منطق العمل — المخزون/Race conditions** | ✅ ممتاز | كل العمليات الحرجة **compare‑and‑swap ذرّي**: خصم المخزون `stockQuantity: { gte }` (`orders.service.ts:847‑851`)؛ انتقالات الطلب بحارس الحالة (`:521‑532`)؛ قبض التوصيل بحارس `driverId: null` (`drivers.service.ts:154‑158`). **آخر قطعة لا تُباع مرتين.** |
| **4. حالات الطلب** | ✅ محكم | آلة حالات صريحة (`orders/order.rules.ts`)، الحالات النهائية بلا انتقال، إلغاء العميل فقط أثناء `PLACED`. |
| **5. الأداء** | ✅ جيد (باستثناء M‑1) | فهرسة مركّبة شاملة على الأعمدة الصحيحة (`prisma/schema.prisma`: `@@index([businessType, status, isOpen])`، `[restaurantId, status, createdAt]`، ...). لا N+1 كبير. راجع M‑1. |
| **6. معالجة الأخطاء** | ✅ ممتاز | `common/all-exceptions.filter.ts:70‑76` يُرجع رسالة عامة **بلا أي stack trace**؛ التفاصيل تُسجّل بالسيرفر فقط مع `requestId`؛ 500 فقط تُبلّغ للـ error reporter. Logging منظّم (`observability/structured-logger.ts`). |
| **7. جودة الكود** | ✅ عالية | تسمية ثابتة، تعليقات "لماذا" غنية، `typecheck` نظيف عبر الحزم الثلاث. لا TODOs مقلقة متروكة. |
| **8. الاختبارات** | ✅ قوية | 22 ملف (وحدة + تكامل e2e). **دومين المطاعم مغطّى** رغم "Coming Soon" (`restaurants.service.test.ts`, `menu.service.test.ts`) — جاهز للإطلاق. الفجوة الوحيدة: لا اختبار يؤكّد منع طلبات المطاعم (لأنه غير مفروض — C‑1). |
| **9. الاعتماديات** | 🟡 يُراجع | حديثة كلياً (NestJS 11، Prisma 7.9، Express 5، argon2، helmet 8، Expo 54/React 19). 27 ثغرة audit غالبها tooling — راجع M‑5 والقسم 9. |

---

## 9. تفصيل ثغرات الاعتماديات (`npm audit`)

**High (14):** `@expo/cli`, `@expo/metro`, `@expo/metro-config`, **`@nestjs/swagger → js-yaml`** (الوحيدة على السيرفر، dev‑only), `@react-native/community-cli-plugin`, `expo`, `image-size` (DoS), `js-yaml` (CVE‑2026‑59870 — quadratic CPU), `metro`, `metro-config`, `metro-transform-worker`, `nanoid`, `postcss` (XSS في CSS stringify), `react-native`.

**Moderate (13):** `@expo/config`, `@expo/config-plugins`, `@expo/ngrok → uuid`, `@expo/prebuild-config`, `expo-asset`, `expo-constants`, `expo-dev-client`, `expo-dev-launcher`, `expo-manifests`, `expo-notifications`, `expo-splash-screen`, `uuid` (bounds check), `xcode`.

**التقييم:** لا ثغرة runtime على السيرفر الإنتاجي. غالبية الثغرات في سلسلة أدوات Expo/Metro (وقت البناء/التطوير). الأولوية: `npm audit fix` ثم تخطيط ترقية Expo SDK.

---

## 10. نتائج تشغيل الاختبارات (فعلي)

تم تنفيذ الإعداد الكامل: `npm install` → `prisma generate` → رفع Postgres عبر Docker (قاعدة معزولة `tasawaq_test`) → تشغيل كل المجموعات.

| المجموعة | الأمر | النتيجة |
|----------|-------|---------|
| اختبارات وحدة — API | `npm test -w @wasel/api` | **206 ✅ / 0 ❌** · 1 skipped (e2e مشروط) · 1 todo (C‑1) |
| اختبارات وحدة — Mobile | `npm test -w @wasel/mobile` | **25 ✅ / 0 ❌** |
| تكامل e2e (Postgres حقيقي) | `npm run test:e2e` | **1 ✅ / 0 ❌** — دورة حياة كاملة (توصيل + بقالة + مجاميع نقدية + مخزون) |
| فحص الأنواع | `npm run typecheck` | ✅ نظيف (admin/api/mobile) |

**الإجمالي: 232 اختبار مُنفّذ — 232 ناجح، 0 فشل** (منها 3 اختبارات جديدة أضافها الفحص + 1 todo لتوثيق C‑1).

---

## 11. ما أضافه الفحص (اختبارات فقط — لا تعديل على كود التطبيق)

**ملف جديد:** `apps/api/src/orders/coming-soon-restaurant-gap.test.ts`

يوثّق ثغرة C‑1 تجريبياً بدون لمس كود التطبيق:
1. `characterises C-1: a customer can place an order at a RESTAURANT-type business` — **ينجح اليوم** ⇒ يثبت الثغرة.
2. `characterises C-1: /orders/quote also prices a RESTAURANT-type business` — **ينجح اليوم**.
3. `C-1 fix (todo): … should be rejected` — اختبار `todo` يصف السلوك المطلوب (رفض بكود `RESTAURANT_ORDERING_DISABLED`)؛ **جاهز كـ regression** يبدأ الحماية فور إضافة البوّابة.
4. `control: a SUPERMARKET-type business remains orderable` — يضمن ألا يكسر الإصلاح المستقبلي القطاع الحيّ.

---

## 12. التوصيات (بالترتيب)

1. **أغلق C‑1 و C‑2 خلف مفتاح `RESTAURANT_ORDERING_ENABLED` واحد** + فعّل اختبار الـ `todo` — يحوّل "Coming Soon" من وعد واجهة إلى ضمان سيرفر، وإعادة الفتح تصبح تبديل قيمة.
2. **أضف حارس إنتاج للـ seed (H‑1)** فوراً.
3. عالج M‑1 (أداء الإيرادات)، M‑2 (دقة الخصم)، M‑3 (تحذير `pg`) قبل توسّع الحجم.
4. `npm audit fix` لغير الكاسر (M‑5)، وخطّط ترقية Expo SDK.
5. الباقي (🟢) تحسينات تُجدول لاحقاً.

---

## 13. ملاحظات بيئة الفحص (للشفافية)

- أُنشئ ملف `.env` في الجذر (لم يكن موجوداً) بأسرار تطوير عشوائية، و`DATABASE_URL` يشير لقاعدة معزولة `tasawaq_test` — **لم تُلمس قاعدة `tasawaq` الأصلية**.
- شُغّل Docker Desktop وأُنشئت قاعدة `tasawaq_test` وطُبّقت عليها الـ migrations فقط.
- **لم يُعدّل أي كود تطبيقي**؛ الإضافة الوحيدة هي ملف الاختبار في القسم 11 وهذا التقرير.

*انتهى التقرير.*
