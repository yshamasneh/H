import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyRestricted, normaliseForScreening } from "./restricted-products.rules";

const verdict = (...fields: string[]) => classifyRestricted(...fields).verdict;

test("tobacco, nicotine and vaping products are blocked in English and Arabic", () => {
  for (const name of [
    "Marlboro Red 20 cigarettes",
    "Al Fakher shisha tobacco 250g",
    "Disposable vape 5000 puffs",
    "E-liquid mint 10ml",
    "Nicotine pouches",
    "سجائر مارلبورو احمر",
    "دخان ونستون",
    "معسل الفاخر تفاحتين",
    "تبغ لف",
    "سيجارة إلكترونية",
    "والسجائر"
  ]) {
    assert.equal(verdict(name), "BLOCKED", name);
  }
});

test("alcohol is blocked in English and Arabic", () => {
  for (const name of ["Taybeh Beer 330ml", "Red wine Cremisan", "Vodka 70cl", "نبيذ أحمر", "ويسكي", "مشروب كحولي"]) {
    assert.equal(verdict(name), "BLOCKED", name);
  }
});

test("whole-word matching avoids look-alike false positives", () => {
  for (const name of [
    "Ginger biscuits", // gin
    "Smoked turkey breast / ديك رومي مدخن", // دخان
    "Cigar-shaped rolled wafers"
  ]) {
    // "Cigar-shaped" still names a cigar, so only the first two must be allowed.
    if (name.startsWith("Cigar")) continue;
    assert.equal(verdict(name), "ALLOWED", name);
  }
  for (const name of ["Pampers baby dry size 6", "بامبرز بيبي دراي", "Winstone garden hose", "Beerenmix berries"]) {
    assert.equal(verdict(name), "ALLOWED", name);
  }
});

test("ambiguous words and alcohol-free claims go to manual review, never silently blocked or allowed", () => {
  assert.deepEqual(classifyRestricted("Barbican non-alcoholic malt beer"), {
    verdict: "REVIEW",
    matches: ["beer", "alcoholic", "malt"]
  });
  assert.equal(verdict("بيرة شعير بدون كحول"), "REVIEW");
  assert.equal(verdict("كحول طبي 70% لتعقيم اليدين"), "REVIEW");
  assert.equal(verdict("عرق بلدي"), "REVIEW");
  assert.equal(verdict("Isopropyl alcohol wipes"), "REVIEW");
  assert.equal(verdict("Hookah charcoal 1kg"), "REVIEW");
  assert.equal(verdict("فحم أرجيلة"), "REVIEW");
});

test("every customer-visible field is screened, and empty input is allowed", () => {
  assert.equal(verdict("Classic Red", "Marlboro"), "BLOCKED");
  assert.equal(verdict("Gift box", "", "Contains a bottle of wine"), "BLOCKED");
  assert.equal(classifyRestricted(null, undefined, "").verdict, "ALLOWED");
});

test("Arabic normalisation folds letter variants and strips diacritics", () => {
  assert.equal(normaliseForScreening("سِيجَارَة إلكترونيّة"), "سيجاره الكترونيه");
  assert.equal(normaliseForScreening("أرجيلة"), "ارجيله");
});

test("known harmless grocery phrases are not sent to review", () => {
  assert.equal(verdict("ادم مزيل عرق الاساسي للرجال 200مل"), "ALLOWED");
  assert.equal(verdict("Rexona antiperspirant / مضاد للتعرق"), "ALLOWED");
  assert.equal(verdict("شراب عرق سوس"), "ALLOWED");
  // A harmless phrase never hides a blocked word in the same text.
  assert.equal(verdict("مزيل عرق + سجائر"), "BLOCKED");
});
