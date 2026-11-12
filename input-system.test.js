"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const input = require("../input-system.js");

test("normalizes Arabic and Persian digits and decimal punctuation", () => {
  assert.equal(input.normalizeNumeric("١٢٣٫٥"), "123.5");
  assert.equal(input.normalizeNumeric("۱۲۳٬۵"), "1235");
});
test("inserts at a middle selection without losing neighboring digits", () => {
  assert.deepEqual(input.replaceSelection("1234", 2, 2, "9"), { value: "12934", caret: 3 });
});
test("replaces a selection and deletes backward or forward at the caret", () => {
  assert.deepEqual(input.replaceSelection("1234", 1, 3, "8"), { value: "184", caret: 2 });
  assert.deepEqual(input.deleteSelection("1234", 2, 2, "backward"), { value: "134", caret: 1 });
  assert.deepEqual(input.deleteSelection("1234", 2, 2, "forward"), { value: "124", caret: 2 });
});
test("accepts decimal money and rejects fractional piece counts", () => {
  assert.equal(input.validateNumericValue("12.50", { min: "0", step: "any" }), "");
  assert.equal(input.validateNumericValue("12.5", { min: "0", step: "1" }), "step");
  assert.equal(input.validateNumericValue("12", { min: "1", step: "1" }), "");
});
test("checks required, bounds, patterns, and fractional step", () => {
  assert.equal(input.validateNumericValue("", { required: true }), "required");
  assert.equal(input.validateNumericValue("0", { min: "1", step: "1" }), "min");
  assert.equal(input.validateNumericValue("8", { max: "6", step: "1" }), "max");
  assert.equal(input.validateNumericValue("12.5", { pattern: "[0-9]*", step: "any" }), "pattern");
  assert.equal(input.validateNumericValue("1.25", { min: "0", step: "0.25" }), "");
  assert.equal(input.validateNumericValue("1.2", { min: "0", step: "0.25" }), "step");
});
test("respects field maximum length", () => {
  assert.deepEqual(input.replaceSelection("12", 2, 2, "345", 4), { value: "1234", caret: 4 });
});

test("clears a selected value completely", () => {
  assert.deepEqual(input.replaceSelection("12345", 0, 5, ""), { value: "", caret: 0 });
});
test("validates Arabic digits against an ASCII barcode pattern after normalization", () => {
  assert.equal(input.validateNumericValue("١٢٣٤٥", { pattern: "[0-9]*", step: "1" }), "");
});
