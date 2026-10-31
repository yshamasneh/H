# Placeholder checklist (consolidated)

Every `[[PLACEHOLDER: …]]` still visible in the store and review texts, generated from the files on `store-remediation-2`. Fill each value once, then replace it everywhere it is used (Markdown **and** the generated `docs/store/site/*.html`). Nothing here was invented; each value needs the owner or a lawyer.

| ID | What is needed | Placeholder text(s) | Where it is used (file × count) |
|---|---|---|---|
| P1 | Operator legal name — must match the developer/seller name on both stores | `الاسم القانوني للجهة المشغلة`; `operator legal name` | `docs/store/privacy-policy.md` ×2<br>`docs/store/site/privacy.html` ×2<br>`docs/store/site/terms.html` ×2<br>`docs/store/terms-of-service.md` ×2 |
| P2 | Legal address | `العنوان القانوني`; `legal address` | `docs/store/privacy-policy.md` ×2<br>`docs/store/site/privacy.html` ×2 |
| P3 | Privacy email (working mailbox) | `بريد الخصوصية`; `privacy email` | `docs/store/delete-account.md` ×2<br>`docs/store/privacy-policy.md` ×4<br>`docs/store/site/delete-account.html` ×2<br>`docs/store/site/privacy.html` ×4 |
| P4 | Support email (working mailbox; may equal P3) | `support email`; `بريد الدعم` | `docs/release-readiness/reviewer-access-guide.md` ×1<br>`docs/store/site/delete-account.html` ×2<br>`docs/store/site/privacy.html` ×2<br>`docs/store/site/support.html` ×4<br>`docs/store/site/terms.html` ×4<br>`docs/store/store-listing.md` ×2<br>`docs/store/support.md` ×2<br>`docs/store/terms-of-service.md` ×2 |
| P5 | Support phone or WhatsApp | `رقم هاتف الدعم`; `support phone` | `docs/store/privacy-policy.md` ×2<br>`docs/store/site/privacy.html` ×2<br>`docs/store/site/support.html` ×2<br>`docs/store/site/terms.html` ×2<br>`docs/store/store-listing.md` ×1<br>`docs/store/support.md` ×2<br>`docs/store/terms-of-service.md` ×2 |
| P6 | Support hours | `ساعات الدعم`; `support hours` | `docs/store/site/support.html` ×2<br>`docs/store/support.md` ×2 |
| P7 | Town / service area name | `town`; `اسم البلدة`; `town / radius`; `اسم البلدة / منطقة الخدمة`; `town / service area` | `docs/release-readiness/reviewer-access-guide.md` ×2<br>`docs/release-readiness/technical-analyses.md` ×1<br>`docs/store/privacy-policy.md` ×2<br>`docs/store/site/privacy.html` ×2<br>`docs/store/site/support.html` ×4<br>`docs/store/site/terms.html` ×2<br>`docs/store/store-listing.md` ×4<br>`docs/store/support.md` ×4<br>`docs/store/terms-of-service.md` ×2 |
| P8 | Delivery radius in km — must equal DELIVERY_MAX_DISTANCE_METERS on the API (the guest home now shows the API value) | `radius`; `نصف القطر`; `نصف قطر التوصيل بالكيلومتر`; `delivery radius in km` | `docs/release-readiness/reviewer-access-guide.md` ×2<br>`docs/store/site/support.html` ×2<br>`docs/store/site/terms.html` ×2<br>`docs/store/store-listing.md` ×3<br>`docs/store/support.md` ×2<br>`docs/store/terms-of-service.md` ×2 |
| P9 | Minimum age (suggested 18; owner decision) | `minimum age`; `الحد الأدنى للعمر` | `docs/store/play-console-declarations.md` ×1<br>`docs/store/privacy-policy.md` ×2<br>`docs/store/site/privacy.html` ×2<br>`docs/store/site/terms.html` ×2<br>`docs/store/terms-of-service.md` ×2 |
| P10 | Accounting record retention period (legal advice) | `مدة الاحتفاظ بالسجلات المحاسبية`; `accounting record retention period` | `docs/store/delete-account.md` ×2<br>`docs/store/privacy-policy.md` ×2<br>`docs/store/site/delete-account.html` ×2<br>`docs/store/site/privacy.html` ×2 |
| P11 | Backup retention period (must match the Backblaze lifecycle) | `مدة الاحتفاظ بالنسخ الاحتياطية`; `backup retention period` | `docs/store/delete-account.md` ×2<br>`docs/store/privacy-policy.md` ×2<br>`docs/store/site/delete-account.html` ×2<br>`docs/store/site/privacy.html` ×2 |
| P12 | Scheduled driver deletion delay in days (default 30 = ACCOUNT_DELETION_SCHEDULE_DAYS) | `عدد الأيام، الافتراضي 30 يومًا`; `number of days, default 30` | `docs/store/delete-account.md` ×2<br>`docs/store/privacy-policy.md` ×2<br>`docs/store/site/delete-account.html` ×2<br>`docs/store/site/privacy.html` ×2 |
| P13 | Days to complete a web deletion request | `عدد أيام تنفيذ الطلب`; `number of days to complete a request` | `docs/store/delete-account.md` ×2<br>`docs/store/site/delete-account.html` ×2 |
| P14 | Governing law and competent courts (legal advice) | `القانون المطبّق`; `governing law`; `المحاكم المختصة`; `competent courts` | `docs/store/privacy-policy.md` ×2<br>`docs/store/site/privacy.html` ×2<br>`docs/store/site/terms.html` ×6<br>`docs/store/terms-of-service.md` ×6 |
| P15 | Cancellation and refund policy | `سياسة الإلغاء والاسترجاع`; `cancellation and refund policy` | `docs/store/site/terms.html` ×2<br>`docs/store/terms-of-service.md` ×2 |
| P16 | Limitation-of-liability clause (after legal review) | `بند حدود المسؤولية بعد المراجعة القانونية`; `limitation-of-liability clause after legal review` | `docs/store/site/terms.html` ×2<br>`docs/store/terms-of-service.md` ×2 |
| P17 | Error-tracking provider name (server, and app if EXPO_PUBLIC_ERROR_REPORT_URL is set) | `مزوّد تتبّع أخطاء الخادم`; `server error-tracking provider` | `docs/store/privacy-policy.md` ×2<br>`docs/store/site/privacy.html` ×2 |
| P18 | Publication date of the legal pages | `تاريخ النشر`; `publication date` | `docs/store/privacy-policy.md` ×2<br>`docs/store/site/privacy.html` ×2<br>`docs/store/site/terms.html` ×2<br>`docs/store/terms-of-service.md` ×2 |
| P19 | Demo account phone numbers you control, and a safe in-zone demo address | `+970 number you control`; `a safe address inside the zone` | `docs/release-readiness/reviewer-access-guide.md` ×2 |
| P20 | Developer name exactly as on the store accounts | `developer name exactly as on the store accounts` | `docs/store/store-listing.md` ×1 |
| P21 | Contact email for the geocoder User-Agent (GEOCODER_USER_AGENT) | `contact email` | `docs/release-readiness/technical-analyses.md` ×2 |
| — | Instruction line only ("every placeholder must be filled") | `...` | `docs/store/privacy-policy.md` ×1<br>`docs/store/terms-of-service.md` ×1 |

Unmapped placeholder texts: none.

## Order to fill

1. Business facts (P1, P2, P5–P8, P20) and mailboxes (P3, P4).
2. Legal decisions with a lawyer (P9–P11, P13–P16, P18).
3. Technical choices (P12, P17, P19, P21).
4. Regenerate or hand-edit `docs/store/site/*.html`, then host the four pages (R8).
