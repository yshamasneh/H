# Production dependency security review

Review date: 2026-09-18  
Scope: `npm audit --omit=dev` at the monorepo root (all npm workspaces)

## Result

`npm audit` counts affected package nodes, so propagated parent findings are counted in addition to the vulnerable leaf package. The production-tree baseline was **0 critical, 22 high, 14 moderate, 0 low (36 total)**: 7 direct and 15 transitive high package nodes. After compatible updates it is **0 critical, 11 high, 14 moderate, 0 low (25 total)**: 2 direct and 9 transitive high package nodes.

No framework major was changed. The remaining high package nodes are two advisory roots propagated through Expo/Metro and Prisma tooling; both require an incompatible major dependency change in the current upstream graph.

## Critical and high advisory paths

| Advisory | Dependency path / workspace | Baseline | Resolution | Production reachability |
| --- | --- | --- | --- | --- |
| GHSA-wc9g-mqfw-jrwm, GHSA-qfvm-cv95-jqjf, GHSA-535w-7cp7-47q4 | `@wasel/api > @nestjs/platform-express > multer` | `multer@2.2.0` | Overridden within major to `2.4.0`; affected path is gone. | Nest's HTTP adapter is production runtime, although no Multer interceptor/upload endpoint is currently implemented. |
| GHSA-3f6p-5ww8-9rcr | `@wasel/api > @prisma/client > prisma > mysql2` | `mysql2@3.15.3` | Overridden within major to `3.24.4`; affected path is gone. | Not request-runtime reachable: the application uses PostgreSQL; `mysql2` is a Prisma CLI dependency. |
| GHSA-5jgf-p345-68v8, GHSA-f65p-4m7j-42xc, GHSA-fph4-wmhf-6fwf, GHSA-jqff-g426-hqxp | `@wasel/mobile > expo-dev-client > expo-dev-launcher > ajv > fast-uri` | `fast-uri@3.1.5` | Updated within declared range to `3.1.8`; affected path is gone. | Development-client/config tooling, not application request handling. |
| GHSA-2883-xcg3-v3hh | Expo CLI and React Native test-tool paths to `js-yaml` | `4.3.1` and `3.15.1` | Updated within declared ranges to `4.3.2` and `3.15.2`; affected paths are gone. | Build/test tooling only. `@nestjs/swagger` already resolves unaffected `js-yaml@5.3.0`. |
| GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849 | `@wasel/mobile > expo > @expo/metro-config > postcss` | `postcss@8.4.49` | Overridden within major to `8.5.28`; affected path is gone. | Metro build tooling; source maps/CSS inputs are repository-controlled. |
| GHSA-6mj3-qw4j-hgrw, GHSA-g53g-w8rj-fmg7, GHSA-w2rr-34g9-rvrj, GHSA-4w3w-2rp5-g8jm, GHSA-c7q8-3ch8-vqpv, GHSA-27p8-2357-5qqv, GHSA-3px3-54cx-rmw9, GHSA-vr34-hp96-76pp, GHSA-8344-3jmq-59r6, GHSA-x4fp-j954-r2f4, GHSA-965w-775f-mr7g, GHSA-93r5-fhx6-vmg9 | Expo plist/config paths to `@xmldom/xmldom` | `0.8.13` and `0.9.10` | Updated within declared ranges to `0.8.15` and `0.9.12`; affected paths are gone. | Expo update/native configuration tooling; no application-controlled XML parsing was found. |
| GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq | `@wasel/mobile > expo > @expo/metro > metro@0.83.3 > image-size@1.2.1` | Vulnerable | **Unresolved.** The fixed line is `image-size@2.0.3+`; Metro 0.83.3 requires `^1.0.2`, and Expo SDK 54 pins this Metro set. Forcing the major would break Metro's callable default-export API. | Metro processes repository assets during bundling. It is not shipped as a native request-processing service; restrict build inputs to reviewed repository assets. Upgrade with an Expo SDK/Metro release that removes or updates this dependency. Risk: accepted build-time high pending framework upgrade. |
| GHSA-ggr8-5vv4-36mx | `@wasel/api > @prisma/client > prisma@7.9.1 > @prisma/config > deepmerge-ts@7.1.5` | Vulnerable | **Unresolved.** The patched package is `deepmerge-ts@8+`, while Prisma 7.9/7.10 pins 7.1.5. npm's proposed remediation is a Prisma major-line change/downgrade, which is outside this round and was not applied. | Prisma configuration/CLI tooling, not an API request data path. Do not load untrusted recursive objects into Prisma configuration; adopt an upstream Prisma release using `deepmerge-ts@8+`. Risk: accepted tooling high pending upstream-compatible upgrade. |

The direct high nodes remaining after remediation are `expo` and `prisma`; they are propagation from the two unresolved transitive advisory roots above, not separate advisory sources. Their associated Expo/Metro and Prisma config parent nodes account for the other nine high package nodes.

## Other compatible updates

- `qs` moved from `6.15.3` to `6.16.0`, removing the reported request-parser advisories from the Express production path.
- The lockfile was reviewed: removals are dependencies no longer needed by patched `multer`/`mysql2`; the only added cross-platform package is optional macOS `fsevents`. No framework or direct application package was replaced.

## Verification

- API typecheck, 396 tests (393 passed, 3 database-gated skipped), build, and Prisma validation passed.
- Mobile typecheck, unit/UI tests, and unsigned Android/iOS/Web export passed. Existing non-failing React `act(...)` warnings remain unchanged.
- Expo Doctor remained `17/17` on Expo SDK 54.
- `npm audit --omit=dev` improved from 36 to 25 affected package nodes and still exits non-zero because the two explicitly unresolved advisory roots remain.

This review is dependency triage, not a claim of production readiness. Future Expo/Metro and Prisma upgrades must rerun the full compatibility and database test matrix.
