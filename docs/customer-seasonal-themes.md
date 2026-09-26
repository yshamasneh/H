# Customer header and seasonal themes

The customer adapter layers `normal`, `ramadan`, or `newYear` over the existing persisted Light/Dark setting. Only customer components read this adapter. Admin, driver, partner, shared settings, API, catalog data, offers, prices, and order behavior are unchanged.

The header uses the existing `jovo_mascot_wave_header.png`, which has the same SHA-256 as the supplied `JOVO-squirrel-header-pose.png` (`C21189558212555DCAB77611692097F604B07DD31E563C489C5FB750911F043F`). It is a static React Native Image with no animation or transform. The header has no circular backdrop or simulated OS indicators. Greeting and actual first name are separate; unusually long names ellipsize and keep the full first name as their accessibility label. Header height is 140 px at narrow widths and 154 px at standard widths, with room to grow for accessibility text.

Seasonal colors live in `apps/mobile/src/features/customer/seasonal-theme.ts`. Seasonal backgrounds and borders flow through `useCustomerTheme`; text, surfaces, orange actions, semantic colors, and layout remain based on the existing palette. Static crescents/confetti appear only in the Home header and a separate greeting strip in the promotional area. They have no hit targets and do not cover products or offers.

## Preview locally

Run from the repository root:

```powershell
npm run web --workspace @wasel/mobile -- --port 8082
```

In a **development** web build, open any of these URLs and sign in as a customer:

- `http://localhost:8082/?customerTheme=normal`
- `http://localhost:8082/?customerTheme=ramadan`
- `http://localhost:8082/?customerTheme=newYear`

Switch Light/Dark in the existing Account → Settings appearance control. Language remains the existing Arabic/English setting. The query parameter survives internal customer navigation; changing its value and reloading changes the preset. It is ignored in production exports.

For native development, set this variable in the terminal **before** starting Expo, then fully reload the app:

```powershell
$env:EXPO_PUBLIC_CUSTOMER_THEME_PREVIEW = 'ramadan' # normal | ramadan | newYear
npm run start --workspace @wasel/mobile
```

Clear the preview variable when finished:

```powershell
Remove-Item Env:EXPO_PUBLIC_CUSTOMER_THEME_PREVIEW -ErrorAction SilentlyContinue
```

The web query takes precedence over the development environment override. An invalid override falls back to the configured preset. Neither override alters the persisted Light/Dark preference.

## Explicit future activation

`EXPO_PUBLIC_CUSTOMER_THEME` is the sole production activation configuration. Accepted, case-sensitive values are `normal`, `ramadan`, and `newYear`. Unset or invalid values resolve to **normal**. There is no date or calendar logic, remote setting, database migration, or automatic holiday detection.

To activate later, explicitly set `EXPO_PUBLIC_CUSTOMER_THEME=ramadan` (or `newYear`) in the environment used to build the customer app, then perform the normal authorized release process. Expo inlines this value at bundle time: changing a server variable alone will not update an installed app. To deactivate, rebuild with `normal` or remove the variable. Production ignores `EXPO_PUBLIC_CUSTOMER_THEME_PREVIEW` and the `customerTheme` URL parameter, even when present. No production configuration was changed for this work.

## Verification and screenshots

[Open the screenshot gallery](customer-theme-previews/index.html). It compares all three presets in both modes, with Arabic/English and 320/390 px selectors, including Home, catalog, product, cart, checkout, orders, and account captures. The 320 px cases deliberately use long first names.

Reproduce the browser checks against the development server:

```powershell
python scripts/preview-customer-themes.py --full
```

This requires Python's `playwright` package and its Chromium browser. The script uses fixed test fixtures for every preset, intercepts all API requests, blocks other external HTTP requests, and redirects external sockets to a closed loopback port. Test fixture product/offer data exists only in the browser script, never in the application. It opens notifications, returns Home, scrolls to products, navigates through catalog/product/cart/checkout, inspects order history and account, and captures screenshots without placing an order. External map tiles are blocked, so maps in these captures do not represent a live map verification.

Checks run:

- Mobile TypeScript (`npm run typecheck --workspace @wasel/mobile`; `lint` uses the same command).
- All 197 mobile unit tests.
- All 19 UI suites / 99 tests, including header action/name/fallback and palette isolation checks.
- Production Expo export for Android, iOS, and web (`npm run build --workspace @wasel/mobile`).
- Native configuration consistency (`npm run check:native-config --workspace @wasel/mobile`).
- Browser matrix: 3 presets × 2 modes × 2 languages × 2 widths, using real React Native Web screens and navigation with intercepted API fixtures.
- The existing Settings switch was exercised on seasonal previews: it persisted the opposite Light/Dark mode and retained the seasonal preset on returning Home.

The browser checks do not replace on-device Android/iOS review. Native status bar rendering, physical safe-area insets, VoiceOver/TalkBack, native font scaling, and real notification delivery were not visually tested. The existing native builds were bundled/exported; an APK/IPA was not compiled or installed. No database changes, deployment, or production settings changes were made.

## Changed files

- `apps/mobile/src/features/customer/home-header.tsx` — responsive static header.
- `apps/mobile/src/features/customer/home-screen.tsx` — header integration, seasonal promotional greeting, active status bar mode.
- `apps/mobile/src/features/customer/seasonal-accent.tsx` — small native static ornaments.
- `apps/mobile/src/features/customer/seasonal-theme.ts` — preset selection and centralized palettes.
- `apps/mobile/src/features/customer/theme.ts` — customer-only adaptation and development preview routing.
- `apps/mobile/src/env.d.ts` — configuration types.
- `apps/mobile/src/i18n/locales/ar/customer.json` and `en/customer.json` — greeting and seasonal translations.
- `apps/mobile/src/features/customer/home-header.ui.test.tsx` and `seasonal-theme.test.ts` — regression coverage.
- `scripts/preview-customer-themes.py` — reproducible browser checks and screenshots.
- `docs/customer-seasonal-themes.md` and `docs/customer-theme-previews/` — configuration, verification notes, screenshot gallery.

The mascot asset was already present as an untracked file and is reused without modification. The reference package, `codexReviewJovo.md`, and `products/` were present before this work and were preserved.
