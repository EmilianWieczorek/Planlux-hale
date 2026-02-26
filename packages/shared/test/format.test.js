/**
 * Testy formatOfferNumberForFile, escapeHtml, formatCurrency.
 * Uruchom: cd packages/shared && npm run build && node test/format.test.js
 */
const assert = require("assert");
const { escapeHtml, formatCurrency, formatOfferNumberForFile } = require("../dist/index");

let passed = 0;
const tests = [
  () => {
    assert.strictEqual(escapeHtml("<script>"), "&lt;script&gt;");
    assert.strictEqual(escapeHtml('foo"bar'), 'foo&quot;bar');
    passed++;
  },
  () => {
    const fmt = formatCurrency(1234567);
    assert.ok(/1[\s.]?234[\s.]?567/.test(fmt), "formatCurrency groups thousands");
    assert.strictEqual(formatCurrency(0), "0");
    passed++;
  },
  () => {
    assert.strictEqual(formatOfferNumberForFile("PLX-E0001/2026"), "PLX-E0001-2026");
    assert.strictEqual(formatOfferNumberForFile(""), "PLX-X0001-2026");
    passed++;
  },
];

tests.forEach((t, i) => {
  try {
    t();
    console.log(`  ✓ test ${i + 1}`);
  } catch (e) {
    console.error(`  ✗ test ${i + 1}:`, e.message);
    process.exit(1);
  }
});
console.log(`\n${passed}/${tests.length} passed`);
process.exit(0);
