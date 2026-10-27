import assert from "node:assert/strict";
import { createHash, createHmac, pbkdf2Sync } from "node:crypto";
import { describe, it } from "node:test";
import { backupRoleName, backupRoleStatements, scramSha256Verifier } from "./create-backup-role.mjs";
import {
  ageRecipients,
  backupObjectKeys,
  compareCounts,
  latestDumpKey,
  manifestKeyFor,
  ping,
  quoteIdentifier,
  redact
} from "./lib.mjs";

const publicKey = `age1${"q".repeat(58)}`;

describe("backup object names", () => {
  it("are new per run, dated, and pair each dump with its manifest", () => {
    const keys = backupObjectKeys("jovo/", new Date("2026-10-27T03:00:05.123Z"));
    assert.equal(keys.dump, "jovo/2026/10/jovo-2026-10-27T03-00-05-123Z.dump.age");
    assert.equal(keys.manifest, "jovo/2026/10/jovo-2026-10-27T03-00-05-123Z.manifest.json.age");
    assert.equal(manifestKeyFor(keys.dump), keys.manifest);
    assert.throws(() => manifestKeyFor("jovo/2026/10/other.txt"), /Not a backup dump/);
  });

  it("finds the newest dump among listed keys", () => {
    const keys = [
      backupObjectKeys("jovo", new Date("2026-10-27T03:00:00Z")).dump,
      backupObjectKeys("jovo", new Date("2026-11-01T03:00:00Z")).manifest,
      backupObjectKeys("jovo", new Date("2026-10-31T03:00:00Z")).dump
    ];
    assert.equal(latestDumpKey(keys), "jovo/2026/10/jovo-2026-10-31T03-00-00-000Z.dump.age");
    assert.equal(latestDumpKey([]), null);
  });
});

describe("row-count comparison", () => {
  it("is empty when every table matches and names each difference otherwise", () => {
    assert.deepEqual(compareCounts({ User: 2, Order: 0 }, { Order: 0, User: 2 }), []);
    assert.deepEqual(compareCounts({ User: 2, Order: 5, Gone: 1 }, { User: 2, Order: 4, Extra: 0 }), [
      { table: "Extra", expected: null, actual: 0 },
      { table: "Gone", expected: 1, actual: null },
      { table: "Order", expected: 5, actual: 4 }
    ]);
  });

  it("quotes table names safely", () => {
    assert.equal(quoteIdentifier("User"), '"User"');
    assert.equal(quoteIdentifier('we"ird'), '"we""ird"');
  });
});

describe("age recipients", () => {
  it("accepts public keys and refuses a secret key or anything else", () => {
    assert.deepEqual(ageRecipients(`${publicKey}, ${publicKey}`), [publicKey, publicKey]);
    assert.throws(() => ageRecipients(""), /at least one/);
    assert.throws(() => ageRecipients(`AGE-SECRET-KEY-1${"Q".repeat(58)}`), /SECRET key/);
    assert.throws(() => ageRecipients("ssh-ed25519 AAAA"), /age public keys/);
  });
});

describe("healthchecks pings", () => {
  it("uses /start, the bare URL and /fail, and redacts the body", async () => {
    const calls = [];
    const fake = async (url, init) => {
      calls.push({ url, body: init.body });
      return { ok: true };
    };
    await ping("https://hc-ping.com/abc/", "start", "", fake);
    await ping("https://hc-ping.com/abc", "success", "ok", fake);
    await ping("https://hc-ping.com/abc", "fail", "connect postgresql://jovo_backup:hunter2@db:5432/x failed", fake);
    assert.deepEqual(calls.map((call) => call.url), ["https://hc-ping.com/abc/start", "https://hc-ping.com/abc", "https://hc-ping.com/abc/fail"]);
    assert.ok(!calls[2].body.includes("hunter2"));
  });

  it("never throws, and does nothing without a URL", async () => {
    assert.equal(await ping("", "success"), false);
    assert.equal(await ping("https://hc-ping.com/abc", "fail", "x", async () => { throw new Error("offline"); }), false);
  });
});

describe("redaction", () => {
  it("removes database passwords, age secret keys and key=value secrets", () => {
    const text = redact(`postgres://u:p4ss@h/db AGE-SECRET-KEY-1ABC password=abc BACKUP_S3_SECRET_ACCESS_KEY: xyz`);
    for (const secret of ["p4ss", "1ABC", "=abc", "xyz"]) assert.ok(!text.includes(secret), `${secret} leaked: ${text}`);
  });
});

describe("backup role", () => {
  it("builds a PostgreSQL SCRAM-SHA-256 verifier that matches the RFC 7677 derivation", () => {
    const salt = Buffer.from("0123456789abcdef");
    const verifier = scramSha256Verifier("correct horse", salt, 4096);
    const salted = pbkdf2Sync("correct horse", salt, 4096, 32, "sha256");
    const stored = createHash("sha256").update(createHmac("sha256", salted).update("Client Key").digest()).digest("base64");
    const server = createHmac("sha256", salted).update("Server Key").digest("base64");
    assert.equal(verifier, `SCRAM-SHA-256$4096:${salt.toString("base64")}$${stored}:${server}`);
    assert.ok(!verifier.includes("correct horse"));
  });

  it("is read-only, limited, and never a superuser", () => {
    const sql = backupRoleStatements("railway", "SCRAM-SHA-256$4096:c2FsdA==$a:b").join("\n");
    assert.match(sql, new RegExp(`CREATE ROLE "${backupRoleName}"`));
    assert.match(sql, /NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/);
    assert.match(sql, /CONNECTION LIMIT 3/);
    assert.match(sql, /GRANT pg_read_all_data/);
    assert.match(sql, /default_transaction_read_only = on/);
    assert.doesNotMatch(sql, /pg_write_all_data|SUPERUSER(?! )|GRANT ALL/);
  });
});

describe("redaction precision", () => {
  it("leaves ordinary messages readable", () => {
    const message = 'reading "/keys/identity.txt": failed to open file: no such file or directory';
    assert.equal(redact(message), message);
    assert.equal(redact('{"password":"abc"}').includes("abc"), false);
  });
});
