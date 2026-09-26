# JOVO — مراجعة الجاهزية التقنية الشاملة للإنتاج

> تاريخ المراجعة: 2026-09-17 (Asia/Jerusalem)  
> المستودع: `https://github.com/yshamasneh/H.git`  
> الفرع الحصري: `agent/phase-15-and-jovo-brand`  
> commit المفحوص: `cc939c4a881f50fcba678249bbc2cd038111abbb`  
> منهج الإثبات: قراءة التنفيذ الفعلي، مطابقة المتطلبات والتقارير السابقة، وتشغيل فحوص لا تغيّر كود المشروع. لم يُنفّذ commit أو push أو تعديل Git أو إصلاح كود. الملف الوحيد الذي أُنشئ هو هذا التقرير.

## 1. Executive Summary

JOVO منصة توصيل محلية متعددة الأدوار، وإطلاقها الحالي موجّه إلى **JOVO MARKET / السوبرماركت** مع إبقاء طلبات المطاعم خلف feature flag. المستودع monorepo يضم API بـ NestJS/Prisma/PostgreSQL، تطبيق Expo/React Native يخدم العميل والسائق والمتجر وإدارة داخل التطبيق، ولوحة إدارة Vite منفصلة. دورة الطلب الأساسية، التسعير، حجز المخزون، حالات التجهيز والتوصيل، RBAC، تدوير refresh tokens، والتدقيق المالي أصبحت أعمق بكثير مما تصفه بعض التقارير القديمة. فحوص TypeScript والاختبارات المتاحة نجحت: **470 اختبارًا ناجحًا، 3 اختبارات قاعدة بيانات متخطاة، وصفر فشل**.

مع ذلك، لا توجد حاليًا أدلة كافية لإطلاق Production. بوابات الإصدار غير مكتملة: `expo-doctor` يفشل، لا توجد نتيجة build فعلية لنسخ Android/iOS أو Docker في بيئة المراجعة، اختبارات PostgreSQL الحقيقية لم تعمل، ولا توجد معاينة فعلية لـ production secrets/TLS/DNS/migrations/backup restore. نظام Push موجود من الطرفين لكنه لا يفصل token عند logout، لا يعالج الضغط على الإشعار أو cold start، ولا يملك receipts/retry/outbox؛ وهذا يخلق خطر وصول إشعارات حساب سابق إلى مستخدم لاحق على الجهاز نفسه. كذلك فشل رفض متجر من واجهة الإدارة داخل الهاتف، وتوجد تعارضات ظاهرة في علامة TasawaQ/JOVO ووثائق المتجر والخصوصية.

ملخص النتائج المصنفة: **3 Blocker، 2 Critical، 10 High، 13 Medium، 4 Low**. نجاح unit tests لا يلغي بوابات التشغيل اليدوية والخارجية الواردة أدناه.

## 2. Final Verdict

**NO-GO**

## 3. Release Readiness Score من 100

**54 / 100**

التوزيع المستخدم: الوظائف الأساسية 16/20، Backend/DB 14/20، الأمن والخصوصية 10/20، Mobile/release 6/15، Push 3/10، الاختبارات 3/7، DevOps/observability 2/8. هذه نتيجة جاهزية للإطلاق وليست نسبة اكتمال features فقط.

## 4. القرار الواضح

`NO-GO`

## 5. شرح سبب القرار

القرار سببه وجود أعطال مثبتة تمس حدود الحسابات والإشعارات، وفشل أداة صحة Expo، واعتماد التسجيل/الاستعادة على مزود OTP لم يُختبر إنتاجيًا، مع عدم تنفيذ migration/E2E/release builds/restore drill. يجب إغلاق P0 وإعادة تشغيل كامل بوابة الإصدار على بيئة staging مماثلة للإنتاج، ثم يمكن إعادة تقييم القرار. لا يكفي تحويل القرار إلى CONDITIONAL GO بوعد تنفيذ الاختبارات بعد النشر؛ بعض الاختبارات نفسها قد تكشف فشل boot أو build أو signing.

## 6. Project Architecture Summary

- `apps/api`: NestJS 11، TypeScript، Prisma 7، PostgreSQL 17، REST تحت `/api/v1` وSocket.IO. توجد طبقات controllers/services/DTOs، ValidationPipe عالمي، Helmet، CORS، throttling، structured logging، health/readiness وPrometheus-style metrics.
- `apps/mobile`: Expo SDK 54 / React Native 0.81 / React 19. تطبيق واحد متعدد الأدوار يعمل native وweb، ويضم تجربة العميل والمتجر والسائق وإدارة داخل التطبيق. الاتصال REST عبر `EXPO_PUBLIC_API_URL` وSocket.IO بالـ access JWT.
- `apps/admin`: React 19 + Vite، لوحة platform/business منفصلة تتصل عبر `VITE_API_URL`. المصادقة مخزنة في `sessionStorage` وتدعم refresh.
- البيانات: schema مركزي في `apps/api/prisma/schema.prisma` مع 27 migration. نماذج أساسية: User/AuthSession/OTP، Restaurant/BusinessMember، Menu/Inventory، Order/OrderItem/History، Delivery، PushToken/Notification، offers، accounting/audit.
- المصادقة: هاتف + OTP للعميل، Argon2id لكلمات السر، access JWT قصير وrefresh session دوّار مخزن hash في DB، مع فحص `isActive` و`phoneVerifiedAt` و`tokenVersion` والجلسة في HTTP/WebSocket. native يستخدم SecureStore، والويب يستخدم sessionStorage.
- الصلاحيات: أدوار CUSTOMER/RESTAURANT/DRIVER/ADMIN؛ الإدارة تعتمد platform permissions، والمتجر يعتمد BusinessMember roles/permissions. الـ API هو الحد الأمني النهائي حتى عند إخفاء أزرار الواجهة.
- الخدمات الخارجية: OTP webhook، Expo Push، error-tracking webhook، EAS Update/build credentials، ArcGIS raster tiles، PostgreSQL خارجي. لا توجد بوابة دفع؛ الدفع Cash on Delivery فقط. لا يوجد routing provider.
- البناء والنشر المتوقع: npm workspaces ثم Prisma migrate deploy، Docker multi-stage للـ API، Nginx للويب ولوحة الإدارة، TLS secrets mounts، وEAS profiles للهواتف. `docker-compose.production.yml` يفترض PostgreSQL خارجيًا وخدمة migration one-shot ثم API/web/admin.
- توجد مفارقة معمارية: README يصف `apps/admin` بأنه legacy وأن إدارة Expo هي المدعومة، بينما `docs/architecture.md` وCompose ينشران لوحة Vite أيضًا. يجب اختيار سطح الإدارة الرسمي قبل الإصدار.

## 7. User Roles and Main Flows

### الأدوار

- العميل: التسجيل والتحقق بالهاتف، التصفح، السلة، الموقع والعنوان، quote، الطلب، المتابعة والإلغاء ضمن القيود.
- مالك/موظف المتجر: التسجيل ثم موافقة الإدارة، إدارة الملف/المنتجات/المخزون/الساعات والموظفين، معالجة الطلب وتعديلات fulfillment.
- السائق: التسجيل ثم الموافقة، online/offline، claim delivery، pickup/on-the-way/delivered/failed، الأرباح.
- مدير المنصة: موافقات وتعليق المتاجر والسائقين، المستخدمون والأدوار، الطلبات، المواقع والمعالم، العروض، المحاسبة، الإعدادات وAuditLog.

### رحلة الطلب الكاملة

1. العميل يختار منتجات متجر واحد، عنوانًا وإحداثيات، ويطلب quote من API.
2. `POST /orders` يمرر idempotency key؛ داخل transaction يعاد احتساب الأسعار والرسوم والعروض، تُحجز الكميات وتُلتقط snapshots وتُنشأ الحالة `PENDING` وسجل الحالة.
3. بعد commit تُرسل إشارة إشعار للمتجر. هذه النقطة ليست durable حاليًا؛ فشلها لا يعيد الطلب إلى transaction.
4. المتجر يقبل/يرفض؛ عند تعديلات availability/substitution يعاد احتساب effective total/cost. ثم `PREPARING` → `READY_FOR_PICKUP`.
5. ينشأ Delivery؛ سائق approved+online يطالب به باستخدام conditional update لمنع claim مزدوج، ثم `PICKED_UP` → `ON_THE_WAY` → `DELIVERED`، وتُثبت قيود accounting ضمن transaction.
6. الإلغاء/الفشل يلتزمان transition rules ويعيدان المخزون وفق الحالة. الإشعارات DB + socket + push تُرسل للمستلم حسب الحدث.

أدلة: `apps/api/src/orders/orders.service.ts:66-164,594-668`، `apps/api/src/drivers/drivers.service.ts:188-248`، `apps/api/prisma/schema.prisma`، واختبارات transition/idempotency/accounting الناجحة.

## 8. Validation Commands Executed

| الأمر | النتيجة | ملاحظة صادقة |
|---|---|---|
| `git remote -v`; `git branch --show-current`; `git status --short --branch`; `git log -1` | Pass | origin والفرع والـ commit مطابقون؛ الحالة كانت clean قبل التقرير. |
| البحث عن `AGENTS.md` وقراءة README/تعليمات المشروع | Pass | لا يوجد `AGENTS.md`؛ قُرئ README ووثائق الجذر وREADME لاختبارات الحمل. |
| `npm.cmd run typecheck` | Pass | نجح في admin/api/mobile. |
| `npm.cmd run lint` | Pass with limitation | السكربتات تنفذ `tsc --noEmit` فقط؛ لا يوجد ESLint أو formatter check. |
| `npm.cmd test` | Pass | 470 pass، 3 DB-gated skipped، 0 fail؛ تحذيرات React `act(...)` في UI tests. |
| `npm.cmd run prisma:validate` | Pass | Prisma schema صالح. |
| `npx --yes expo-doctor@latest apps/mobile` | Fail | 15/17 checks؛ config schema ونسختا Expo غير متطابقتين. |
| Expo config introspection | Pass with caveat | identifiers/permissions حُلّت؛ iOS entitlement ظهر `aps-environment=development` في introspection. |
| `npm.cmd audit --workspaces --include-workspace-root --omit=dev --json` | Fail | 37 advisory: 23 high و14 moderate و0 critical. |
| `npm.cmd outdated --workspaces --include-workspace-root --long` | Findings | توجد patch/minor updates وmajor upgrades؛ لم تُغيّر dependencies. |
| Docker availability / Compose path | Blocked | Docker Desktop Linux engine غير متاح في بيئة المراجعة. |
| `npm run test:e2e` | Not run | يحتاج PostgreSQL/Docker ويشغّل build مولدًا للـ `dist`؛ 3 اختبارات DB بقيت skipped. |
| builds الفعلية وEAS native build | Not run | البناء يكتب artifacts خارج الملف المسموح؛ ولم تتوفر credentials/Apple/Google. typecheck ليس بديلًا عن build. |
| `npm install` | Not run | `node_modules` موجود؛ install يغيّر lock/dependency state، وهو خارج السماح بهذه المرحلة. |

## 9. Build/Test/Lint/Typecheck Results

- TypeScript: ناجح لجميع workspaces.
- Tests: admin 3/3، API 378 pass + 3 skipped، mobile Node 72/72، mobile Jest UI 17/17 في 6 suites؛ المجموع 470 pass و3 skipped.
- Coverage: لا يوجد threshold أو تقرير coverage مركزي؛ عدد الاختبارات لا يثبت تغطية المسارات الإنتاجية.
- Lint/format: لا توجد أداة static lint حقيقية أو formatting gate. لذلك النتيجة تعني type safety فقط.
- Builds: غير مثبتة؛ لم يُشغّل Vite build أو Expo export أو Nest build أو Docker build أو EAS build بسبب قيد عدم إنشاء artifacts وعدم توفر Docker/credentials.
- Load tests السابقة موثقة بتاريخ 2026-09-12: baseline catalog قرابة 400 req/s وorders قرابة 100 req/s مع 0% أخطاء، mixed workload قرابة 0.10% أخطاء عميل. هي نتيجة مفيدة لعملية واحدة وليست إثبات production scaling.
- فحص `TODO/FIXME/HACK` وmock/dev URLs لم يكشف TODO تنفيذيًا يمنع الإصدار؛ localhost/Android-emulator fallbacks محصورة في development ويمنع عميل الإنتاج URL غير HTTPS. لا توجد أداة `depcheck` أو ما يماثلها، لذلك لا يمكن الجزم بعدم وجود dependency غير مستخدمة؛ `npm outdated` وفحص imports اليدوي هما الدليل المتاح.

## 10. Deployment Blockers

| ID | Severity | Area | المشكلة والأثر | الدليل | إعادة التحقق | المطلوب | Effort | يمنع النشر | Manual | Confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| JOVO-B01 | Blocker | Production | لا توجد عملية staging موثقة نجحت فيها boot + migrations + TLS/DNS + smoke + backup/restore؛ Docker غير متاح ولم توجد `.env.production` فعلية. قد يفشل API عند boot لأن validation الإنتاجي صارم أو تتعطل migrations/rollback. | `docker-compose.production.yml`; `apps/api/src/config/environment.ts`; `scripts/release-readiness.mjs`; نتيجة Docker/E2E أعلاه. | شغّل Compose بنفس صور وsecrets الإنتاج على staging، migrate deploy، health/ready، smoke ثم restore drill. | إغلاق release gate بأدلة logs/artifact digests وrollback rehearsal. | L | Yes | Yes | High |
| JOVO-B02 | Blocker | Auth/OTP | التسجيل والتحقق واستعادة كلمة السر يعتمد على OTP webhook؛ لم تتوفر production endpoint/token أو delivery evidence. API يرفض Production config إن كانت ناقصة. | `apps/api/src/auth/otp.provider.ts`; `apps/api/src/auth/auth.module.ts:19-29`; `apps/api/src/config/environment.ts`; `.env.production.example`. | اختبار هاتف حقيقي لكل من signup/resend/expiry/reset مع provider production أو staging مكافئ. | تهيئة provider، مراقبة delivery، retry/runbook، وعدم إطلاق auth قبل نجاح الاختبار. | M | Yes | Yes | High |
| JOVO-B03 | Blocker | Mobile release | `expo-doctor` يفشل: `android.usesCleartextTraffic` خاصية غير مقبولة في schema، و`expo` 54.0.36 و`expo-constants` 18.0.13 أقل من النسخ المتوقعة. لا يوجد EAS Android/iOS store artifact ناجح. | `apps/mobile/app.json:19-28`; `apps/mobile/package.json`; نتيجة 15/17. | أصلح دون major upgrade غير مدروس، ثم doctor 17/17 وEAS production build/install. | تصحيح config ونسخ SDK المتوافقة، ثم Play internal + TestFlight smoke. | M | Yes | Yes | High |

## 11. Critical and High Findings

| ID | Severity | Area | المشكلة والأثر | الدليل | إعادة الإنتاج/التحقق | التعديل المطلوب | Effort | يمنع النشر | Manual | Confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| JOVO-C01 | Critical | Push/Auth | logout يمسح JWT/cart فقط ولا يلغي PushToken أو local push token. بعد دخول حساب آخر يبقى token مربوطًا بالأول، والواجهة تعتبر الإشعارات مفعلة محليًا؛ قد تظهر تفاصيل طلبات الحساب السابق على الجهاز. | `apps/mobile/App.tsx:292-305`; `apps/mobile/src/core/session.ts:47-58`; `settings-screen.tsx:45-47,88-104`; `users.service.ts:88-104`. | فعّل push للحساب A، logout، ادخل B، أرسل حدثًا إلى A؛ راقب الجهاز. | best-effort unregister قبل logout ثم clear محلي دائمًا؛ reconcile/re-register token عند login/start وتغيير token؛ اختبار حسابين. | M | Yes | Yes | High |
| JOVO-C02 | Critical | Secrets/Operations | ملف محلي ignored باسم `deploy.ps1` يحتوي connection URL ببيانات اعتماد صريحة. ليس tracked ولم يظهر في history، لكن بقاء secret في script/OneDrive خطر تسريب؛ صلاحية القيمة غير قابلة للتحقق. | `deploy.ps1:5` **[REDACTED]**؛ `.gitignore:22,24`; `git log --all -- deploy.ps1` بلا نتيجة. | افحص secret manager/audit logs دون طباعة القيمة وتحقق هل credential نشط. | rotate إن كان صالحًا، حذف السر من السكربت محليًا خارج هذه المراجعة، استخدام secret manager، وفحص history/OneDrive access. | S | Yes | Yes | High |
| JOVO-H01 | High | Push UX | لا توجد notification received/response listeners ولا `getLastNotificationResponseAsync`؛ الضغط على الإشعار في foreground/background/killed لا يوجّه لشاشة الطلب، ولا توجد معالجة payload ناقص. | غياب APIs من `apps/mobile/src`; `push-notifications.ts:8-40`; navigation مخصص في `App.tsx`. | إرسال payload صالح/ناقص في الحالات الثلاث والضغط عليه. | schema parser آمن + mapping للوجهات + pending navigation بعد session restore + tests. | M | Yes | Yes | High |
| JOVO-H02 | High | Push reliability | إرسال Expo بلا timeout/retry/receipt polling/durable queue/idempotency. عند إنشاء الطلب يُحفظ الطلب ثم يُبتلع فشل notification؛ قد لا يعرف المتجر بطلب جديد. cleanup يعالج ticket فوريًا فقط. | `push-sender.service.ts:36-119`; `realtime.gateway.ts:161-168`; `orders.service.ts:144-159`. | عطّل Expo/DB notification أثناء إنشاء طلب ثم استعد الخدمة؛ لا توجد إعادة إرسال. | transactional outbox + worker/retry/backoff/timeout + ticket IDs/receipts + dedupe وmetrics/DLQ. | L | Yes | Yes | High |
| JOVO-H03 | High | Dependencies | production dependency audit يفشل: 23 high و14 moderate، تشمل direct Expo/Nest/Prisma ومتعدية مثل multer/metro/xmldom. CI يفحص API workspace فقط، فلا يلتقط كامل monorepo. لا يعني كل advisory قابلية استغلال، لكن لا توجد triage/waiver. | `package-lock.json`; audit الحالي؛ `.github/workflows/ci.yml:60`. | شغّل audit كاملًا، تتبع paths وruntime reachability، واختبر ترقيات compatible. | تحديثات patch/minor أولًا، خطة SDK/framework major، SBOM وwaiver موثق بمواعيد. | L | Yes | Yes | High |
| JOVO-H04 | High | Mobile Admin | رفض متجر من إدارة الهاتف يرسل POST بلا body بينما DTO يفرض `reason`، لذلك endpoint يرد 400. | `restaurants-screen.tsx:167-170`; `core/api.ts:1058-1060`; `restaurants.dto.ts:415-419`; controller `:73-80`. | افتح pending store واضغط Reject. | إدخال reason والتحقق منه وتمرير `{reason}`؛ أضف UI/API integration test. | S | Yes | Yes | High |
| JOVO-H05 | High | Accounting | فشل reconciliation لحسابات الشركاء عند startup يُسجّل ثم يستمر التطبيق؛ لاحقًا قد تفشل التسوية/إكمال طلب مالي بدل منع readiness. | `apps/api/src/accounting/partner-accounts.service.ts:21-27`; `health.controller.ts:31-46`. | احذف/أفسد partner account وشغّل API ثم نفّذ delivery completion. | اجعل invariant migration/readiness fatal، أو repair transaction موثوقًا، وأضف smoke مالي. | M | Yes | Yes | High |
| JOVO-H06 | High | CI/CD | push workflow يعمل فقط على `main` و`agent/customer-phone-auth`، وليس الفرع الهدف. PR يشغّل CI لكن direct pushes لهذا الفرع بلا gate. | `.github/workflows/ci.yml:3-6`. | push إلى فرع تجريبي بنفس pattern ومراجعة Actions. | branch protection + required checks، وتعميم trigger على فروع الإصدار. | XS | Yes | Yes | High |
| JOVO-H07 | High | Branding/Legal | العلامة المرئية غير موحدة: التطبيق JOVO، بينما عنوان admin وشعاره ورسائل ووثائق privacy/terms/store listing ما زالت TasawaQ. هذا يربك المستخدم وقد يجعل بيانات المتجر/الخصوصية غير مطابقة للمنتج المنشور. | `apps/admin/index.html:6`; `Layout.tsx:68`; `apps/admin/src/api.ts:394`; `docs/privacy-policy.md:1`; `docs/terms-of-service.md:1`; `docs/store-listing.md:8`. | build كل surface ومراجعة كل النصوص/legal URLs/store metadata. | توحيد الاسم والكيان القانوني والدعم والروابط؛ مراجعة قانونية قبل النشر. | M | Yes | Yes | High |
| JOVO-H08 | High | Driver/location | “live tracking” غير منفذ: السائق يرسل location مرة عند mount/refresh، ولا continuous watch/background updates. توجد دالة watcher غير مستخدمة. العميل لا يحصل على مسار حي موثوق. | `apps/mobile/src/features/driver/screens.tsx:107-152`; `core/location.ts:29-40`; غياب background permission/task. | تحرك بجهاز سائق وراقب DB/socket دون refresh. | تحديد product scope؛ إن كان مطلوبًا نفّذ foreground cadence/background policy والبطارية/الخصوصية أو غيّر الوعد بوضوح. | L | Yes | Yes | High |
| JOVO-H09 | High | Identity | تسجيل المتجر والسائق والموظف يضبط `phoneVerifiedAt` مباشرة بلا OTP. موافقة الإدارة تحد وصول التشغيل لكنها لا تثبت ملكية الرقم وقد تسمح بحجز رقم الغير/انتحال التواصل. | `restaurants.service.ts:39-95` (خصوصًا 67)؛ `drivers.service.ts:51-90` (78)؛ `business-staff.service.ts:41-45`. | سجل برقم لا تملكه ثم سجّل الدخول قبل الموافقة. | challenge OTP موحد قبل claim الرقم؛ invitation/reset آمن للموظف؛ rate limits واختبارات. | M | Yes | Yes | High |
| JOVO-H10 | High | Admin architecture | يوجد سطحا إدارة مختلفان بلا مصدر حقيقة واضح. إدارة Expo الموصوفة “مدعومة” لا تعرض كامل location/product/landmark/accounting/roles capabilities، بينما production Compose ينشر Vite المسمى legacy. ينتج release ناقص أو surface غير مصان. | `README.md`; `docs/architecture.md`; `docker-compose.production.yml`; routes في `apps/mobile/App.tsx` و`apps/admin/src/App.tsx`. | نفّذ acceptance matrix لكل role/permission على السطح المقصود. | قرار رسمي: Vite أو Expo أو parity؛ إزالة التناقض وتحديث runbooks/tests/links. | L | Yes | Yes | High |

## 12. Medium and Low Findings

| ID | Severity | Area | المشكلة والأثر | الدليل | التحقق | المطلوب | Effort | يمنع النشر | Manual | Confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| JOVO-M01 | Medium | Auth privacy | signup وforgot password يكشفان وجود الرقم برسائل مختلفة، ما يسمح user enumeration. | `auth.service.ts:64-67,245-250`; `food-delivery-codex-spec.md:713`. | قارن الرد لرقم موجود وغير موجود. | استجابة موحدة وتسجيل داخلي فقط. | S | No | Yes | High |
| JOVO-M02 | Medium | OTP | challenge/cooldown يُحفظ قبل استدعاء provider؛ فشل الإرسال يترك challenge حيًا ويمنع إعادة فورية. | `auth.service.ts:348-410`، send عند 404. | اجعل provider يرد 500 ثم retry. | outbox أو status pending/sent وتعويض cooldown. | M | No | Yes | High |
| JOVO-M03 | Medium | Quality | `lint` هو `tsc --noEmit` ولا يوجد ESLint/formatter gate، فتظل promises/style/dead imports/patterns بلا فحص مخصص. | scripts في package manifests؛ مخرجات lint. | افحص تعريف scripts. | ESLint typed rules + Prettier check في CI. | M | No | No | High |
| JOVO-M04 | Medium | Integration tests | 3 اختبارات PostgreSQL الفعلية (idempotency/races) skipped لغياب DB؛ معظم tests تستخدم fake Prisma، فلا تثبت SQL constraints/migrations/concurrency. | نتيجة tests؛ `scripts/run-api-e2e.mjs:10-18`; ملفات `*.database-e2e.test.ts`. | شغّل `test:e2e` على PostgreSQL 17. | mandatory DB integration في CI وrelease gate. | M | No | Yes | High |
| JOVO-M05 | Medium | Mobile theme | dark mode toggle موجود لكن auth/admin/driver/restaurant تستخدم static colors؛ النتيجة mixed theme. | imports في `auth/*`, `admin/*`, `driver/*`, `restaurant/*` مقابل `ThemeProvider`. | تبديل dark والتنقل بكل الأدوار. | استخدام theme tokens كاملًا + visual regression. | L | No | Yes | High |
| JOVO-M06 | Medium | Accessibility | عدة أزرار +/-/remove بقياس 32–38px وأيقونات بلا أدلة كاملة على labels؛ دون اختبار قارئ شاشة/contrast/RTL. | `cart-screens.tsx:1129-1136`; `supermarket-screens.tsx:407,430`; `home-screen.tsx:434`. | TalkBack/VoiceOver وتدقيق target 44/48px. | تكبير hitSlop/targets وإضافة labels واختبار آلي/يدوي. | M | No | Yes | High |
| JOVO-M07 | Medium | Privacy/deletion | حذف الحساب يمحو العناوين وtokens ويُجهّل الحساب، لكنه يحتفظ بعنوان/إحداثيات snapshots داخل الطلبات التاريخية؛ لا توجد policy تنفيذية retention/anonymization. | `users.service.ts:106-133`; حقول Order في schema؛ `docs/privacy-policy.md`. | احذف حسابًا وافحص records وفق صلاحية privacy officer. | retention schedule/legitimate basis وanonymization بعد المدة + DSAR runbook. | L | No | Yes | Medium |
| JOVO-M08 | Medium | Scaling | throttling والـ metrics وSocket.IO محلية للعملية؛ التشغيل متعدد replicas يغيّر الحدود ويكسر room delivery بلا Redis adapter. الوثائق تفترض replica واحدة. | `app.module.ts:31-38`; realtime module; deployment docs. | شغّل نسختين ووزع requests/sockets. | تثبيت single replica capacity أو Redis/shared store قبل scale-out. | L | No | Yes | High |
| JOVO-M09 | Medium | Push model | token DTO يتحقق من string/length/platform فقط؛ لا device/installation ID ولا token-change listener/reconciliation. reinstall/rotation قد تترك rows قديمة حتى receipt cleanup. | `users.dto.ts:90-108`; PushToken `schema.prisma:408-419`; `push-notifications.ts`. | rotate token/reinstall وحساب أجهزة متعددة. | installation ID، Expo token format، upsert metadata، re-register on start/change. | M | No | Yes | High |
| JOVO-M10 | Medium | Admin/UI tests | Vite لديه 3 اختبارات auth retry فقط؛ لا browser tests لـ RBAC، approve/reject/suspend/delete، responsive/loading/error. Mobile UI tests 17 فقط. | test inventory و`docs/decisions.md:137`. | coverage report + Playwright/RNTL matrix. | E2E critical admin flows وnetwork/error states. | L | No | Yes | High |
| JOVO-M11 | Medium | Media | لا يوجد رفع صور فعلي؛ الإدارة تقبل URL فقط، والتحقق غالبًا string/length وليس URL scheme/host. إذا كان رفع المنتج مطلوبًا فالميزة ناقصة. | restaurant DTOs `logoUrl/imageUrl`; غياب multipart/storage service. | أدخل URL غير HTTPS وجرّب product UX. | حسم المتطلب؛ HTTPS allowlist أو upload service مع type/size/scan/signed URLs. | L | No | Yes | High |
| JOVO-M12 | Medium | Time/localization | server business rules تستخدم TZ مضبوطًا، لكن بعض الواجهات تعرض `toLocaleString()` بلا locale/timezone ثابت؛ النتائج تختلف حسب الجهاز/browser. | `apps/mobile/src/features/admin/ui.tsx:190`; Docker `TZ=Asia/Hebron`. | جهاز UTC وآخر Asia/Jerusalem وباللغتين. | formatters مركزية بـ locale وbusiness timezone. | S | No | Yes | High |
| JOVO-M13 | Medium | Performance/pagination | عدة dashboards/inventory/orders تستخدم ScrollView + `.map` أو first page ثابت؛ أحجام كبيرة تسبب memory/render بطئ ولا تتيح استعراض كل النتائج. | شاشات `admin/*`, `restaurant/*`, `driver/*`; API يدعم page/pageSize. | seed آلاف records وprofile/render/scroll. | FlatList/virtualization + pagination controls/infinite query. | M | No | Yes | Medium |
| JOVO-L01 | Low | Dead code | `watchCurrentCoordinates` موجود لكنه غير مستخدم، ما يوحي بميزة تتبع غير مكتملة ويزيد الالتباس. | `core/location.ts:29-40`; لا imports. | `rg watchCurrentCoordinates`. | حذفه أو توصيله ضمن تصميم tracking المعتمد. | XS | No | No | High |
| JOVO-L02 | Low | API wording | رد OTP يحمل عبارة “Check backend terminal in development” حتى في مسار production. | `auth.service.ts:409`. | طلب OTP في production-like config. | رسالة محايدة حسب البيئة. | XS | No | No | High |
| JOVO-L03 | Low | Bootstrap | `void bootstrap()` بلا catch صريح؛ أخطاء الإقلاع تعتمد على سلوك unhandled rejection للـ runtime. | `apps/api/src/main.ts:87`. | DB/config boot failure. | catch، log sanitized، exit non-zero. | XS | No | Yes | Medium |
| JOVO-L04 | Low | Privacy strings | iOS introspection يضيف microphone usage text مع أن المنتج لا يسجل صوتًا وAndroid يحجب RECORD_AUDIO؛ يربك مراجعة الخصوصية. | Expo introspection؛ `app.json` blocked permissions. | افحص generated Info.plist وApp Store privacy questionnaire. | منع permission/plugin side effect أو تبريره بدقة. | S | No | Yes | Medium |

## 13. Push Notification Full Audit

### Mobile

- **Verified by code:** طلب الإذن عند تفعيل المستخدم؛ رفض الإذن يعطي خطأ؛ physical-device guard؛ Expo projectId؛ Android channel باسم `orders` وبأهمية High؛ تخزين token في SecureStore native؛ التسجيل/الإلغاء endpoints؛ foreground handler يعرض banner/sound/badge (`push-notifications.ts:8-40`).
- **Broken:** lifecycle عند logout/account switch (JOVO-C01)، والضغط/deep link/cold start (JOVO-H01).
- **Partially implemented:** تعدد الأجهزة تدعمه DB، لكن لا installation ID ولا token refresh/reinstall reconciliation. token يُنشأ فقط عبر toggle، وليس تلقائيًا بعد login/start.
- **Requires production credentials:** APNs/FCM/EAS credentials. introspection أظهر development APNs entitlement؛ EAS production يفترض تغييره لكن لا يوجد artifact لإثباته. لا `google-services.json`/iOS native folder tracked، وهو طبيعي مع EAS إن كانت credentials خارج Git.
- **Requires real-device testing:** iOS/Android foreground/background/killed، permission denial/re-enable، TestFlight/Play Internal؛ emulator غير كافٍ و`expo-device` يمنعه.

### Backend

- PushToken unique عالميًا ويُربط user/platform/isActive، ويمنع duplicate token ويدعم عدة tokens للمستخدم (`schema.prisma:408-419`; `users.service.ts:88-104`). register/delete محميان JWT، والحذف scoped إلى user+token.
- الأحداث تنشئ Notification في DB وتبث Socket وتستدعي Expo ببيانات `{type, relatedEntityId}`. لا يظهر تسريب secret في payload، لكن body قد يظهر على lock screen؛ يلزم قرار privacy للمحتوى.
- batching = 100 صحيح. يتم تعطيل `DeviceNotRegistered` إن ظهر في ticket الفوري. توجد unit tests للbatch/network/dead ticket.
- لا timeout، retry، queue، receipt polling، invalid-token cleanup عبر receipts، idempotency key، provider metrics/alerts أو access token لخيار Expo enhanced security.
- recipients تُستمد من user/business/driver في services، والـ WebSocket rooms تفحص ownership/role/session. tests تغطي حزمة جيدة من authorization، لكن لا end-to-end test يثبت كل حدث مع مستخدمين متعددين.
- فشل provider لا يفشل العملية الأساسية، وهو جيد للتوافر لكنه بلا outbox يعني loss دائمًا، خصوصًا إشعار الطلب الجديد بعد commit.

### حكم الجاهزية

| السيناريو | الحكم الحالي |
|---|---|
| Android production / Play Internal | Requires production credentials + real-device testing؛ build غير مثبت. |
| iOS production / TestFlight | Requires production credentials + real-device testing؛ entitlement الإنتاجي غير مثبت. |
| Foreground display | Verified by code فقط؛ لا automated/device proof. |
| Background/killed delivery | Cannot verify؛ provider credentials/device required. |
| الضغط على الإشعار | Broken/Not implemented. |
| بعد logout/login بحساب مختلف | Broken وخطر privacy. |
| بعد reinstall/token rotation | Partially complete، بلا reconciliation. |
| الحساب نفسه على أجهزة متعددة | DB supports it؛ Requires real-device testing. |

## 14. Push Notification Test Matrix

| Test case | Preconditions | Steps | Expected result | Current status | Evidence | Missing configuration | Required manual test |
|---|---|---|---|---|---|---|---|
| رفض الإذن | جهاز حقيقي fresh install | Toggle ثم Deny | رسالة واضحة ولا token في DB | Verified by code | `push-notifications.ts:31-33` | لا شيء | نعم Android+iOS |
| قبول الإذن/token | EAS project + credentials | Toggle Allow | Expo token unique مسجل | Verified by code | lines 35-40، users service | APNs/FCM | نعم |
| Android channel | Android 13+ | تفعيل واستقبال | قناة orders HIGH وصوت/badge | Verified by code | lines 25-29 | signed build | نعم |
| iOS entitlement | TestFlight | تثبيت واستقبال | production APNs entitlement | Requires production credentials | introspection=development | Apple credential/profile | نعم |
| Foreground | token فعال | إرسال order event والتطبيق مفتوح | banner/sound/badge | Verified by code | handler lines 8-15 | provider | نعم |
| Background | token فعال | background ثم إرسال | notification تظهر مرة | Requires real-device testing | لا test | provider | نعم |
| Killed | token فعال | force-close ثم إرسال | notification تظهر مرة | Requires real-device testing | لا test | provider | نعم |
| Tap foreground/background | notification ظاهرة | اضغطها | فتح الطلب الصحيح بعد auth | Not implemented | لا response listener | navigation contract | نعم بعد التنفيذ |
| Tap cold start | app killed | اضغط notification | restore session ثم destination | Not implemented | لا last-response handler | navigation contract | نعم بعد التنفيذ |
| payload ناقص/خبيث | token فعال | أرسل data ناقص/unknown | تجاهل آمن/default inbox | Not implemented | لا parser | payload schema | نعم بعد التنفيذ |
| token مكرر | حساب واحد | سجّل token نفسه مرتين | row واحدة active | Verified by automated test/code | global unique upsert | DB E2E مستحسن | نعم اختياري |
| عدة أجهزة | حساب واحد/جهازان | فعل على كليهما | كلاهما يستقبل مرة | Verified by code | multiple rows/user | جهازان+credentials | نعم |
| logout | حساب A | فعل push ثم logout | إلغاء server ومسح local | Broken | `App.tsx:292-305` | لا شيء | نعم بعد الإصلاح |
| account switch | A ثم B نفس الجهاز | logout/login ثم حدث A | لا إشعار A على جلسة B | Broken | JOVO-C01 | لا شيء | إلزامي |
| reinstall/token change | reinstall/rotation | login/start | token الجديد reconciled والقديم يعطل | Broken | لا listener/start register | device/install ID | إلزامي |
| Provider timeout/5xx | fault injection | أنشئ order | retry durable ولا loss/duplicate | Broken | sender بلا timeout/retry/outbox | queue/worker | نعم |
| invalid token | token منتهي | send + query receipt | تعطيل row | Broken | ticket فوري فقط ولا receipt poller | receipt poller | نعم |
| batching 101+ | >100 tokens | send event | دفعتان دون duplication | Verified by automated test | `push-sender.service.test.ts` | لا شيء | load integration مستحسن |
| wrong recipient | عميلان/متجران | transition order A | A فقط يتلقى | Verified by code | scoped notification helpers | staging data | نعم end-to-end |
| sensitive lock screen | device locked | أرسل كل event types | لا PII غير مقبول | Requires real-device testing | bodies موزعة في services | privacy decision | نعم |

## 15. Security and Privacy Review

إيجابيات مثبتة: global DTO whitelist/forbid unknown (`main.ts:50-63`)، Helmet/CORS، Swagger غير Production، Argon2id، refresh rotation/revocation، session/tokenVersion checks في WebSocket، scoped rooms، RBAC route tests، audit logs، generic 500 filtering، log redaction، metrics token constant-time، seed يرفض Production، وحدود OTP يومية.

المخاطر الأساسية: JOVO-C01/C02، self-verified privileged-role phones، enumeration، push lock-screen policy، والاحتفاظ بموقع الطلب بعد حذف الحساب. لم يُعثر على endpoint حساس ظاهر بلا guard خلال فحص controllers واختبارات permission coverage؛ هذا ليس بديلًا عن DAST. لا توجد upload endpoints فعلية أو payment webhook، لذلك file-upload/webhook-signature concerns غير مطبقة حاليًا. Prisma parameterization يقلل SQL injection؛ لم يظهر raw SQL مبني من input. React escaping يقلل XSS، لكن image URLs تحتاج scheme/host policy. CORS الإنتاجي يفرض origins HTTPS صريحة؛ rate limit موجود لكنه process-local.

لا توجد production secrets tracked مثبتة في الملفات المفحوصة. أمثلة CI/dev و`.env*.example` placeholders وليست أسرارًا. الاستثناء هو السر المحلي ignored في JOVO-C02، ولم تُعرض قيمته هنا. `apps/mobile/android/app/debug.keystore` tracked للتطوير؛ يجب إثبات أن release signing يأتي من EAS ولا يستخدم debug key.

## 16. Mobile App Review

- الهوية: الاسم JOVO، package/bundle `com.jovo.app`، version `0.13.0`، build/versionCode 13، EAS projectId وproduction channel/autoIncrement موجودة. Android native config متسق. iOS managed ولا يوجد native folder tracked.
- API: Production runtime يرفض URL غير HTTPS أو مفقود (`core/api.ts:358-370`). هذا جيد، لكنه build-time value؛ يجب تثبيت domain قبل artifact.
- auth: SecureStore native، refresh single retry، logout local fallback جيد؛ push lifecycle استثناء خطير.
- network/offline: timeout وGET retries و401 refresh موجودة، mutations لا يعاد إرسالها عشوائيًا، ويوجد cached identity/cart. لا يوجد offline catalog/order queue؛ حالات انقطاع الشبكة تحتاج device verification.
- navigation/deep links: app scheme موجود، لكن لا notification deep-link handling. فحص universal/app links الخارجي غير موجود.
- location/maps: foreground current location وmap pins/landmarks؛ لا background/live tracking. ArcGIS tiles hardcoded بلا إثبات licensing/SLA.
- image: يعرض URLs ولا يرفع ملفات. barcode/camera موجودان؛ privacy prompts تحتاج مراجعة. لا يوجد سبب وظيفي واضح للميكروفون.
- states: كثير من الشاشات لديها loading/empty/error/retry، لكن لم تُختبر device/network matrix كاملة.
- RTL/i18n: العربية والإنجليزية وI18nManager/reload موجودة واختبارات أساسية ناجحة؛ formatters والـ visual RTL/manual typography ما زالت مطلوبة.
- branding/assets: icons/splash/mascot موجودة، لكن store metadata/legal ما زالت TasawaQ. لم توجد screenshots/feature graphic نهائية مثبتة.
- release: لا Android/iOS signed artifacts ولا TestFlight/Play Internal نتيجة؛ Expo doctor blocker.

## 17. Admin Dashboard Review

- Vite routes محمية بـ AuthProvider وتقبل ADMIN/RESTAURANT، وتخفي navigation حسب server-provided access. backend permissions هي enforcement الحقيقي. sessionStorage أفضل من localStorage للاستمرارية المحدودة، لكنه يبقى معرضًا لأي XSS داخل origin.
- الوظائف تشمل dashboard، المتاجر والموافقة/التعليق والمواقع والكتالوج، الطلبات والإلغاء، السائقين، المستخدمين/الأدوار/التعليق، المعالم، accounting، settings وaudit. business surface يدعم live orders/catalog/inventory/costs/staff.
- search/filter/pagination موجودة بدرجات مختلفة؛ بعض الشاشات/الإدارة داخل Expo تعرض صفحة أولى فقط أو تفتقد controls.
- حالات loading/error موجودة عمومًا، لكن لا automated browser coverage للعمليات الحساسة أو responsive behavior.
- Vite يفرض HTTPS API في Production. branding ما زال TasawaQ.
- إدارة Expo تحتوي الخلل JOVO-H04، ولا تحقق parity. delegated ADMIN قد يرى routes ثم يتلقى 403 بدل UI دقيق؛ الأمن محفوظ لكن UX غير مكتمل.
- لم يثبت endpoint حساس بلا role/permission. اختبارات API تنص على permission لكل platform controller، لكنها لا تثبت أن كل زر يرسل DTO صحيحًا.

## 18. Backend/API Review

- architecture منظم modules/controllers/services/DTOs. Global validation/error handling/CORS/Helmet/throttle موجودة، request body يعتمد Express defaults وNginx `client_max_body_size 256k`; لا uploads.
- auth قوي نسبيًا: Argon2id parameters في `crypto.util.ts:5-11`، rotating refresh، revoked sessions، active/verified/tokenVersion. مشاكل الهوية/OTP في H09 وM01/M02.
- order state machine وCAS/idempotency/stock transactions موجودة. unique key ومigration واختبارات race unit موجودة؛ DB race test لم يعمل.
- API responses تستخدم exceptions/codes بنمط ثابت نسبيًا وصفحات page/pageSize؛ لا يوجد formal response envelope واحد لكل endpoints.
- duplicate requests: إنشاء الطلب محمي idempotency؛ بقية transitions تعتمد current state/CAS ولا تملك generic idempotency keys، وهو مقبول جزئيًا لكنه يحتاج mobile retry E2E.
- health/live/ready يفحص DB؛ لا يفحص OTP/Expo/reference accounts. graceful shutdown hooks موجودة. `void bootstrap` ملاحظة Low.
- background jobs: لا queue/worker؛ subscriptions/maintenance والتقارير المالية تبدو operator-triggered. push retry غير موجود.
- logging/redaction/error webhook جيد في الكود، لكن destination/alerting غير مثبتين.
- لا payment/webhook verification لأن لا payment webhook. OTP/error webhooks outbound ومحمية tokens/timeouts بحسب config.

## 19. Database and Migration Review

- Prisma schema validate ناجح؛ العلاقات والفهارس موجودة على status/ownership/timestamps، وPushToken unique. توجد migrations للـ idempotency وcost snapshots وغيرها.
- migrations لم تُطبق على قاعدة clean حقيقية أثناء هذه المراجعة؛ drift/legacy data غير قابلين للتحقق. `prisma migrate deploy` في migration service قبل API تصميم سليم إذا فشل deployment عند failure.
- transaction boundaries جيدة للطلب والمخزون والـ accounting، وCAS يمنع claim/status races. الاستثناء المهم هو order-created notification بعد commit بلا outbox.
- إصلاحات تقارير سابقة مثبتة بالكود: تكلفة منتج السوبرماركت أصبحت مطلوبة، effective fulfillment cost snapshot أضيف، order idempotency أضيف، وحسابات timezone لها اختبارات.
- لا يمكن إثبات سلامة بيانات Production: products قديمة بلا cost، service fees legacy، partner balances، orphan records، migration history، أو terminal financial records تحتاج queries read-only على النسخة المستهدفة.
- backup script يستخدم pg_dump/checksum/retention، وrestore يطلب وجهة صريحة؛ لا scheduler/offsite copy/restore evidence.

## 20. DevOps and Production Review

- Dockerfiles multi-stage، runtime non-root/read-only/cap-drop في Compose، Nginx TLS وhealth endpoints موجودة. PostgreSQL خارجي في production compose قرار مناسب.
- CI ينفذ install/migrations/lint/typecheck/test/build/E2E/audit وصور container، لكنه لا يغطي pushes للفرع الحالي، وaudit محصور API.
- لا يمكن التحقق من Docker build/Compose rendering/images لأن engine غير متاح؛ لا digest pinning أو provenance/SBOM مثبت.
- TLS certificate paths وdomains وsecrets mounts متوقعة لكن غير متاحة. لا staging infrastructure as code واضح؛ EAS preview وحده لا يغطي backend/database.
- rollback موثق كإعادة image/forward fix/restore، لكنه غير مجرّب. migration rollback ليس تلقائيًا، وهو طبيعي بشرط rehearsal/backward compatibility.
- single API replica هو الافتراض الحالي؛ scale-out يحتاج shared throttle/Socket.IO adapter.
- `deploy.ps1` المحلي ليس جزءًا من المصدر ويتضمن خطوات commit/push/tag/secret injection؛ يجب عدم اعتباره runbook معتمدًا.

## 21. Environment Variables Audit

### مستخدمة وموثقة

`NODE_ENV`, `DATABASE_URL`, JWT access/refresh secrets، `OTP_HASH_SECRET`, `CORS_ORIGIN`, OTP webhook URL/token/provider، error tracking URL/token، `MONITORING_TOKEN`, `TRUST_PROXY`, `REQUIRE_HTTPS`, `PORT`, JWT/OTP/rate/DB pool timeouts، delivery pricing، restaurant feature flag، `TZ`, `EXPO_PUBLIC_API_URL`, `ADMIN_APP_URL`, TLS paths، ports وbackup retention.

### مستخدمة لكنها غير موثقة بوضوح في أمثلة الإنتاج

- `PRODUCTION_ENV_FILE` في Compose.
- `ADMIN_TLS_CERTIFICATE_PATH`, `ADMIN_TLS_PRIVATE_KEY_PATH` عند فصل TLS للوحة.
- `RESTORE_DATABASE_URL`, `PG_DOCKER_CONTAINER`, `PG_DOCKER_PORT` في أدوات DB/restore (تشغيلية، لا runtime).
- لا يوجد `EXPO_ACCESS_TOKEN` لمسار Expo Push enhanced security؛ الكود لا يدعمه.

### موثقة ولا يظهر استهلاك runtime مباشر

- `PUBLIC_APP_URL` موجود في أمثلة/وثائق ولم يظهر في source runtime.
- `POSTGRES_*` تخص development Compose وليست production API الخارجية.

### مطلوبة Production ولا يجوز default/placeholder

`DATABASE_URL`، الأسرار الثلاثة JWT/OTP المختلفة >=32 chars، CORS origins HTTPS، OTP URL/token، error tracking URL/token، monitoring token، `EXPO_PUBLIC_API_URL` HTTPS، TLS certificate/key، و`ADMIN_APP_URL`/admin TLS إن كان Vite سيُنشر. `TRUST_PROXY` يجب أن يطابق hop topology. لا تُستخدم localhost/example/default secrets. production validator يرفض عدة حالات خاطئة، وهي نقطة قوة؛ القيم الفعلية لم تُقرأ أو تُعرض.

## 22. Feature Completion Matrix

| Feature | Expected behavior | Implementation status | Mobile status | Admin status | API status | Test coverage | Missing work | Evidence |
|---|---|---|---|---|---|---|---|---|
| Customer phone auth | OTP signup/login/reset/session | Partially complete | Complete | Complete | Partially complete | Unit good | Production provider، enumeration/failure lifecycle | auth services/tests |
| Business registration | verified owner + approval | Partially complete | Partially complete | Complete | Partially complete | Unit | OTP ownership | H09 |
| Driver registration | verified driver + approval | Partially complete | Complete | Complete | Partially complete | Unit | OTP ownership/device E2E | H09 |
| RBAC | platform/business least privilege | Complete | Partially complete | Complete | Complete | Strong API route tests | delegated-admin UX | guards/tests |
| Supermarket catalog/search | browse/filter/details/availability | Complete | Complete | Complete | Complete | Unit + prior load | device/perf regression | restaurant/menu modules |
| Cart persistence | one-store cart, quantities | Complete | Complete | Cannot verify | Complete | Mobile tests | manual device | cart repository |
| Address/location/landmarks | saved/current/map/fees | Partially complete | Complete | Complete | Complete | Unit | map SLA/privacy/device tests | location/landmark modules |
| Quote/pricing/offers | server authoritative totals | Complete | Complete | Complete | Complete | API tests | DB E2E | orders/promotions |
| COD order/idempotency | no duplicate order | Partially complete | Complete | Complete | Complete | Unit; DB skipped | real DB race test | order migration/tests |
| Store fulfillment | accept/reject/prepare/substitute | Complete | Complete | Complete | Complete | API unit | E2E UI | orders service |
| Delivery lifecycle | claim/CAS/status/settlement | Partially complete | Complete | Complete | Complete | Unit; DB skipped | real concurrent drivers | drivers service |
| Live driver tracking | continuous customer-visible updates | Missing | Missing | Cannot verify | Partially complete | Missing | foreground/background design | H08 |
| In-app notifications | inbox + realtime updates | Complete | Complete | Complete | Complete | API/socket tests | browser/device smoke | notification/realtime |
| Push delivery | reliable multi-device lifecycle/navigation | Broken | Broken | Cannot verify | Partially complete | Backend unit only | C01/H01/H02 | push audit |
| Store/driver moderation | reasoned approve/reject/suspend | Broken | Broken | Complete | Complete | API unit | fix mobile reject; UI E2E | H04 |
| Users/roles | manage/suspend/admin roles | Partially complete | Partially complete | Complete | Complete | API tests | surface parity/browser E2E | admin modules |
| Store locations/products | CRUD/geofence/catalog | Partially complete | Missing | Complete | Complete | API unit | official admin decision | H10 |
| Landmarks/settings | platform configuration | Partially complete | Missing | Complete | Complete | API unit | official admin decision | H10 |
| Offers | campaign application/management | Partially complete | Partially complete | Complete | Complete | API unit | E2E pricing dates/TZ | offers modules |
| Accounting/payout | ledger/cost/partner settlement | Partially complete | Partially complete | Complete | Partially complete | Substantial unit | partner readiness/live DB reconciliation | H05 |
| Restaurant ordering vertical | gated until launch | Partially complete | Partially complete | Complete | Complete | Gate tests | product decision/data/content | feature flag |
| Arabic/RTL | full localized accessible UI | Partially complete | Partially complete | Partially complete | Cannot verify | Basic tests | visual/a11y/date tests | i18n + M06/M12 |
| Dark mode | consistent all-role theme | Partially complete | Broken | Partially complete | Cannot verify | Missing | migrate static colors | M05 |
| Offline/network recovery | safe failures/restore/retry | Partially complete | Partially complete | Partially complete | Complete | API helper tests | device chaos/offline screens | API clients |
| Account deletion/privacy | revoke/anonymize/retention | Partially complete | Complete | Cannot verify | Partially complete | Unit | historical location retention process | M07 |
| Production deployment | reproducible verified release | Missing | Missing | Missing | Partially complete | CI partial | B01-B03 | deploy files |

## 23. Test Coverage and Missing Tests

الأولوية المفقودة: PostgreSQL migration/race E2E؛ push account-switch/tap/background/killed/receipt; full order happy/failure flow على staging؛ two-driver concurrent claim؛ partner accounting/reference-account failure؛ mobile admin reject؛ admin RBAC/browser responsive؛ network timeout/offline/retry؛ accessibility/RTL/dark visual؛ release artifact install؛ backup restore؛ security DAST (enumeration/IDOR/CORS/rate limit). لا يوجد coverage threshold أو mutation testing. تحذيرات React `act` يجب تنظيفها كي لا تخفي warnings مستقبلية.

## 24. App Store and Release Requirements

- تشغيل Expo doctor بلا أخطاء، وEAS production builds موقعة وتثبيتها عبر TestFlight وPlay Internal.
- إثبات APNs production وFCM/Expo project credentials، push consent وتجارب foreground/background/killed.
- توحيد JOVO في display name/admin/legal/store metadata؛ نشر privacy policy وterms URLs صحيحة وقابلة للوصول.
- مراجعة Play Data Safety وApp Privacy: رقم الهاتف، الموقع الدقيق، device token، order history، diagnostics؛ توضيح أن background location غير مستخدم أو تفعيله بسبب واضح.
- تبرير camera، إزالة microphone prompt غير الضروري، ومراجعة notification permission messaging.
- account deletion داخل التطبيق موجود؛ يجب ربطه بسياسة retention ودعم طلبات البيانات.
- release signing لا يستخدم `debug.keystore`، version/build autoIncrement يعمل، runtimeVersion/channel وOTA rollback policy مجربة.
- إعداد screenshots/feature graphic/support contact/content rating/export compliance/age/privacy nutrition labels غير مثبت في repo.

## 25. Observability, Monitoring and Backups

الكود يوفر structured logs مع redaction، request IDs، `/health/live`, `/health/ready` وmetrics token، وerror webhook. غير المثبت: dashboard، log retention، SLO، alerts، on-call، synthetic order، Expo receipt monitoring، DB/storage/disk alerts، وcrash SDK داخل mobile. يجب ألا يكون push مجرد warnings محلية.

backup/restore scripts موجودة، لكن لا دليل schedule أو offsite encrypted copies أو PITR أو restore drill/RPO/RTO. الحد الأدنى قبل النشر: backup ناجح، checksum، restore إلى DB منفصلة، تحقق counts/critical ledger، وتوثيق زمن الاستعادة ومالك الاستجابة.

## 26. Improvements and Technical Debt

- حسم هوية المنتج وسطح الإدارة الرسمي وإزالة وثائق TasawaQ المتقادمة.
- إدخال outbox/worker عام للإشعارات والمهام الشهرية بدل fire-and-forget.
- إنشاء shared typed contracts أو OpenAPI client لتجنب خلل body مثل reject.
- ESLint/Prettier، coverage thresholds، Playwright، real DB Testcontainers/CI.
- توحيد theme/date/error/loading primitives، virtualization وpagination.
- SBOM/Dependabot أو Renovate وسياسة advisory triage.
- Redis عند الحاجة إلى أكثر من replica، وإضافة dependency readiness بحذر دون جعل مزود push يوقف API.
- تقليل التعليقات/الأسماء الداخلية القديمة Wasel/TasawaQ تدريجيًا من دون كسر storage/API migrations.

### مطابقة التقارير السابقة مع الكود الحالي

| الملاحظة السابقة | الحالة الحالية | الدليل/التفسير |
|---|---|---|
| Push tokens مخزنة ولا تُرسل | تم إصلاحها جزئيًا | sender/batching/tests موجودة؛ lifecycle/receipts/navigation ما زالت ناقصة. |
| لا SMS/OTP production | ما زالت غير قابلة للتحقق | webhook adapter وvalidation موجودان، credentials/delivery غير متاحين. |
| timezone UTC يكسر ساعات العمل | تم إصلاحها | Docker TZ واختبارات timezone؛ عرض UI ما زال device-dependent. |
| supermarket cost غير إلزامي | تم إصلاحها في الكود | validators/tests/catalog guard؛ legacy production data غير قابل للتحقق. |
| fulfillment cost لا يعكس التعديل | تم إصلاحها | migration + effective cost tests. |
| order idempotency ناقص | تم إصلاحها | unique migration/service fallback/tests؛ DB race skipped. |
| admin tokens في localStorage | تم إصلاحها | `sessionStorage` حاليًا. |
| OTP بلا daily cap | تم إصلاحها | per-phone/global caps. |
| account deletion يترك saved addresses | تم إصلاحها جزئيًا | Address/PushToken delete؛ historical order location يبقى. |
| partner account startup error swallowed | ما زالت موجودة | JOVO-H05. |
| self-verified business/driver | ما زالت موجودة | JOVO-H09. |
| user enumeration | ما زالت موجودة | JOVO-M01. |
| continuous driver tracking | ما زالت موجودة | JOVO-H08. |
| offline cold restore/refresh/cart retry | تم إصلاحها جزئيًا | cache/refresh/retry موجودة؛ device chaos غير مختبر. |
| small touch targets/nonvirtualized lists | ما زالت موجودة جزئيًا | JOVO-M06/M13. |
| dev database/fees/terminal financial data | لم يعد بالإمكان التحقق منها | يلزم وصول read-only إلى قاعدة البيانات المستهدفة. |

المصادر السابقة المقروءة: `AUDIT_FULL.md`, `AUDIT_REPORT.md`, `DEPLOY_READINESS.md`, `FIX_REPORT.md`, `QA_REPORT.md`, `TEST_GAPS_REPORT.md`, `TRIAL_DEPLOY_CHECK.md`, `qa_audit_prompt.md`، إضافة إلى ملفات المتطلبات. لم تُعامل أي نتيجة قديمة كحقيقة دون مطابقة حالية.

## 27. Prioritized Action Plan

| Priority | Task | Related finding | Suggested owner | Dependencies | Effort | Acceptance criteria | Verification steps |
|---|---|---|---|---|---|---|---|
| P0 | إصلاح push logout/account-switch reconciliation | C01, M09 | Mobile + Backend | جهازان/حسابان | M | لا token فعال لحساب سابق، وlogin يعيد ربط الحالي | automated lifecycle + real devices |
| P0 | إصلاح Expo config/dependencies وبناء artifacts | B03 | Mobile/DevOps | EAS/Apple/Google creds | M | doctor 17/17؛ Android+iOS production build/install | Play Internal + TestFlight smoke |
| P0 | تهيئة واختبار OTP production | B02, M02 | Backend/DevOps/QA | provider credentials | M | signup/resend/expiry/reset تعمل مع alerts | real phone matrix + provider logs |
| P0 | تنفيذ staging release rehearsal | B01, H05 | DevOps/Backend/QA | env/TLS/DNS/DB | L | migrate/boot/ready/smoke/rollback/restore ناجحة | حفظ logs/digests/checklist |
| P0 | تدوير credential المحلي إن كان نشطًا ونقله إلى secret manager | C02 | DevOps/Security | DB owner/access logs | S | old credential revoked ولا plaintext scripts | auth test + secret scan |
| P0 | Push outbox/retry/receipts/navigation | H01,H02 | Backend + Mobile | queue/schema/navigation | L | لا loss بعد provider outage، tap صحيح بكل state | fault injection + device matrix |
| P0 | إصلاح رفض المتجر من إدارة الهاتف | H04 | Mobile | API DTO | S | reason required ويرجع نجاحًا ويظهر audit/notification | UI integration test |
| P0 | جعل partner accounts invariant جزءًا من readiness | H05 | Backend | migration/data audit | M | missing reference data يمنع ready أو يصلح بأمان | staging failure test |
| P0 | توحيد branding/legal/store metadata | H07 | Product/Mobile/Admin/Legal | اسم كيان وروابط | M | لا TasawaQ مرئي في artifacts/docs العامة | automated text scan + manual review |
| P0 | معالجة/waive advisories وفحص monorepo في CI | H03 | DevOps/All | upgrade compatibility | L | لا High غير موثق بقبول risk محدد المدة | audit/SBOM/regression |
| P1 | فرض CI على فرع الإصدار وbranch protection | H06 | DevOps | GitHub settings | XS | required checks قبل merge/push release | negative branch test |
| P1 | OTP لكل business/driver/staff identity | H09 | Backend/Mobile | provider | M | لا claim لرقم بلا challenge | abuse tests |
| P1 | اختيار surface الإدارة الرسمي وإكمال parity | H10 | Product/Admin/Mobile | decision | L | capability matrix كاملة للسطح المنشور | role-by-role UAT |
| P1 | تشغيل DB E2E/concurrency وbrowser E2E | M04,M10 | QA/Backend/Admin | PostgreSQL/Playwright | L | mandatory CI green | clean DB pipeline |
| P1 | حسم live tracking وتنفيذ النطاق/الخصوصية | H08 | Product/Mobile/Backend | policy/battery design | L | SLA معلن ومختبر أو إزالة وعد live | route/device test |
| P1 | إصلاح enumeration وOTP send state | M01,M02 | Backend | OTP design | M | responses موحدة ولا cooldown كاذب | fault/abuse tests |
| P1 | privacy retention وstore disclosures/accessibility | M06,M07,L04 | Product/Legal/Mobile | legal review | L | disclosures صحيحة وdeletion/retention قابلة للتدقيق | privacy/a11y audit |
| P1 | إكمال dark mode/date formatting/pagination | M05,M12,M13 | Mobile/Admin | design tokens | L | كل roles/RTL/large data مقبولة | visual/perf matrix |
| P2 | ESLint/Prettier/coverage thresholds | M03 | All | CI | M | gates مستقلة عن typecheck | deliberate violation test |
| P2 | shared typed API client/contracts | H04 | All | OpenAPI pipeline | L | contract mismatch يفشل build/test | contract test |
| P2 | scale-out readiness أو توثيق single-replica limit | M08 | Backend/DevOps | capacity plan/Redis | L | tested replica policy | two-replica test |
| P2 | إزالة dead code/dev wording والديون الداخلية | L01-L03 | Mobile/Backend | لا شيء | S | لا unused watcher/dev OTP message؛ boot exits clean | lint/boot tests |

## 28. Pre-release Checklist

- [x] التحقق من origin والفرع الهدف والـ commit.
- [x] فحص `git status` وعدم حذف/استبدال تغييرات موجودة.
- [x] قراءة README والمتطلبات والتقارير السابقة ومطابقتها بالكود.
- [x] TypeScript typecheck ناجح لكل workspaces.
- [x] الاختبارات المتاحة: 470 pass، 0 fail، مع تسجيل 3 skipped.
- [x] Prisma schema validation ناجح.
- [ ] إغلاق كل P0 مع مراجعة مستقلة.
- [ ] `expo-doctor` = 17/17.
- [ ] audit production بلا High غير مفسر/مقبول رسميًا.
- [ ] real PostgreSQL E2E/migrations/concurrency ناجحة.
- [ ] Docker/API/web/admin production builds ناجحة وممسوحة.
- [ ] EAS Android/iOS production builds موقعة ومثبتة.
- [ ] OTP production matrix ناجحة.
- [ ] Push device matrix كاملة، خصوصًا logout/tap/killed/multi-device.
- [ ] staging end-to-end order + failure/cancel/refund/accounting smoke.
- [ ] backup + restore drill وrollback rehearsal.
- [ ] TLS/DNS/CORS/secrets/monitoring/alerts verified.
- [ ] JOVO branding/legal/privacy/store metadata approved.
- [ ] Accessibility/RTL/dark/responsive manual sign-off.
- [ ] Play Internal وTestFlight approval smoke بلا crash.

## 29. Manual Tests Required

1. جهازا Android وiPhone فعليان: install/update/reinstall، permissions، SecureStore، notification states، account switch.
2. TestFlight وPlay Internal signed artifacts مع production-like API HTTPS.
3. كل دور وكل permission، بما فيه delegated admin/business staff ومحاولات 403/IDOR.
4. order E2E: happy path، out-of-stock، substitution، rejection، customer/admin cancellation، driver fail، double taps، شبكة متقطعة.
5. سائقان يطالبان بنفس delivery وعميلان/متجران للتأكد من isolation.
6. OTP provider: تأخير/5xx/timeout/resend/expiry/daily limits/reset.
7. push matrix في القسم 14، وقفل الشاشة لمراجعة PII.
8. RTL/Arabic/English، large font، TalkBack/VoiceOver، contrast وtouch targets، أجهزة صغيرة/tablet/web responsive.
9. timezone حول منتصف الليل/DST وساعات المتجر والعروض والتقارير.
10. staging disaster drill: failed migration، DB unavailable، missing partner accounts، backup restore، rollback image.

## 30. Final Recommendation

لا تنشر النسخة الحالية إلى Production. أغلق P0 أولًا، ثم أنشئ release candidate جديدًا دون تغيير identifiers، وشغّل CI كاملًا + PostgreSQL E2E + Docker/staging rehearsal + Expo doctor/EAS builds + device push/OTP tests. بعد نجاح الأدلة، أعد المراجعة؛ القرار المتوقع يمكن أن يتحول إلى **CONDITIONAL GO** فقط إذا بقيت عناصر P1 ذات مخاطر مقبولة موثقة ومالكين ومواعيد، وإلى **GO** بعد اكتمال بوابات الأمن والبيانات والاستعادة والمتاجر.

### Checklist العمل المتبقي النهائية

- [ ] P0: منع push leakage عند logout/account switch.
- [ ] P0: معالجة Expo doctor وإنشاء Android/iOS release artifacts.
- [ ] P0: إثبات OTP production.
- [ ] P0: staging migration/boot/smoke/rollback/restore.
- [ ] P0: rotate السر المحلي المحتمل ونقله إلى secret manager.
- [ ] P0: outbox/retry/receipts/push navigation.
- [ ] P0: إصلاح mobile admin reject.
- [ ] P0: partner-account readiness invariant.
- [ ] P0: توحيد JOVO branding/legal/store metadata.
- [ ] P0: dependency advisory triage وإغلاق High غير المقبولة.
- [ ] P1: CI branch protection وDB/browser E2E.
- [ ] P1: تحقق هاتف business/driver/staff وحسم live tracking/admin surface.
- [ ] P1: privacy/accessibility/theme/date/pagination sign-off.
- [ ] P2: lint/format/coverage/contracts/scale technical debt.
- [x] لم يُنفذ commit أو push أو تعديل كود ضمن هذه المراجعة.
