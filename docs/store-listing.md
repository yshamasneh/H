# Store listing package

Release candidate: `0.13.0` (`versionCode`/`buildNumber` 13 before store-managed auto-increment)

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

> TasawaQ connects customers, restaurants, supermarkets, and delivery drivers in one clear experience. Browse restaurants and menus or search supermarket departments and products; build a cart; place a cash-on-delivery order; and follow its progress to your door. Store owners receive an organized catalog and preparation workflow, approved drivers manage delivery tasks and statuses, and administrators control approvals and offers. Realtime in-app updates keep every role informed while server-enforced permissions protect each account.

## URLs and declarations required before submission

- Privacy policy URL: publish `docs/privacy-policy.md` at a stable public HTTPS URL.
- Terms URL: publish `docs/terms-of-service.md` at a stable public HTTPS URL.
- Support URL and support email: supply operator-owned values.
- Data Safety/App Privacy answers: phone/name, delivery address, precise location selected on demand, order history, diagnostics, and account identifiers are collected to provide the app; declare encryption in transit and the operator's deletion-request process. Location is requested only when a customer calculates delivery or an owner sets a restaurant pin; continuous/background location, advertising IDs, contacts, photos, microphone, and payment-card data are not collected by this release.
- Content rating: food ordering/commerce; no user-generated public social content.
- Demo review account: create a dedicated non-production customer account; never submit the development seed credentials.

## Visual assets

- Store icon master: `apps/mobile/assets/store/app-icon-1024.png` (1024×1024 PNG).
- Existing native Android launcher assets remain in `android/app/src/main/res/mipmap-*`.
- Capture screenshots from a release/preview build using seeded staging data, never production customer data. Required set: login, restaurant catalog, supermarket catalog/search, grocery product details, cart/checkout, customer replacement review, order tracking, store fulfillment/inventory, driver delivery, admin offers, and admin dashboard.
- Google Play feature graphic and final phone/tablet screenshot sizes should be exported only after the store account confirms the current required dimensions. Keep text within safe margins and use the exact TasawaQ mark.

The icon master was generated from the established Android launcher reference using the built-in image generation workflow, then resized deterministically to the required 1024×1024 master. Prompt: preserve the supplied TasawaQ cart/globe mark, exact Arabic/Latin wordmark, blue/teal/green palette, light background, and safe square padding; add no symbols, text, frame, rounded corners, or watermark.
