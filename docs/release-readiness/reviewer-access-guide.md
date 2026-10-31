# Reviewer access guide

Run 2 status: the server can now mark demo accounts (below). No account was created, no login shortcut exists, and the rate limiter was not changed.

**Policy sources (fetched 2026-10-31)**

- Apple 2.1 (https://developer.apple.com/app-store/review/guidelines/): "include demo account info (and turn on your back-end service!) if your app includes a login."
- Apple 2.3.1: "All new features … must be described with specificity in the Notes for Review."
- Google App access (https://support.google.com/googleplay/android-developer/answer/9859455): "you must provide all required details to enable access to your app", with up to five sets of credentials and an "Any other instructions" field.

## 1. Demo accounts to create (owner or Khaldoun, through the admin console, in production)

| Account | Role | Phone | How to create | Setup |
|---|---|---|---|---|
| Review customer | CUSTOMER | [[PLACEHOLDER: +970 number you control]] | Admin console → Users (or sign up once yourself with the OTP) | A strong password, not reused anywhere. One saved address **inside** the delivery zone, set as default, so checkout works from anywhere in the world. |
| Review driver | DRIVER (approved) | [[PLACEHOLDER]] | Admin → Drivers → Create | Approved. During the review window keep **one demo order** prepared by staff, assigned to this driver and ready for pickup (see §3). |
| Review store staff | — | — | **Not recommended.** A store-staff account sees real customers' orders and addresses, and the server refuses to mark store staff as demo accounts. Describe the store screens in the notes instead, or provide screenshots on request. |
| Admin | — | — | **Do not share.** | The notes describe admin as an internal staff tool; offer a restricted demo admin on request. |

**Mark both accounts as demo accounts (new in run 2).** After creating them, an administrator with `MANAGE_USERS` calls, for each account:

```
PATCH /api/v1/admin/users/<userId>/demo   {"isDemo": true, "reason": "App review account"}
```

(There is no admin-web button yet; use the API with an admin token, or ask for a follow-up run to add the button.) What the flag does, enforced by the server and covered by `demo-accounts.e2e.test.ts`:

- Orders placed by a demo customer are stored with `Order.isDemo = true`.
- When such an order is ready for pickup, only **demo** drivers are alerted (push, in-app and socket). Real drivers never see it in "available deliveries" and get 404 if they try to accept it. A demo driver never sees or accepts a real order.
- A demo delivery can be accepted, picked up and started (so the reviewer sees the location disclosure and background tracking), but **delivered** or **failed** is refused with `DEMO_ORDER_CANNOT_COMPLETE`. Those two steps are what write the financial record, cash custody and earnings, so a demo order never enters accounting or settlement. An administrator cancels it afterwards.
- Only CUSTOMER and DRIVER accounts can be marked (`DEMO_ROLE_NOT_ALLOWED` otherwise). A driver with an active delivery cannot switch sides.
- Every change is in the audit log (`USER_MARKED_DEMO` / `USER_UNMARKED_DEMO`).
- **Still true:** the real store (JOVO MARKET) receives the demo customer's order on its board. Staff must recognise the review customer's name and prepare/cancel it as in §3. Analytics and dashboards do not filter demo orders yet.

Rules:

- Passwords go only into App Store Connect and Play Console, never into the repo or chat.
- Use dedicated phone numbers that no real person uses.
- After review, rotate the passwords.

## 2. Review notes (paste into App Store "Notes" and Play "Any other instructions")

### English

> JOVO is the delivery app of a single store, JOVO MARKET, in [[PLACEHOLDER: town]], West Bank. Payment is cash on delivery only: there are no digital goods, no in-app purchases and no card payments. Delivery is only within [[PLACEHOLDER: radius]] km of the store; outside it, checkout says "This address is outside the delivery range", which is expected.
>
> **Login:** phone number + password. Choose country code +970 and enter the number exactly as given. No SMS code is needed to log in; SMS codes are used only for new sign-ups and password resets, which need a Palestinian or Israeli number.
>
> **Browsing without an account:** on the first screen, "Browse without an account" opens the store catalogue, search and offers. An account is only needed to order, see orders or manage personal data.
>
> **Customer account:** a delivery address inside the zone is already saved. Please place at most one test order. It is marked as a review order: no real driver is sent and our team cancels it.
>
> **Driver account:** a review order is waiting under "available deliveries" (switch online first). Accept it and start the delivery. The final "delivered" step is disabled for review orders, which is expected. You will see our location disclosure, then the system location prompt. The driver's location is shared with JOVO dispatch only during an active delivery, including in the background so dispatch can follow the delivery while the driver uses a navigation app. It stops when the delivery ends.
>
> **Store-staff account:** the JOVO MARKET order board and order preparation.
>
> **Administration:** the same app contains an internal administration area for JOVO employees only (users, drivers, offers, cash settlement). It is not available to the public, and accounts are created by JOVO. Credentials are available on request.
>
> **Account deletion:** Settings → Delete my account, for customers, drivers and store staff. Web: https://jovops.com/delete-account. A driver with an active delivery or unsettled cash sees a scheduled date instead of immediate deletion.
>
> **Privacy policy:** https://jovops.com/privacy (also in Settings). Support: https://jovops.com/support, [[PLACEHOLDER: support email]].

### العربية

> JOVO هو تطبيق التوصيل لمتجر واحد هو «جوفو ماركت» في [[PLACEHOLDER: اسم البلدة]]، والدفع نقدًا عند الاستلام فقط: لا توجد منتجات رقمية ولا مشتريات داخل التطبيق ولا دفع بالبطاقة. التوصيل فقط ضمن [[PLACEHOLDER: نصف القطر]] كم من المتجر، وخارجها تظهر رسالة أن العنوان خارج منطقة التوصيل، وهذا متوقع.
>
> **الدخول:** برقم الهاتف وكلمة المرور. اختر مفتاح الدولة +970 وأدخل الرقم كما هو. لا حاجة لرمز SMS لتسجيل الدخول؛ الرمز فقط لإنشاء حساب جديد أو استعادة كلمة المرور.
>
> **التصفح بدون حساب:** في الشاشة الأولى يفتح خيار «تصفّح بدون حساب» كتالوج المتجر والبحث والعروض. الحساب مطلوب فقط للطلب ومتابعة الطلبات وإدارة البيانات الشخصية.
>
> **حساب الزبون:** يوجد عنوان محفوظ داخل منطقة التوصيل. يرجى عدم إرسال أكثر من طلب تجريبي واحد؛ يُعلَّم كطلب مراجعة فلا يُرسل إليه سائق حقيقي، وسنلغيه.
>
> **حساب السائق:** يوجد طلب مراجعة ضمن «التوصيلات المتاحة» (فعّل وضع الاتصال أولًا). اقبله وابدأ التوصيل، علمًا أن خطوة «تم التسليم» معطّلة لطلبات المراجعة وهذا متوقع. وسيظهر إفصاح الموقع ثم طلب إذن النظام. يُشارك موقع السائق مع إدارة JOVO فقط أثناء التوصيلة النشطة، بما في ذلك في الخلفية أثناء استخدام تطبيق ملاحة، ويتوقف عند انتهاء التوصيلة.
>
> **حساب موظف المتجر:** لوحة طلبات جوفو ماركت وتجهيز الطلبات.
>
> **الإدارة:** يحتوي التطبيق على قسم إدارة داخلي لموظفي JOVO فقط، وليس متاحًا للعامة. بيانات الدخول متاحة عند الطلب.
>
> **حذف الحساب:** الإعدادات ← حذف حسابي، للزبائن والسائقين وموظفي المتجر، أو عبر https://jovops.com/delete-account.
>
> **سياسة الخصوصية:** https://jovops.com/privacy (وأيضًا من الإعدادات).

## 3. Safe handling of test orders (M7)

**Before submitting**

- Tell store staff and drivers the review window dates.
- Khaldoun watches for orders from the review customer phone.

**Customer test order**

- Staff accept it, mark it prepared, and then **cancel it with the reason "review test"**.
- No driver is dispatched to a real address. The demo address should be the store's own address, or [[PLACEHOLDER: a safe address inside the zone]].
- Because the order is cancelled, no cash custody or earnings are created. Check with the admin accounting view afterwards.

**Driver demo order (run 2: enforced by the server)**

- Have staff move the demo customer's order to "ready for pickup". Only the demo driver is alerted.
- The reviewer can accept, pick up and start it; "delivered" and "failed" are refused, so no cash custody or earnings can be created.
- After the review, an administrator cancels the order (reason "review test").
- The older advice ("keep the total tiny and settle it the same day") is no longer needed for demo-marked accounts. It still applies if you skip the demo flag.

## 4. Login back-off and demo phones (M8)

**Current behaviour (CONFIRMED, `apps/api/src/auth/login-attempt-limiter.ts`, commit `56dcff4`)**

- 5 free failures per phone + IP pair, then a delay that doubles from 1 s up to 15 minutes.
- A phone attacked from many IPs is slowed down, not locked.
- A correct password is refused while the pair is backing off.

**Risk.** A reviewer who mistypes 6 or more times waits up to 15 minutes on that IP.

**Options (not implemented; the rate limiter was not changed)**

1. **No code change (recommended for the first submission).** Give exact credentials with the country code spelled out, and test them yourself from a fresh device the day before submission.
2. A config allow-list `LOGIN_BACKOFF_EXEMPT_PHONES` that keeps the per-account slowdown but caps the pair back-off at 10 s for listed demo phones. This weakens protection only for accounts you control and with strong passwords. It needs your approval and tests.
3. Reset the counter manually: it is in memory, so an API restart clears it. This is only an emergency step during review.
