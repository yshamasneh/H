import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeArabicText } from "./arabic-normalize";

test("unifies every alef form to the bare alef", () => {
  assert.equal(normalizeArabicText("أحمد"), normalizeArabicText("احمد"));
  assert.equal(normalizeArabicText("إبراهيم"), normalizeArabicText("ابراهيم"));
  assert.equal(normalizeArabicText("آلة"), normalizeArabicText("الة"));
  assert.equal(normalizeArabicText("ٱلرحمن"), normalizeArabicText("الرحمن"));
});

test("normalizes taa marbuta to haa", () => {
  assert.equal(normalizeArabicText("مدرسة"), normalizeArabicText("مدرسه"));
});

test("strips tashkeel (diacritics) without touching the base letters", () => {
  assert.equal(normalizeArabicText("حَلِيب"), "حليب");
  assert.equal(normalizeArabicText("مُحَمَّد"), normalizeArabicText("محمد"));
});

test("lower-cases Latin text alongside Arabic, for mixed brand names", () => {
  assert.equal(normalizeArabicText("Coca Cola"), "coca cola");
  assert.equal(normalizeArabicText("JOVO حليب"), "jovo حليب");
});

test("leaves already-normalized Arabic text unchanged", () => {
  assert.equal(normalizeArabicText("حليب طازج"), "حليب طازج");
});
