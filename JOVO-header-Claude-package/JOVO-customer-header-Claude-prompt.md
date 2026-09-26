# Prompt for Claude Code — JOVO customer home header

Repository: https://github.com/yshamasneh/H
Branch: `agent/phase-15-and-jovo-brand`

I want you to implement a new **normal (non-seasonal) customer home top header** in the Expo React Native app. The attached `JOVO-header-light-reference.png` and `JOVO-header-dark-reference.png` show the desired visual direction. Study the actual current code and assets before editing. The package also contains `JOVO-squirrel-header-pose.png`, a transparent-background squirrel in the same waving pose as the header reference, ready for compositing over both themes, and `jovo_mascot_final-original.png` copied from the repository for comparison. These images are **concept mockups only**, not flat assets to paste into the app: they include fake status indicators, a hardcoded name, and proportions that must be adapted to real phone widths. Build the UI from native components and existing brand assets.

## Existing implementation to inspect

- `apps/mobile/src/features/customer/home-screen.tsx`: `CustomerHomeScreen`, `topBar`, `greetingRow`, `brandLockup`, notification button and unread dot.
- `apps/mobile/src/features/customer/theme.ts`, `apps/mobile/src/theme/tokens.ts`, `apps/mobile/src/theme/theme-context.tsx`, `apps/mobile/src/theme/typography.ts`, and RTL/i18n rules.
- `apps/mobile/assets/logo/jovo_mascot_final.png` and `jovo-wordmark.png`; inspect their transparency/visible margins. For the large central mascot, prefer the supplied `JOVO-squirrel-header-pose.png` because the existing mascot file has an opaque white background that would show as a rectangle in dark mode. Copy the transparent asset into the mobile logo assets with an appropriate name and reference it as a local static image. Retain the existing wordmark if it renders legibly in both modes; otherwise render JOVO as accessible themed text. Do not ask an image generator to recreate the squirrel.
- `apps/mobile/src/i18n/locales/ar/customer.json` and `en/customer.json`, especially existing greeting keys.
- `apps/mobile/src/features/customer/bottom-nav.tsx` for the current layout shell.

## Target

Replace only the current separate top notification row and greeting/brand row with a cohesive illustrated header. In Arabic RTL, the personal greeting is on the right, the squirrel is near the center, and JOVO branding plus the notification control are on the left, as in the references. Keep the existing `user.fullName` first-name logic, `onOpenNotifications`, unread badge, accessibility label, theme context, and translations. The current offers, search, store hero, departments, product grid, cart dock and bottom navigation must continue to work and keep their order.

- Light: warm off-white surface, charcoal text, restrained orange accent curve/bottom edge, subtle pale orange halo behind the mascot.
- Dark: use the existing near-black palette, warm-white text, the same JOVO orange brand accent and a subtle dark orange halo. Do not create a second independent theme toggle.
- No Ramadan/New Year decoration in this normal header. The waving pose asset is static for this first implementation. If animation is added later, use a proper sequence of independently drawn frames/rigged animation with transparent background; do not fake a waving paw by rotating the whole character or repeat a single static frame.
- Do not draw a fake clock, battery, cellular or Wi-Fi icons. Let the actual OS status bar and safe area behave normally; set status-bar style/background to match the active light/dark theme.
- Use semantic palette tokens and existing typography/spacing conventions. If a new reusable decoration token is necessary, add it in the appropriate theme layer rather than scattering hardcoded colors.
- Scale the mascot and columns for narrow phones and large text; avoid overlap or clipping for long first names, English LTR mode and RTL mode. Prefer responsive wrapping/truncation with useful accessibility text. Keep the header reasonably compact so the offers and search remain visible near the top. The reference is deliberately exaggerated in height and is not a pixel specification.
- Ensure the notification button remains at least the current practical touch size, visibly tappable, and above decorative elements in hit testing. Decorative artwork should not intercept touches. Keep images accessible appropriately.
- Avoid adding new dependencies or changing backend/admin/API code.

## Verification and delivery

Run mobile typecheck/lint and relevant existing UI tests. Inspect the result at narrow and standard phone widths in light/dark and Arabic/English if the local preview environment supports it. Correct any overlap or contrast issues. Do not hardcode the example name 'محمد'. Summarize changed files, how you verified, and any limits of visual verification. Keep changes scoped to the customer home header. Do not deploy or alter the trial database.
