# Security policy

## Supported version

Security fixes are applied to the current `main` branch and the latest deployed release candidate. Older development snapshots are unsupported.

## Report a vulnerability

Use the repository's **Security → Report a vulnerability** private advisory flow. Do not open a public issue and do not include real customer data, production tokens, OTP values, TLS private keys, or database exports.

Include the affected endpoint/component, impact, minimal reproduction steps, and any request ID that helps correlate sanitized logs. The operator should acknowledge a report within 3 business days, provide an initial assessment within 7 business days, and coordinate disclosure after a fix is available. These targets may change for complex or third-party issues.

For urgent active exploitation, use the private operational incident contact configured by the deployment owner in addition to the advisory.
