# Reviewer access guide (plan only: no accounts were created and the rate limiter was not changed)

**Policy sources (fetched 2026-10-31)**

- Apple 2.1 (https://developer.apple.com/app-store/review/guidelines/): "include demo account info (and turn on your back-end service!) if your app includes a login."
- Apple 2.3.1: "All new features … must be described with specificity in the Notes for Review."
- Google App access (https://support.google.com/googleplay/android-developer/answer/9859455): "you must provide all required details to enable access to your app", with up to five sets of credentials and an "Any other instructions" field.

## 1. Demo accounts to create (owner or Khaldoun, through the admin console, in production)

| Account | Role | Phone | How to create | Setup |
|---|---|---|---|---|
| Review customer | CUSTOMER | [[PLACEHOLDER: +970 number you control]] | Admin console → Users (or sign up once yourself with the OTP) | A strong password, not reused anywhere. One saved address **inside** the delivery zone, set as default, so checkout works from anywhere in the world. |
| Review driver | DRIVER (approved) | [[PLACEHOLDER]] | Admin → Drivers → Create | Approved. During the review window keep **one demo order** prepared by staff, assigned to this driver and ready for pickup (see §3). |
| Review store staff | RESTAURANT (member of JOVO MARKET) | [[PLACEHOLDER]] | Store → Staff → Invite | Least privilege: orders and preparation only, **no** price or cost permission. |
| Admin | — | — | **Do not share.** | The notes describe admin as an internal staff tool; offer a restricted demo admin on request. |

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
> **Customer account:** a delivery address inside the zone is already saved. Please place at most one test order; our team cancels test orders.
>
> **Driver account:** an order is already assigned. Open it and start the delivery. You will see our location disclosure, then the system location prompt. The driver's location is shared with JOVO dispatch only during an active delivery, including in the background so dispatch can follow the delivery while the driver uses a navigation app. It stops when the delivery ends.
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
> **حساب الزبون:** يوجد عنوان محفوظ داخل منطقة التوصيل. يرجى عدم إرسال أكثر من طلب تجريبي واحد، وسنلغي الطلبات التجريبية.
>
> **حساب السائق:** يوجد طلب مُسند جاهز. افتح الطلب وابدأ التوصيل، وسيظهر إفصاح الموقع ثم طلب إذن النظام. يُشارك موقع السائق مع إدارة JOVO فقط أثناء التوصيلة النشطة، بما في ذلك في الخلفية أثناء استخدام تطبيق ملاحة، ويتوقف عند انتهاء التوصيلة.
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

**Driver demo order**

Created by staff on the review customer account, assigned to the review driver, kept in "ready for pickup".

- If the reviewer completes it, it goes through as a normal delivered cash order with custody of the order total.
- **Recommended:** keep the demo order total tiny (one low-price item) and settle it the same day.
- Alternative: cancel it from admin before the reviewer reaches "delivered".

**Optional future code change (not done; needs an owner decision)**

- A server flag `REVIEW_ACCOUNT_PHONES` that tags orders from those phones as `isTest`.
- Such orders would be excluded from notifications to real drivers and from analytics.
- This changes order behaviour, so it was not implemented.

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
