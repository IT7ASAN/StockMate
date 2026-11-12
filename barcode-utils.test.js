const test = require('node:test');
const assert = require('node:assert/strict');
const barcode = require('../barcode-utils.js');

test('keeps leading zeroes in digit strings', () => {
  const value = barcode.normalize('0637962523829');
  assert.equal(value, '0637962523829');
  assert.equal(typeof value, 'string');
});

test('normalizes Arabic digits without changing the barcode width', () => {
  assert.equal(barcode.normalize('٠٦٣٧٩٦٢٥٢٣٨٢٩'), '0637962523829');
  assert.equal(barcode.normalize('۰۶۳۷۹۶۲۵۲۳۸۲۹'), '0637962523829');
});

test('preserves alphanumeric Code 128 and Code 39 values', () => {
  assert.equal(barcode.normalize('AbC-09/XY'), 'AbC-09/XY');
  assert.equal(barcode.normalize('CODE39*ABC-123*'), 'CODE39*ABC-123*');
});

test('validates check digits for EAN-13, EAN-8, UPC-A and UPC-E', () => {
  assert.equal(barcode.checkDigitStatus('4006381333931', 'ean_13'), true);
  assert.equal(barcode.checkDigitStatus('96385074', 'ean_8'), true);
  assert.equal(barcode.checkDigitStatus('036000291452', 'upc_a'), true);
  assert.equal(barcode.checkDigitStatus('04252614', 'upc_e'), true);
  assert.equal(barcode.checkDigitStatus('4006381333932', 'ean_13'), false);
});

test('does not impose a check digit on Code 128 and Code 39', () => {
  assert.equal(barcode.checkDigitStatus('AbC-09/XY', 'code_128'), null);
  assert.equal(barcode.checkDigitStatus('CODE39*ABC-123*', 'code_39'), null);
});

test('unwraps formula-wrapped CSV barcodes used to preserve leading zeroes', () => {
  assert.equal(barcode.unwrapExcelText('="0637962523829"'), '0637962523829');
  assert.equal(barcode.normalize(barcode.unwrapExcelText('="0637962523829"')), '0637962523829');
  assert.equal(barcode.unwrapExcelText('CODE128-abc'), 'CODE128-abc');
});
