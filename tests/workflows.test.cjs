const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function compile(source, context) {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  context.exports = {}; vm.runInNewContext(code, context); return context.exports;
}
function helper(name, context) {
  const source = fs.readFileSync(path.join(root, 'src/lib/supabase.ts'), 'utf8');
  const tree = ts.createSourceFile('supabase.ts', source, ts.ScriptTarget.Latest, true);
  return compile(tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(tree), context)[name];
}
function query(result) {
  const q = { then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
  for (const method of ['select', 'eq', 'order', 'limit', 'maybeSingle']) q[method] = () => q;
  return q;
}
test('configured financial reads exclude forged or stale browser rows', async () => {
  for (const name of ['adminGetSettlements', 'merchantGetSettlements', 'getUserOrders', 'getUserGiftCards', 'getRedemptionTransactions']) {
    const ctx = { isSupabaseConfigured: true, hasTimedOut: false, withTimeout: async p => await p,
      supabase: { from: () => query({ data: [], error: null }) }, getLocal: () => { throw Error('Browser financial cache must not be read'); }, console };
    assert.equal((await helper(name, ctx)('user')).length, 0, name);
    ctx.supabase.from = () => query({ data: null, error: Error('Database unavailable') });
    await assert.rejects(helper(name, ctx)('user'), /Database unavailable/, name);
  }
});
test('settlement stale-row failure is propagated from the guarded RPC', async () => {
  let called;
  const fn = helper('adminMarkSettlementPaid', { withTimeout: async p => await p, supabase: { rpc: (name, args) => {
    called = { name, args }; return Promise.resolve({ error: Error('no longer pending') });
  } } });
  await assert.rejects(fn('stale'), /no longer pending/);
  assert.equal(called.name, 'admin_mark_settlement_paid'); assert.equal(called.args.p_settlement_id, 'stale');
});
test('support retries preserve their request ID and use one transactional RPC', async () => {
  const requests = []; let fail = true;
  const fn = helper('createSupportTicket', { withTimeout: async p => await p, supabase: { rpc: (name, args) => {
    requests.push({ name, ...args }); if (fail) { fail = false; return Promise.resolve({ error: Error('lost response') }); }
    return Promise.resolve({ data: { id: 'ticket' }, error: null });
  } } });
  await assert.rejects(fn('Help', 'Message', 'same-request'), /lost response/);
  assert.equal((await fn('Help', 'Message', 'same-request')).id, 'ticket');
  assert.deepEqual(requests[0], requests[1]); assert.equal(requests[0].name, 'create_support_ticket');
});
test('voucher eligibility excludes expired, disabled, invalid and depleted cards', () => {
  const { voucherState } = compile(fs.readFileSync(path.join(root, 'src/lib/voucherState.ts'), 'utf8'), {});
  const card = { is_used: false, status: 'active', expiry_date: '2030-01-01', remaining_balance: 10 };
  const now = Date.parse('2026-10-15'); assert.equal(voucherState(card, now), 'active');
  for (const changes of [{ expiry_date: '2020-01-01' }, { expiry_date: 'invalid' }, { status: 'disabled' }]) assert.equal(voucherState({ ...card, ...changes }, now), 'unavailable');
  for (const changes of [{ remaining_balance: 0 }, { is_used: true }, { status: 'redeemed' }]) assert.equal(voucherState({ ...card, ...changes }, now), 'used');
});
test('verified same-user token refresh keeps dashboards mounted; identity changes and revoked access block them', async () => {
  const changes = []; const states = []; let index = 0, effect, callback, active = true, merchantFails = false;
  const candidate = id => ({ user: { id }, access_token: id });
  const react = { createContext: () => ({ Provider: 'provider' }), useContext: () => null,
    useState: initial => { const slot = index++; states[slot] = initial; return [initial, value => { states[slot] = value; changes.push([slot, value]); }]; }, useEffect: fn => { effect = fn; } };
  const client = { auth: { onAuthStateChange: fn => { callback = fn; return { data: { subscription: { unsubscribe() {} } } }; },
    getSession: async () => ({ data: { session: candidate('alice') } }),
    getUser: async token => ({ data: { user: { id: token } }, error: null }) }, rpc: async () => ({ data: active, error: null }) };
  const exports = compile(fs.readFileSync(path.join(root, 'src/context/AuthContext.tsx'), 'utf8'), {
    require: name => name === 'react' ? react : name === 'react/jsx-runtime' ? { jsx: () => null } : {
      supabase: client, isSupabaseConfigured: true, ensureUserProfile: async () => {}, getCompanyByOwner: async () => { if (merchantFails) throw Error('company unavailable'); return null; } },
    setTimeout, clearTimeout, Promise, console: { warn() {} },
  });
  exports.AuthProvider({ children: null }); const cleanup = effect();
  const flush = () => new Promise(resolve => setTimeout(resolve, 20)); await flush();
  assert.equal(states[0].id, 'alice'); assert.equal(states[3], false); changes.length = 0;
  merchantFails = true; callback('TOKEN_REFRESHED', candidate('alice')); await flush();
  assert.equal(states[0].id, 'alice'); assert.equal(changes.some(([slot, value]) => slot === 3 && value === true), false);
  callback('SIGNED_IN', candidate('bob')); assert.equal(states[3], true); await flush(); assert.equal(states[0].id, 'bob');
  active = false; callback('TOKEN_REFRESHED', candidate('bob')); await flush(); assert.equal(states[0], null);
  cleanup();
});
function nestedFunction(file, name, context) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found; function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; ts.forEachChild(node, visit); } visit(tree);
  return compile('export ' + found.getText(tree), context)[name];
}
test('switching support threads clears old messages and ignores late responses', async () => {
  const pending = {}; let messages = ['old'], error = '', loading;
  const ctx = { threadRevision: { current: 0 }, setSelectedTicket() {}, setView() {}, setReply() {}, setReplyError() {},
    setMessages: value => { messages = value; }, setThreadError: value => { error = value; }, setLoadingMessages: value => { loading = value; },
    getSupportTicketMessages: id => new Promise((resolve, reject) => { pending[id] = { resolve, reject }; }) };
  const open = nestedFunction('src/components/SupportWidget.tsx', 'openThread', ctx);
  const a = open({ id: 'a' }); assert.equal(messages.length, 0);
  const b = open({ id: 'b' }); pending.b.resolve(['b-message']); await b; pending.a.resolve(['a-message']); await a;
  assert.equal(messages[0], 'b-message'); assert.equal(loading, false);
  const c = open({ id: 'c' }); pending.c.reject(Error('network')); await c;
  assert.equal(messages.length, 0); assert.match(error, /Could not load/);
});
test('resumed Stripe controls lock quick amounts and gateway changes', () => {
  const source = fs.readFileSync(path.join(root, 'src/pages/UserDashboard.tsx'), 'utf8');
  const tree = ts.createSourceFile('dashboard.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const controls = [];
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'button' && node.openingElement.getText(tree).includes('setAddMoneyAmount(val)')) controls.push(node);
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'PaymentMethodSelector') controls.push(node);
    ts.forEachChild(node, visit);
  } visit(tree); assert.equal(controls.length, 2);
  for (const node of controls) {
    const ctx = { require, stripeResumeOrder: { orderId: 'saved-12' }, addMoneyLoading: false, addMoneyAmount: '12', val: '25',
      profileCountry: null, userCurrency: 'USD', selectedGateway: 'stripe', userCountryCode: 'US', setAddMoneyAmount() {}, setSelectedGateway() {}, PaymentMethodSelector: () => null };
    const render = compile('export function control(){ return (' + node.getText(tree) + '); }', ctx).control;
    assert.equal(render().props.disabled, true);
    ctx.stripeResumeOrder = null; assert.equal(render().props.disabled, false);
    ctx.addMoneyLoading = true; assert.equal(render().props.disabled, true);
  }
});
test('password recovery uses the deployed reset route, validates confirmation and completes the recovery session', async () => {
  const updates = []; const resetRequests = []; let error, message, finished = false;
  const ctx = { isSupabaseConfigured: true, isPasswordRecovery: false, email: 'qa@example.invalid', password: 'fixture-only', confirmation: 'different',
    setError: value => { error = value; }, setMessage: value => { message = value; }, setBusy() {}, setPassword() {}, setConfirmation() {},
    finishPasswordRecovery: () => { finished = true; }, window: { location: { origin: 'https://coupon-frontend-e8b3.onrender.com' }, history: { replaceState() {} } },
    supabase: { auth: { resetPasswordForEmail: async (...args) => { resetRequests.push(args); return { error: null }; }, updateUser: async args => { updates.push(args); return { error: null }; } } } };
  const submit = nestedFunction('src/pages/ResetPasswordPage.tsx', 'submit', ctx);
  await submit({ preventDefault() {} }); assert.equal(resetRequests[0][1].redirectTo, 'https://coupon-frontend-e8b3.onrender.com/reset-password'); assert.match(message, /If an account exists/);
  ctx.isPasswordRecovery = true; await submit({ preventDefault() {} }); assert.match(error, /do not match/); assert.equal(updates.length, 0);
  ctx.confirmation = ctx.password; await submit({ preventDefault() {} }); assert.equal(updates.length, 1); assert.equal(finished, true); assert.match(message, /updated/);
});
test('country completion selects a provider for nominal local currency without conversion', () => {
  const exports = compile(fs.readFileSync(path.join(root, 'src/lib/countries.ts'), 'utf8'), {});
  assert.equal(exports.getPreferredGateway('IN'), 'razorpay'); assert.equal(exports.getCurrencyForCountry('IN'), 'INR');
  for (const code of ['US', 'GB', 'AE', 'AU']) assert.equal(exports.getPreferredGateway(code), 'stripe');
});
test('multiple merchant companies select one deterministic company instead of failing single-row lookup', async () => {
  let limit;
  const q = query({ data: { id: 'approved-company' }, error: null }); q.limit = n => { limit = n; return q; };
  const company = await helper('getCompanyByOwner', { isSupabaseConfigured: true, hasTimedOut: false,
    supabase: { rpc: () => q }, withTimeout: async p => await p })('owner');
  assert.equal(limit, 1); assert.equal(company.id, 'approved-company');
});
function brandCatalogue() { return compile(fs.readFileSync(path.join(root, 'src/lib/brandCatalog.ts'), 'utf8'), {}); }
test('15 distinct brand previews use explicitly marked sample details and bundled logos', () => {
  const { CATALOGUE_BRANDS, getCatalogueBrand } = brandCatalogue();
  assert.equal(CATALOGUE_BRANDS.length, 15); assert.equal(new Set(CATALOGUE_BRANDS.map(brand => brand.slug)).size, 15);
  for (const name of ['amazon', 'flipkart', 'meesho', 'facebook']) assert.ok(getCatalogueBrand(name));
  assert.equal(getCatalogueBrand('unknown'), undefined);
  for (const brand of CATALOGUE_BRANDS) {
    assert.ok(brand.description); assert.equal(brand.sample.isSample, true);
    assert.ok(brand.sample.price > 0 && brand.sample.price < brand.sample.value);
    assert.ok(Date.parse(brand.sample.expiryDate) > Date.parse(brand.sample.launchDate));
    assert.equal('id' in brand.sample, false); assert.equal('company_id' in brand.sample, false);
    const logo = fs.readFileSync(path.join(root, 'public', brand.logoPath), 'utf8');
    assert.match(logo, /<svg/); assert.doesNotMatch(logo, /<script|<foreignObject|javascript:|onload=/i);
  }
});
test('details purchase eligibility fails closed for wrong country, expiry, unpublished and sold-out offers', () => {
  const { getOfferUnavailableReason } = brandCatalogue();
  const now = Date.parse('2026-10-15T12:00:00Z');
  const offer = { id: 'live', country_code: 'IN', is_active: true, price: 500, value: 600, created_at: '2026-10-01T12:00:00Z', expiry_date: '2027-01-01', issue_limit: 10, issued_count: 9 };
  assert.equal(getOfferUnavailableReason(offer, 'IN', now), null);
  assert.match(getOfferUnavailableReason(offer, null, now), /account country/);
  assert.match(getOfferUnavailableReason(offer, 'US', now), /selected country/);
  for (const changes of [{ is_active: false }, { expiry_date: '2026-01-01' }, { expiry_date: 'invalid' }, { created_at: '2027-01-01' }, { issued_count: 10 }, { issue_limit: 0 }, { price: NaN }]) assert.ok(getOfferUnavailableReason({ ...offer, ...changes }, 'IN', now));
});
test('purchase confirmation prevents double submission and never purchases a brand preview', async () => {
  let resolvePayment, calls = 0, navigated = false;
  const ctx = { brand: undefined, offer: undefined, user: { id: 'qa', email: 'qa@example.invalid' }, canBuy: false, purchasing: { current: false }, setBusy() {}, setPurchaseError() {},
    purchaseGiftCard: () => { calls++; return new Promise(resolve => { resolvePayment = resolve; }); }, dialog: { current: { close() {} } }, success() {},
    navigate: path => { navigated = path === '/dashboard/cards'; }, messageOf: error => error.message };
  const confirm = nestedFunction('src/pages/MarketplaceDetailsPage.tsx', 'confirmPurchase', ctx);
  await confirm(); assert.equal(calls, 0);
  ctx.offer = { id: 'published-offer', price: 500 }; ctx.canBuy = true;
  ctx.brand = { slug: 'amazon' }; await confirm(); assert.equal(calls, 0); ctx.brand = undefined;
  const first = confirm(); await confirm(); assert.equal(calls, 1); resolvePayment({}); await first; assert.equal(navigated, true);
});
test('brand catalogue renders 15 links and no home-page purchase controls', () => {
  const React = require('react'); const { renderToStaticMarkup } = require('react-dom/server'); const { MemoryRouter } = require('react-router-dom');
  const exports = compile(fs.readFileSync(path.join(root, 'src/components/BrandCatalogue.tsx'), 'utf8'), {
    require: name => name.includes('brandCatalog') ? brandCatalogue() : name.includes('BrandLogo') ? compile(fs.readFileSync(path.join(root, 'src/components/BrandLogo.tsx'), 'utf8'), { require }) : name.endsWith('.css') ? {} : require(name),
  });
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(exports.default, { search: '' })));
  assert.equal((html.match(/aria-label="View .*? coupon details"/g) || []).length, 15);
  assert.equal((html.match(/<img /g) || []).length, 15);
  assert.equal(html.includes('<button'), false); assert.equal(html.includes('Buy coupon'), false);
  const filtered = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(exports.default, { search: 'Meesho' })));
  assert.equal((filtered.match(/aria-label="View .*? coupon details"/g) || []).length, 1);
});
test('all 15 sample detail pages keep Buy disabled even when matching real inventory exists', () => {
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  const { Link, MemoryRouter } = require('react-router-dom');
  const { CATALOGUE_BRANDS, getCatalogueBrand, getOfferUnavailableReason } = brandCatalogue();
  const { getCountryByCode } = compile(fs.readFileSync(path.join(root, 'src/lib/countries.ts'), 'utf8'), {});
  const BrandLogo = compile(fs.readFileSync(path.join(root, 'src/components/BrandLogo.tsx'), 'utf8'), { require }).default;
  for (const brand of CATALOGUE_BRANDS) {
    let stateIndex = 0;
    const data = { profile: { country_code: 'IN', currency: 'INR', wallet_balance: 100000 }, offers: [{ id: 'real-matching-offer', company_name: brand.name, country_code: 'IN', price: 500 }] };
    const context = { require, useAuth: () => ({ user: { id: 'qa' } }), useNavigate: () => () => {}, useToast: () => ({ success() {} }), useNow: () => Date.parse('2026-10-15'),
      useState: initial => [stateIndex++ === 0 ? data : initial, () => {}], useRef: initial => ({ current: initial }), useEffect() {},
      getCatalogueBrand, getOfferUnavailableReason, getCountryByCode, BrandLogo, Link, ArrowLeft: () => null, ShieldCheck: () => null,
      dateLabel: value => value.slice(0, 10), formatCurrency: (amount, currency) => `${currency} ${amount}` };
    const Details = nestedFunction('src/pages/MarketplaceDetailsPage.tsx', 'DetailsContent', context);
    const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(Details, { brandSlug: brand.slug, onRetry() {} })));
    assert.match(html, /disabled=""[^>]*>Buy coupon/); assert.equal(html.includes('<dialog'), false);
    assert.ok(html.includes('DEMO · NOT VALID FOR REDEMPTION')); assert.ok(html.includes(brand.sample.launchDate.slice(0, 10))); assert.ok(html.includes(brand.sample.expiryDate.slice(0, 10)));
    assert.ok(html.includes(`/dashboard/marketplace/brand/${brand.slug}/offers`)); assert.doesNotMatch(html, /Sample|sample/); assert.equal(html.includes('Wallet balance:'), false); assert.ok(html.includes(`${brand.name} logo`));
  }
});

test('published list excludes demo data, unavailable inventory and unrelated issuers', () => {
  const { getPublishedOffers, getCatalogueBrand } = brandCatalogue();
  const now = Date.parse('2026-10-15');
  const offer = { id: 'real', company_name: ' Flipkart ', title: 'Shopping coupon', country_code: 'IN', currency: 'INR', is_active: true, price: 100, value: 150, created_at: '2026-10-01', expiry_date: '2027-01-01', issue_limit: 10, issued_count: 1 };
  const inventory = [offer, { ...offer, id: 'other', company_name: 'Other merchant', title: 'Flipkart offer' }, ...[
    { country_code: 'US' }, { currency: 'USD' }, { is_active: false }, { expiry_date: '2026-01-01' }, { issued_count: 10 }, { created_at: '2027-01-01' }
  ].map((change, index) => ({ ...offer, id: `invalid-${index}`, ...change }))];
  assert.deepEqual(Array.from(getPublishedOffers(inventory, 'IN', 'INR', now, getCatalogueBrand('flipkart')), item => item.id), ['real']);
  assert.equal(getPublishedOffers(inventory, 'IN', 'INR', now).length, 2);
  assert.equal(getPublishedOffers(inventory, null, 'INR', now).length, 0);
  assert.equal(getPublishedOffers(inventory, 'IN', 'INR', now, getCatalogueBrand('amazon')).length, 0);
});
test('published coupons render stored dates and checkout links without demo inventory', () => {
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  const router = require('react-router-dom');
  const catalogue = brandCatalogue();
  const countries = compile(fs.readFileSync(path.join(root, 'src/lib/countries.ts'), 'utf8'), {});
  let brandSlug = 'flipkart', stateIndex = 0;
  const data = { userId: 'qa', profile: { country_code: 'IN', currency: 'INR' }, offers: [{ id: 'stored-offer', company_name: 'Flipkart', title: 'Published shopping coupon', country_code: 'IN', currency: 'INR', price: 100, value: 150, created_at: '2026-10-01', expiry_date: '2027-02-01', is_active: true }] };
  const page = compile(fs.readFileSync(path.join(root, 'src/pages/PublishedCouponsPage.tsx'), 'utf8'), {
    require: name => name === 'react' ? { ...React, useEffect() {}, useState: initial => [stateIndex++ === 0 ? data : initial, () => {}] } :
      name === 'react-router-dom' ? { ...router, useParams: () => ({ brandSlug }) } :
      name.includes('AuthContext') ? { useAuth: () => ({ user: { id: 'qa' } }) } :
      name.includes('brandCatalog') ? catalogue : name.includes('countries') ? countries :
      name.includes('exchangeRate') ? { formatCurrency: value => `INR ${value}` } :
      name.includes('useNow') ? { useNow: () => Date.parse('2026-10-15') } :
      name.includes('supabase') || name.endsWith('.css') || name.includes('LoadingPage') ? {} : require(name),
  }).default;
  function render() { stateIndex = 0; return renderToStaticMarkup(React.createElement(router.MemoryRouter, null, React.createElement(page))); }
  const html = render(); assert.ok(html.includes('/dashboard/marketplace/coupon/stored-offer')); assert.match(html, /October 1, 2026/); assert.match(html, /February 1, 2027/); assert.doesNotMatch(html, /Demo|sample/);
  brandSlug = 'amazon'; const empty = render(); assert.match(empty, /No .*Amazon.*coupons available yet/); assert.ok(empty.includes('/dashboard/marketplace/offers')); assert.equal(empty.includes('stored-offer'), false);
});
