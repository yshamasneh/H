/**
 * Prints which variables are still missing before NODE_ENV=production can be switched on.
 * Names only; never values. Reads the current process environment (run it where the API runs, e.g.
 * `railway run npx tsx scripts/production-selfcheck.ts`, or locally with an env file).
 * Exit code 0 when ready, 1 when not.
 */
import { formatSelfCheck, productionSelfCheck } from "../src/config/production-selfcheck";

const result = productionSelfCheck(process.env as Record<string, unknown>);
console.log(formatSelfCheck(result));
process.exit(result.readyForProduction ? 0 : 1);
