# Review notes — App Store "Notes" and Google Play "App access → Any other instructions"

Paste the matching language block. Demo credentials are entered in the consoles' own credential fields, **never** in this repository. Accounts: one demo customer and one demo driver, created with numbers you control (P19) and marked with `PATCH /api/v1/admin/users/<id>/demo` (see `docs/release-readiness/reviewer-access-guide.md`). Every `[[PLACEHOLDER]]` is listed in `PLACEHOLDERS.md`.

**Re-checked against the code on `store-remediation-2` (run 3):** guest browsing exists (login screen → "Browse without an account"); review orders from demo accounts reach only demo drivers and cannot be completed; account deletion exists for customers, drivers and store staff; the notification explainer appears before the system prompt; driver background location only during an active delivery. Run 3 added only internal admin tools (product review, catalogue importer) that reviewers do not see.


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
