const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
let output;
before(() => {
  output = fs.mkdtempSync(path.join(os.tmpdir(), 'coupon-legacy-'));
  fs.writeFileSync(path.join(output, 'obsolete-payment.js'), 'localhost:4000');
  execFileSync(process.execPath, ['scripts/build-legacy-redirect.mjs', output]);
});
after(() => fs.rmSync(output, { recursive: true, force: true }));
test('legacy build replaces obsolete application assets with only redirect resources', () => {
  assert.deepEqual(fs.readdirSync(output).sort(), ['assets', 'index.html', 'redirect.css', 'redirect.js']);
  const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.doesNotMatch(html, /\son\w+=|unsafe-inline|localhost|supabase\.co/i);
  const retired = require('../scripts/legacy-retired-assets.json');
  for (const asset of retired) {
    const contents = fs.readFileSync(path.join(output, asset), 'utf8');
    assert.equal(contents, fs.readFileSync(path.join(output, 'redirect.js'), 'utf8'));
    assert.doesNotMatch(contents, /localhost:4000|ghoiannrniscrxedyzws|Bearer/);
  }
  assert.match(html, /<a href="https:\/\/coupon-frontend-e8b3\.onrender\.com\/">/);
});
function redirect(pathname, search = '', hash = '') {
  let destination;
  vm.runInNewContext(fs.readFileSync(path.join(output, 'redirect.js'), 'utf8'), {
    URL, window: { location: { pathname, search, hash, replace: value => { destination = new URL(value); } } },
  });
  return destination;
}
test('legacy links preserve their path, query and recovery fragment', () => {
  const url = redirect('/reset-password', '?code=test-code', '#test-fragment');
  assert.equal(url.origin, 'https://coupon-frontend-e8b3.onrender.com');
  assert.equal(url.pathname, '/reset-password');
  assert.equal(url.search, '?code=test-code');
  assert.equal(url.hash, '#test-fragment');
});
test('incoming paths and redirect parameters cannot replace the trusted destination host', () => {
  for (const value of ['//attacker.example/login', '/\\attacker.example', '/https://attacker.example']) {
    const url = redirect(value, '?redirect=https://attacker.example');
    assert.equal(url.origin, 'https://coupon-frontend-e8b3.onrender.com');
  }
});
