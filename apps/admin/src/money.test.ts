import assert from "node:assert/strict";
import test from "node:test";
import {
  formatBp,
  formatMinor,
  parseMoneyToMinor,
  parsePercentToBp,
  parsePositiveMoneyToMinor,
  parseWholeNumber,
  toMoneyInput,
  toPercentInput
} from "./money";

test("parses amounts exactly, including the values that break float multiplication", () => {
  // 1.15 * 100 === 114.99999999999999 in IEEE-754; the parser must not go through a float.
  assert.equal(parseMoneyToMinor("1.15"), 115);
  assert.equal(parseMoneyToMinor("0.29"), 29);
  assert.equal(parseMoneyToMinor("4.35"), 435);
  assert.equal(parseMoneyToMinor("150"), 15000);
  assert.equal(parseMoneyToMinor("12.5"), 1250);
  assert.equal(parseMoneyToMinor("0"), 0);
  assert.equal(parseMoneyToMinor(".5"), 50);
});

test("accepts Arabic-Indic digits and the Arabic decimal separator", () => {
  assert.equal(parseMoneyToMinor("١٥٠"), 15000);
  assert.equal(parseMoneyToMinor("١٢٫٥٠"), 1250);
  assert.equal(parseMoneyToMinor("۱۲.۵"), 1250);
  assert.equal(parseMoneyToMinor("12,5"), 1250);
});

test("refuses anything ambiguous rather than guessing", () => {
  for (const bad of ["", " ", "abc", "1.234", "1..2", "1.2.3", "12a", "1e3", "5.", ".", "-", "--5", "0x10"]) {
    assert.equal(parseMoneyToMinor(bad), null, `"${bad}" must be refused`);
  }
});

test("negative amounts only parse when the caller opts in", () => {
  assert.equal(parseMoneyToMinor("-15"), null);
  assert.equal(parseMoneyToMinor("-15", { allowNegative: true }), -1500);
  assert.equal(parseMoneyToMinor("−15.5", { allowNegative: true }), -1550);
});

test("a positive amount excludes zero", () => {
  assert.equal(parsePositiveMoneyToMinor("0"), null);
  assert.equal(parsePositiveMoneyToMinor("0.00"), null);
  assert.equal(parsePositiveMoneyToMinor("0.01"), 1);
});

test("rejects amounts too large to represent exactly", () => {
  assert.equal(parseMoneyToMinor("999999999999999999999"), null);
});

test("parses percentages to basis points within 0..100", () => {
  assert.equal(parsePercentToBp("20"), 2000);
  assert.equal(parsePercentToBp("18.5"), 1850);
  assert.equal(parsePercentToBp("70"), 7000);
  assert.equal(parsePercentToBp("33.34"), 3334);
  assert.equal(parsePercentToBp("100"), 10000);
  assert.equal(parsePercentToBp("100.01"), null);
  assert.equal(parsePercentToBp("-1"), null);
  assert.equal(parsePercentToBp("12.345"), null);
});

test("parses whole numbers only", () => {
  assert.equal(parseWholeNumber("12"), 12);
  assert.equal(parseWholeNumber("١٢"), 12);
  assert.equal(parseWholeNumber("2.5"), null);
  assert.equal(parseWholeNumber("-1"), null);
  assert.equal(parseWholeNumber("0", 1), null);
});

test("formats and round-trips through the text box", () => {
  assert.equal(formatMinor(15000), "150.00");
  assert.equal(formatMinor(-1505), "-15.05");
  assert.equal(formatMinor(5), "0.05");
  assert.equal(formatBp(2000), "20%");
  assert.equal(formatBp(1850), "18.50%");
  for (const minor of [0, 1, 99, 100, 115, 15000, 123456]) {
    assert.equal(parseMoneyToMinor(toMoneyInput(minor)), minor);
  }
  assert.equal(toPercentInput(2000), "20");
  assert.equal(toPercentInput(1850), "18.5");
  for (const bp of [0, 1, 1850, 3334, 7000, 10000]) {
    assert.equal(parsePercentToBp(toPercentInput(bp)), bp);
  }
});
