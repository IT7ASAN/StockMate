(function (root) {
  "use strict";
  const digitRanges = /[٠-٩۰-۹]/g;
  function normalize(value) {
    return String(value == null ? "" : value)
      .normalize("NFKC")
      .replace(digitRanges, digit => String.fromCharCode(48 + (digit.charCodeAt(0) >= 0x06f0 ? digit.charCodeAt(0) - 0x06f0 : digit.charCodeAt(0) - 0x0660)))
      .trim();
  }
  function isDigits(value) { return /^[0-9]+$/.test(String(value)); }
  function validGs1CheckDigit(value) {
    const code = String(value);
    if (!isDigits(code) || code.length < 2) return false;
    let sum = 0, weight = 3;
    for (let index = code.length - 2; index >= 0; index -= 1) {
      sum += (code.charCodeAt(index) - 48) * weight;
      weight = weight === 3 ? 1 : 3;
    }
    const expected = String.fromCharCode(48 + ((10 - (sum % 10)) % 10));
    return code[code.length - 1] === expected;
  }
  function expandUpcE(value) {
    const code = String(value);
    if (code.length !== 8 || !isDigits(code) || !/^[01]$/.test(code[0])) return "";
    const ns = code[0], a = code[1], b = code[2], c = code[3], d = code[4], e = code[5], f = code[6], check = code[7];
    let body;
    if (f <= "2") body = ns + a + b + f + "0000" + c + d + e;
    else if (f === "3") body = ns + a + b + c + "00000" + d + e;
    else if (f === "4") body = ns + a + b + c + d + "00000" + e;
    else body = ns + a + b + c + d + e + "0000" + f;
    return body + check;
  }
  function checkDigitStatus(value, format) {
    const code = normalize(value), kind = String(format || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (kind === "ean13" || kind === "ean8" || kind === "upca" || kind === "upce") {
      const expected = kind === "ean13" ? 13 : kind === "upca" ? 12 : 8;
      if (code.length !== expected || !isDigits(code)) return false;
      return validGs1CheckDigit(kind === "upce" ? expandUpcE(code) : code);
    }
    return null;
  }
  function unwrapExcelText(value) {
    const text = String(value == null ? "" : value).trim();
    const match = text.match(/^=\s*"((?:[^"]|"")*)"$/);
    return match ? match[1].replace(/""/g, '"') : text;
  }
  const api = { normalize, isDigits, checkDigitStatus, unwrapExcelText };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.StockMateBarcode = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
