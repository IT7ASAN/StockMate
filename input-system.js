(function () {
  "use strict";
  const ar = "٠١٢٣٤٥٦٧٨٩", fa = "۰۱۲۳۴۵۶۷۸۹";

  function normalizeNumeric(value) {
    return String(value == null ? "" : value)
      .replace(/[٠-٩]/g, d => String(ar.indexOf(d)))
      .replace(/[۰-۹]/g, d => String(fa.indexOf(d)))
      .replace(/\u066B/g, ".").replace(/\u066C/g, "");
  }
  function replaceSelection(value, start, end, inserted, maxLength) {
    const source = String(value == null ? "" : value);
    const left = Math.max(0, Math.min(source.length, Number(start) || 0));
    const right = Math.max(left, Math.min(source.length, Number(end) || left));
    const text = normalizeNumeric(inserted);
    let next = source.slice(0, left) + text + source.slice(right);
    if (Number.isFinite(maxLength) && maxLength >= 0 && next.length > maxLength) next = next.slice(0, maxLength);
    return { value: next, caret: Math.min(next.length, left + text.length) };
  }
  function deleteSelection(value, start, end, direction) {
    const source = String(value == null ? "" : value);
    let left = Math.max(0, Math.min(source.length, Number(start) || 0));
    let right = Math.max(left, Math.min(source.length, Number(end) || left));
    if (left === right) {
      if (direction === "forward") right = Math.min(source.length, right + 1);
      else left = Math.max(0, left - 1);
    }
    return { value: source.slice(0, left) + source.slice(right), caret: left };
  }
  function validateNumericValue(value, options) {
    const c = options || {}, raw = normalizeNumeric(value).trim();
    if (!raw) return c.required ? "required" : "";
    if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw) || !Number.isFinite(Number(raw))) return "format";
    if (c.pattern) {
      try { if (!(new RegExp("^(?:" + c.pattern + ")$", "u")).test(raw)) return "pattern"; } catch (_) {}
    }
    const n = Number(raw);
    const min = c.min == null || c.min === "" ? null : Number(c.min);
    const max = c.max == null || c.max === "" ? null : Number(c.max);
    if (min != null && n < min) return "min";
    if (max != null && n > max) return "max";
    const step = c.step == null || c.step === "" ? "1" : String(c.step);
    if (step !== "any") {
      const valueStep = Number(step), base = min != null ? min : (c.base == null || c.base === "" ? 0 : Number(c.base));
      if (valueStep > 0 && Number.isFinite(valueStep) && Number.isFinite(base)) {
        const ratio = (n - base) / valueStep;
        if (Math.abs(ratio - Math.round(ratio)) > 1e-8 * Math.max(1, Math.abs(ratio))) return "step";
      }
    }
    return "";
  }

  const core = { normalizeNumeric, replaceSelection, deleteSelection, validateNumericValue };
  if (typeof module === "object" && module.exports) module.exports = core;
  if (typeof globalThis !== "undefined") globalThis.StockMateInputCore = core;
})();
