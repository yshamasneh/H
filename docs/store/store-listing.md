# JOVO store listing (Google Play and App Store)

Arabic is the primary listing language; English is the second. This replaces the old TasawaQ / restaurant listing (`docs/store-listing.md`, now a pointer here). Character limits were checked by counting; re-check in the console, because each console counts slightly differently.

**Placeholders**

- [[PLACEHOLDER: town / service area]] / [[PLACEHOLDER: اسم البلدة / منطقة الخدمة]]
- [[PLACEHOLDER: delivery radius in km]]
- [[PLACEHOLDER: support email]], [[PLACEHOLDER: support phone]]
- [[PLACEHOLDER: developer name exactly as on the store accounts]]

## Common fields

| Field | Value |
|---|---|
| App name (Play: max 30, App Store: max 30) | `JOVO - جوفو ماركت` (Arabic listing) / `JOVO - JOVO MARKET delivery` (English listing) |
| Category | Shopping (Play) / Shopping (App Store) |
| Price | Free. No in-app purchases. No ads. |
| Contact email | [[PLACEHOLDER: support email]] |
| Website / support URL | https://jovops.com/support |
| Privacy policy URL | https://jovops.com/privacy |
| Account deletion URL (Play) | https://jovops.com/delete-account |
| Contains ads | No |

## Arabic (primary)

**Short description** (Google Play, max 80):

> توصيل مشتريات جوفو ماركت إلى بابك، والدفع نقدًا عند الاستلام.

**App Store subtitle** (max 30):

> جوفو ماركت إلى باب بيتك

**Full description** (Google Play, max 4000 / App Store description):

> JOVO هو تطبيق التوصيل الرسمي لمتجر «جوفو ماركت» (JOVO MARKET) في [[PLACEHOLDER: اسم البلدة / منطقة الخدمة]].
>
> • تصفّح أقسام المتجر وابحث عن المنتجات والعلامات التجارية، حتى قبل إنشاء حساب.
> • أضف ما تحتاجه إلى السلة واختر عنوان التوصيل على الخريطة.
> • يُظهر لك التطبيق قبل التأكيد هل عنوانك داخل منطقة التوصيل ([[PLACEHOLDER: نصف قطر التوصيل بالكيلومتر]] كم من المتجر)، مع رسوم التوصيل والإجمالي.
> • ادفع نقدًا للسائق عند الاستلام، فلا بطاقات ولا مدفوعات داخل التطبيق.
> • تابع حالة طلبك خطوة بخطوة، ووافق على البدائل أو ارفضها إذا لم يتوفر منتج.
> • إشعارات فورية عند تغيّر حالة الطلب.
>
> للسائقين وموظفي المتجر: يحتوي التطبيق أيضًا على أدوات عمل لسائقي JOVO وموظفي المتجر، بحسابات تنشئها إدارة JOVO.
>
> الموقع للسائقين: يجمع JOVO موقع السائق في الخلفية فقط أثناء وجود توصيلة نشطة، حتى عندما يكون التطبيق مغلقًا أو أثناء استخدام تطبيق ملاحة، لكي تتابع الإدارة التوصيلة. يتوقف فور انتهاء التوصيلة، ولا يُجمع في الخلفية عندما لا توجد توصيلة.
>
> لا يبيع JOVO التبغ أو منتجات النيكوتين أو الكحول.
>
> يمكنك حذف حسابك في أي وقت من الإعدادات.

**App Store keywords** (max 100, comma-separated, no spaces after commas):

> جوفو,بقالة,سوبرماركت,توصيل,مشتريات,خضار,ألبان,منظفات,دفع عند الاستلام,JOVO

## English

**Short description** (Google Play, max 80):

> JOVO MARKET groceries delivered to your door. Pay cash on delivery.

**App Store subtitle** (max 30):

> JOVO MARKET to your door

**Full description**:

> JOVO is the official delivery app of JOVO MARKET in [[PLACEHOLDER: town / service area]].
>
> • Browse the store's departments and search products and brands, even before creating an account.
> • Add what you need to your cart and pick your delivery address on the map.
> • Before you confirm, the app shows whether your address is inside the delivery area ([[PLACEHOLDER: delivery radius in km]] km from the store), the delivery fee and the total.
> • Pay the driver in cash on delivery: no cards, no in-app payments.
> • Follow your order step by step, and accept or reject a replacement if a product is out of stock.
> • Instant notifications when your order's status changes.
>
> For drivers and store staff: the app also contains work tools for JOVO drivers and JOVO MARKET staff. Their accounts are created by JOVO administrators.
>
> Location for drivers: JOVO collects a driver's location in the background only while a delivery is active, including when the app is closed or a navigation app is in use, so dispatch can follow the delivery. It stops as soon as the delivery ends, and nothing is collected in the background when there is no delivery.
>
> JOVO does not sell tobacco, nicotine or alcohol products.
>
> You can delete your account at any time in Settings.

**App Store keywords** (max 100):

> grocery,supermarket,delivery,groceries,cash on delivery,JOVO,market,food,household

## Screenshots to capture

Capture these from a **release** build signed in with the demo accounts (marked as demo accounts, `reviewer-access-guide.md` §1) (never real customer data). Arabic first, then English.

1. Customer home (search, offers, departments).
2. A department catalogue.
3. A product page.
4. Cart and checkout with the delivery fee and total, showing "cash on delivery".
5. Order tracking.
6. Driver home with an active delivery.
7. Settings, showing the privacy, terms and delete-account rows.

Sizes: Google Play phone screenshots (min 320 px, max 3840 px per side, 16:9 or 9:16) and a 1024×500 feature graphic. App Store: the 6.9-inch iPhone set (UNVERIFIED: confirm the exact pixel sizes in App Store Connect when enrolled). `supportsTablet` is false, so iPad screenshots are not needed.

## What must not appear in screenshots or text

- Restaurants, meals, TasawaQ or Wasel.
- Tobacco, vape or alcohol products.
- "Coming soon".
- Prices in any currency other than ₪.
- Third-party logos used as if they were JOVO's.
