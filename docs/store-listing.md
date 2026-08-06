# Store listing package

Release candidate: `0.8.0` (`versionCode`/`buildNumber` 8 before store-managed auto-increment)

## Product metadata

- App name: `TasawaQ | تسوق`
- Google Play short description: `اطلب وجبتك، تابع تجهيزها، واستلمها بسهولة مع TasawaQ.`
- Apple subtitle: `طلب وتوصيل الطعام بسهولة`
- Primary category: Food & Drink
- Secondary category: Shopping
- Default language: Arabic
- Keywords: `طعام,توصيل,مطاعم,طلبات,وجبات,TasawaQ`

Arabic full description:

> TasawaQ يجمع الزبائن والمطاعم ومندوبي التوصيل في تجربة واحدة واضحة. تصفح المطاعم والقوائم والعروض المتاحة، أضف الأصناف إلى السلة، أكد طلبك بالدفع النقدي عند التسليم، وتابع انتقال الطلب من المطعم حتى بابك. يحصل المطعم على مسار منظم لقبول الطلب وتجهيزه، ويحصل المندوب المعتمد على مهام التوصيل وحالاتها، بينما توفر لوحة الإدارة أدوات الموافقة والدعم والتدقيق. الإشعارات الفورية داخل التطبيق تبقي كل طرف على اطلاع، مع حماية الحسابات والصلاحيات حسب الدور.

English full description:

> TasawaQ connects customers, restaurants, and delivery drivers in one clear experience. Browse available restaurants, menus, and offers; build a cart; place a cash-on-delivery order; and follow its progress from the restaurant to your door. Restaurants receive an organized preparation workflow, approved drivers manage delivery tasks and statuses, and administrators have approval, support, and audit tools. Realtime in-app updates keep every role informed while server-enforced permissions protect each account.

## URLs and declarations required before submission

- Privacy policy URL: publish `docs/privacy-policy.md` at a stable public HTTPS URL.
- Terms URL: publish `docs/terms-of-service.md` at a stable public HTTPS URL.
- Support URL and support email: supply operator-owned values.
- Data Safety/App Privacy answers: phone/name, delivery address, order history, diagnostics, and account identifiers are collected to provide the app; declare encryption in transit and the operator's deletion-request process. Continuous location, advertising IDs, contacts, photos, microphone, and payment-card data are not collected by this release.
- Content rating: food ordering/commerce; no user-generated public social content.
- Demo review account: create a dedicated non-production customer account; never submit the development seed credentials.

## Visual assets

- Store icon master: `apps/mobile/assets/store/app-icon-1024.png` (1024×1024 PNG).
- Existing native Android launcher assets remain in `android/app/src/main/res/mipmap-*`.
- Capture screenshots from a release/preview build using seeded staging data, never production customer data. Required set: login, customer restaurant catalog, menu/cart, order tracking, restaurant incoming order, driver delivery, and admin dashboard.
- Google Play feature graphic and final phone/tablet screenshot sizes should be exported only after the store account confirms the current required dimensions. Keep text within safe margins and use the exact TasawaQ mark.

The icon master was generated from the established Android launcher reference using the built-in image generation workflow, then resized deterministically to the required 1024×1024 master. Prompt: preserve the supplied TasawaQ cart/globe mark, exact Arabic/Latin wordmark, blue/teal/green palette, light background, and safe square padding; add no symbols, text, frame, rounded corners, or watermark.
