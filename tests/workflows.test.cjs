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
function backgrounds() { return compile(fs.readFileSync(path.join(root, 'src/lib/cardBackgrounds.ts'), 'utf8'), { URL }); }
test('15 background presets are bundled and image URLs reject unsafe schemes and unknown local paths', () => {
  const { CARD_BACKGROUNDS, normalizeCardBackground, cardBackgroundImage } = backgrounds();
  assert.equal(CARD_BACKGROUNDS.length, 15); assert.equal(new Set(CARD_BACKGROUNDS.map(item => item.slug)).size, 15);
  for (const preset of CARD_BACKGROUNDS) {
    assert.equal(normalizeCardBackground(preset.image), preset.image);
    const svg = fs.readFileSync(path.join(root, 'public', preset.image), 'utf8');
    assert.match(svg, /viewBox="0 0 1200 600"/); assert.doesNotMatch(svg, /<script|<foreignObject|javascript:|onload=|https?:\/\/(?!www.w3.org)/i);
  }
  for (const value of ['javascript:alert(1)', 'data:image/svg+xml,test', 'http://example.com/a.jpg', '/unknown.svg', '//example.com/a.jpg', 'https://user:pass@example.com/a.jpg', 'https://localhost/image.jpg', '', null, undefined]) assert.equal(normalizeCardBackground(value), null);
  assert.equal(normalizeCardBackground(' https://example.com/card.jpg '), 'https://example.com/card.jpg');
  assert.ok(cardBackgroundImage('/card-backgrounds/amazon.svg').includes('url("/card-backgrounds/amazon.svg")'));
});
test('background updates write only the banner, scope the merchant and reject stale or denied saves', async () => {
  const writes = [], filters = []; let result = { data: { id: 'offer' }, error: null };
  const q = { update: fields => { writes.push(fields); return q; }, eq: (...args) => { filters.push(args); return q; }, is: (...args) => { filters.push(args); return q; }, select: () => q, single: async () => result };
  const update = helper('updateGiftCardBanner', { isSupabaseConfigured: true, normalizeCardBackground: backgrounds().normalizeCardBackground, supabase: { from: table => { assert.equal(table, 'gift_cards'); return q; } } });
  await update('offer','merchant','https://example.com/old.jpg','/card-backgrounds/amazon.svg');
  assert.deepEqual(Object.keys(writes[0]), ['banner_image']); assert.equal(writes[0].banner_image, '/card-backgrounds/amazon.svg');
  assert.ok(filters.some(args => args[0] === 'company_id' && args[1] === 'merchant')); assert.ok(filters.some(args => args[0] === 'banner_image' && args[1] === 'https://example.com/old.jpg'));
  result = { data: null, error: null }; await assert.rejects(update('offer','merchant',null,'/card-backgrounds/amazon.svg'), /not saved/);
  const before = writes.length; await assert.rejects(update('offer','merchant',null,'javascript:alert(1)'), /valid HTTPS/); assert.equal(writes.length, before);
});
test('background picker uses non-submitting buttons and exposes every brand choice', () => {
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  const Picker = compile(fs.readFileSync(path.join(root, 'src/components/CardBackgroundPicker.tsx'), 'utf8'), { require: name => name.includes('cardBackgrounds') ? backgrounds() : name.endsWith('.css') ? {} : require(name) }).default;
  const html = renderToStaticMarkup(React.createElement(Picker, { value:'/card-backgrounds/amazon.svg',onChange() {} }));
  assert.equal((html.match(/aria-label="Use .*? background"/g)||[]).length, 15); assert.equal((html.match(/type="button"/g)||[]).length, 16); assert.equal(html.includes('type="submit"'), false); assert.match(html,/aria-pressed="true"/);
});
test('Next cancels default submission before switching to the final campaign step', () => {
  const file = 'src/pages/MerchantDashboard.tsx', source = fs.readFileSync(path.join(root, file), 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let button; function visit(node) { if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'button' && node.openingElement.getText(tree).includes('setWizardStep(wizardStep + 1)')) button = node; ts.forEachChild(node, visit); } visit(tree);
  let step = 2, prevented = false;
  const control = compile('export function next(){return (' + button.getText(tree) + ')}', { require, wizardStep: step, setWizardStep: value => { step = value; } }).next();
  control.props.onClick({ preventDefault() { prevented = true; } }); assert.equal(prevented, true); assert.equal(step, 3); assert.equal(control.props.type, 'button');
});

test('offer dates and purchase eligibility reject expired, disabled and sold-out offers', () => {
  const {formatOfferDate,offerUnavailable}=compile(fs.readFileSync(path.join(root,'src/lib/couponOffer.ts'),'utf8'),{});
  assert.equal(formatOfferDate(null),'No expiry set');assert.equal(formatOfferDate('invalid'),'Date unavailable');
  const offer={is_active:true,expiry_date:'2099-01-01',price:450,value:500,available_count:1};
  assert.equal(offerUnavailable(offer,Date.parse('2026-10-21')),null);
  for(const change of [{is_active:false},{expiry_date:'2020-01-01'},{expiry_date:'invalid'},{available_count:0},{price:0},{value:NaN}]) assert.ok(offerUnavailable({...offer,...change}));
});
test('wallet purchases preserve retry identity and fail closed without a confirmed coupon', async () => {
  const calls=[];let fail=true;
  const fn=helper('purchaseGiftCardOnce',{withTimeout:async p=>p,supabase:{rpc:async(name,args)=>{calls.push({name,...args});if(fail){fail=false;return {error:Error('lost response')};}return {data:{coupon_id:'coupon',order_id:'order'},error:null};}}});
  await assert.rejects(fn('offer',450,'same-request'),/lost response/);
  assert.equal((await fn('offer',450,'same-request')).coupon_id,'coupon');assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].name,'purchase_coupon_once');
});
test('marketplace opens accessible details links and no longer has inline purchase actions',()=>{
  const source=fs.readFileSync(path.join(root,'src/pages/UserDashboard.tsx'),'utf8');
  assert.match(source,/to=\{`\/dashboard\/marketplace\/coupon\/\$\{card.id\}`\}/);assert.match(source,/Expires: \{formatOfferDate\(card.expiry_date\)\}/);
  assert.doesNotMatch(source,/handleInitiatePurchase|handleConfirmWalletPayment|Buy gift card/);
});
