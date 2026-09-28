import { art, heroArt, TONES, TONE_ALT } from './art.js';

/* ================================ basics ================================ */

let CONFIG = {}, CATEGORIES = [], PRODUCTS = [], VARIANTS = new Map(), user = null;
const app = document.getElementById('app');
const $ = (sel, root = document) => root.querySelector(sel);
const fmt = n => '₹' + Number(n).toLocaleString('en-IN');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dateFmt = s => new Date(s.replace(' ', 'T') + 'Z').toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const byId = id => PRODUCTS.find(p => p.id === id);
const bySlug = s => PRODUCTS.find(p => p.slug === s);
const catBySlug = s => CATEGORIES.find(c => c.slug === s);
const LOW = 5;
const STATUS = { pending_payment: 'Awaiting payment', placed: 'Placed · COD', paid: 'Paid', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled' };
const pill = s => `<span class="pill ${s}">${STATUS[s] || s}</span>`;

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), { status: res.status });
  return data;
}
const post = (path, body = {}) => api(path, { method: 'POST', body });
const patch = (path, body = {}) => api(path, { method: 'PATCH', body });

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.async = true; s.onload = resolve; s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2800);
}

function setProducts(list) {
  PRODUCTS = list;
  VARIANTS = new Map();
  for (const p of list) for (const s of p.sizes) VARIANTS.set(s.id, { p, s });
}
async function refreshProducts() {
  setProducts((await api('/products')).products);
  reconcileCart();
}

// Real photo when a product has one, illustration otherwise.
function visual(p, type) {
  if (p.image && (!type || type === p.art)) return `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">`;
  return art(p, type);
}

/* ================================= cart ================================= */

let cart = store.get('virna_cart_v2', []); // [{variantId, qty}]

function reconcileCart() {
  let changed = false;
  cart = cart.filter(l => {
    const v = VARIANTS.get(l.variantId);
    if (!v || v.s.stock <= 0) { changed = true; return false; }
    if (l.qty > v.s.stock) { l.qty = v.s.stock; changed = true; }
    return true;
  });
  saveCart();
  if (changed) toast('Your cart was updated to match what is in stock');
}
function saveCart() { store.set('virna_cart_v2', cart); renderCart(); }

function totals() {
  const lines = cart.map(l => { const v = VARIANTS.get(l.variantId); return v && { ...l, p: v.p, s: v.s, amount: v.s.price * l.qty }; }).filter(Boolean);
  const subtotal = lines.reduce((a, l) => a + l.amount, 0);
  const shipping = subtotal === 0 || subtotal >= CONFIG.freeShippingOver ? 0 : CONFIG.shippingFee;
  return { lines, subtotal, shipping, total: subtotal + shipping, count: lines.reduce((a, l) => a + l.qty, 0) };
}

function addToCart(variantId, qty = 1, { open = true } = {}) {
  const v = VARIANTS.get(variantId);
  if (!v || v.s.stock <= 0) { toast('Sorry, this is sold out'); return false; }
  const line = cart.find(l => l.variantId === variantId);
  const have = line ? line.qty : 0;
  const add = Math.min(qty, v.s.stock - have);
  if (add <= 0) { toast(`Only ${v.s.stock} in stock — all of them are in your cart`); return false; }
  if (add < qty) toast(`Only ${v.s.stock} in stock`);
  line ? (line.qty += add) : cart.push({ variantId, qty: add });
  saveCart();
  if (open) openDrawer('cart');
  return true;
}

function renderCart() {
  const t = totals(), count = $('#cart-count');
  count.textContent = t.count; count.dataset.n = t.count;
  const body = $('#cart-body'), foot = $('#cart-foot');
  if (!t.count) {
    body.innerHTML = `<div class="empty">Your cart is empty.<br><br><a href="#/shop" class="btn btn-ghost" data-act="close">Start shopping</a></div>`;
    foot.innerHTML = '';
    return;
  }
  const left = CONFIG.freeShippingOver - t.subtotal;
  body.innerHTML = `<div class="ship-bar">${left > 0 ? `Add <b>${fmt(left)}</b> more for free shipping` : 'You have unlocked <b>free shipping</b>'}<div class="track"><div class="fill" style="width:${Math.min(100, t.subtotal / CONFIG.freeShippingOver * 100)}%"></div></div></div>` +
    t.lines.map(l => `<div class="line"><a href="#/product/${l.p.slug}" class="th" style="background:${TONES[l.p.tone]}">${visual(l.p)}</a>
      <div><h4>${esc(l.p.name)}</h4><div class="meta">${esc(l.s.label)} · ${fmt(l.s.price)}</div>
        <div class="qty"><button data-act="dec" data-variant="${l.variantId}" aria-label="Decrease">−</button><span>${l.qty}</span><button data-act="inc" data-variant="${l.variantId}" aria-label="Increase">+</button></div>
        <button class="rm" data-act="rm" data-variant="${l.variantId}">Remove</button></div>
      <div class="amt">${fmt(l.amount)}</div></div>`).join('');
  foot.innerHTML = `<div class="row"><span class="muted">Subtotal</span><span>${fmt(t.subtotal)}</span></div>
    <div class="row"><span class="muted">Shipping</span><span>${t.shipping ? fmt(t.shipping) : 'Free'}</span></div>
    <div class="row total"><span>Total</span><span>${fmt(t.total)}</span></div>
    <button class="btn btn-primary btn-block" style="margin-top:14px" data-act="checkout">Checkout</button>
    ${user ? '' : '<p class="fine">You will be asked to sign in or create an account.</p>'}`;
  if (location.hash.startsWith('#/checkout')) {
    const s = $('#co-summary'); if (s) s.innerHTML = summaryHTML();
    const b = $('#place'); if (b && !b.disabled) b.textContent = 'Place order · ' + fmt(t.total);
  }
}

function openDrawer(id) { $('#' + id).classList.add('open'); $('#scrim').classList.add('open'); }
function closeDrawers() { document.querySelectorAll('.drawer.open,.scrim.open').forEach(e => e.classList.remove('open')); }

/* ================================= auth ================================= */

let authNext = null, gis = null;

function updateHeader() {
  $('#admin-link').hidden = user?.role !== 'admin';
  $('#m-admin').hidden = user?.role !== 'admin';
  $('#account-btn').setAttribute('aria-label', user ? `Your account (${user.email})` : 'Sign in');
  $('#account-btn').title = user ? user.email : 'Sign in';
  renderCart();
}

function openAuth({ reason, next } = {}) {
  authNext = next || null;
  $('#auth-reason').textContent = reason || 'Sign in to see your orders and check out faster.';
  authTab('login');
  document.querySelectorAll('#auth .form-error').forEach(e => { e.hidden = true; });
  closeDrawers();
  $('#auth').hidden = false;
  renderGoogleButton();
  setTimeout(() => $('#li-email').focus(), 30);
}
function closeAuth() { $('#auth').hidden = true; authNext = null; }
function authTab(tab) {
  document.querySelectorAll('#auth .tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $('#login-form').hidden = tab !== 'login';
  $('#register-form').hidden = tab !== 'register';
}
function authError(msg) {
  const form = $('#login-form').hidden ? $('#register-form') : $('#login-form');
  const el = form.querySelector('.form-error');
  el.textContent = msg; el.hidden = false;
}

function signedIn(u) {
  user = u;
  const next = authNext;
  $('#auth').hidden = true; authNext = null;
  updateHeader();
  toast(`Signed in as ${u.email}`);
  if (next && location.hash !== next) location.hash = next;
  else route();
}

function renderGoogleButton() {
  if (!CONFIG.googleClientId) return;
  $('#google-area').hidden = false;
  gis ||= loadScript('https://accounts.google.com/gsi/client').then(() => {
    window.google.accounts.id.initialize({
      client_id: CONFIG.googleClientId,
      callback: async ({ credential }) => {
        try { signedIn((await post('/auth/google', { credential })).user); }
        catch (e) { authError(e.message); }
      }
    });
  });
  gis.then(() => {
    const el = $('#gbtn'); el.innerHTML = '';
    window.google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', text: 'continue_with', shape: 'rectangular', width: Math.min(360, el.clientWidth || 360) });
  }).catch(() => { $('#google-area').hidden = true; });
}

async function submitAuth(form) {
  const btn = form.querySelector('button[type=submit]'), label = btn.textContent;
  form.querySelector('.form-error').hidden = true;
  btn.disabled = true; btn.textContent = 'Please wait…';
  try {
    const r = form.id === 'login-form'
      ? await post('/auth/login', { email: $('#li-email').value, password: $('#li-pass').value })
      : await post('/auth/register', { name: $('#rg-name').value, email: $('#rg-email').value, password: $('#rg-pass').value });
    form.reset();
    signedIn(r.user);
  } catch (e) { authError(e.message); }
  finally { btn.disabled = false; btn.textContent = label; }
}

function needSignIn(reason, next) {
  queueMicrotask(() => openAuth({ reason, next }));
  return `<div class="wrap done"><h1>Please sign in</h1><p class="muted" style="margin:12px 0 26px">${reason}</p>
    <button class="btn btn-primary" data-act="signin" data-next="${esc(next)}">Sign in or create account</button></div>`;
}

/* ================================= views ================================ */

function card(p) {
  const avail = p.sizes.find(s => s.stock > 0), s = avail || p.sizes[0], out = !avail;
  return `<article class="card">
    <a href="#/product/${p.slug}" class="card-img" style="background:${TONES[p.tone]}">${visual(p)}${out ? '<span class="badge out">Sold out</span>' : p.tag ? `<span class="badge">${esc(p.tag)}</span>` : ''}</a>
    <div class="card-body">
      <a href="#/product/${p.slug}" class="card-name">${esc(p.name)}</a>
      <p class="card-note">${esc(p.short)}</p>
      <div class="card-foot">
        <span class="price">${fmt(s.price)}${s.mrp ? `<span class="mrp">${fmt(s.mrp)}</span>` : ''} <small>· ${esc(s.label)}</small></span>
        <button class="btn-add" data-act="add" data-variant="${s.id}" ${out ? 'disabled' : ''}>${out ? 'Sold out' : 'Add'}</button>
      </div>
    </div></article>`;
}

function Home() {
  const best = PRODUCTS.filter(p => p.tag === 'Bestseller').slice(0, 4);
  const more = ['P03', 'P06', 'P09', 'P12'].map(byId).filter(Boolean);
  const giftArt = byId('P14') ? visual(byId('P14')) : art({ slug: 'gift' }, 'hamper');
  return `
  <section class="wrap hero">
    <div>
      <span class="eyebrow">Sustainable pooja essentials</span>
      <h1>Light it. Let it <em>return</em> to the soil.</h1>
      <p class="lead">Agarbatti, dhoop, flowers and diyas made from temple flowers, cow dung, clay and cotton — packed in paper, never plastic.</p>
      <div class="hero-ctas"><a href="#/shop" class="btn btn-primary">Shop the collection</a><a href="#/shop/gift-boxes" class="btn btn-ghost">Gift boxes</a></div>
    </div>
    <div class="hero-art">${heroArt()}</div>
  </section>
  <div class="wrap"><div class="facts"><span>Charcoal-free</span><span>Plastic-free packaging</span><span>Hand-made in small batches</span><span>Delivery across India</span></div></div>

  <section class="sec wrap">
    <div class="sec-head"><div><span class="eyebrow">Shop by category</span><h2>Everything for the pooja room</h2></div><a href="#/shop" class="link">View all products</a></div>
    <div class="cats">${CATEGORIES.map(c => `<a class="cat" href="#/shop/${c.slug}"><div class="ph" style="background:${TONES[c.tone]}">${art({ slug: c.slug, name: c.name }, c.art)}</div><h3>${esc(c.name)}</h3><p>${esc(c.note)}</p></a>`).join('')}</div>
  </section>

  ${best.length ? `<section class="sec wrap" style="padding-top:0">
    <div class="sec-head"><div><span class="eyebrow">Most loved</span><h2>Bestsellers</h2></div><a href="#/shop" class="link">Shop all</a></div>
    <div class="grid">${best.map(card).join('')}</div>
  </section>` : ''}

  <section class="band"><div class="wrap story">
    <div><span class="eyebrow">How Virna is made</span><h2>From the temple steps back to your garden.</h2>
      <p class="lead">Every day, flowers offered in temples are thrown into rivers. We collect them instead, and turn them into the things you light at home.</p>
      <a href="#/about" class="btn btn-clay" style="margin-top:28px">Read our story</a></div>
    <div class="steps">
      <div class="step"><b>01</b><div><h3>Collected</h3><p>Offered flowers are gathered from temples before they reach the river, then sorted by hand.</p></div></div>
      <div class="step"><b>02</b><div><h3>Hand-rolled</h3><p>Dried in the shade, ground, and rolled or pressed in small batches — no charcoal, no synthetic binders.</p></div></div>
      <div class="step"><b>03</b><div><h3>Returned</h3><p>Paper boxes, cotton thread, clay. The ash, the diyas and the packaging can all go back into the soil.</p></div></div>
    </div>
  </div></section>

  <section class="sec wrap">
    <div class="feature">
      <div class="art">${giftArt}</div>
      <div class="txt"><span class="eyebrow">Gift boxes</span><h2>A thoughtful box, packed by hand.</h2>
        <p class="muted">Pick a ready-made box or tell us what to put inside. Every box goes out in kraft paper with a seed-paper card your recipient can plant.</p>
        <ul class="ticks"><li>Hand-written note from you, free</li><li>Ships in 2–3 working days</li><li>Custom boxes for 25+ orders</li></ul>
        <a href="#/shop/gift-boxes" class="btn btn-primary">Shop gift boxes</a></div>
    </div>
  </section>

  ${more.length ? `<section class="sec wrap" style="padding-top:0">
    <div class="sec-head"><div><span class="eyebrow">Also in the shop</span><h2>Small things, used every day</h2></div></div>
    <div class="grid">${more.map(card).join('')}</div>
  </section>` : ''}

  <section class="wrap"><div class="bulk">
    <div><span class="eyebrow">Bulk &amp; corporate</span><h2 style="margin-top:8px">Gifting for your team or family?</h2><p>Custom boxes, your message on every card, and delivery to multiple addresses. Tell us the quantity and we will send a quote within a day.</p></div>
    <a href="#/contact" class="btn btn-primary">Request a quote</a>
  </div></section>

  <section class="sec wrap"><div class="news">
    <span class="eyebrow">Letters from Virna</span><h2>New batches, restocks, nothing else.</h2>
    <p class="muted">One email a month. Unsubscribe any time.</p>
    <form id="news-form"><label class="sr" for="nemail">Email</label><input id="nemail" type="email" required placeholder="Your email address"><button class="btn btn-primary" type="submit">Subscribe</button></form>
  </div></section>`;
}

let shopSort = 'featured';
function sortList(list) {
  const l = [...list], price = p => (p.sizes.find(s => s.stock > 0) || p.sizes[0]).price;
  if (shopSort === 'low') l.sort((a, b) => price(a) - price(b));
  if (shopSort === 'high') l.sort((a, b) => price(b) - price(a));
  if (shopSort === 'new') l.sort((a, b) => (b.tag === 'New') - (a.tag === 'New'));
  return l;
}
function Shop(cat) {
  const c = catBySlug(cat), list = c ? PRODUCTS.filter(p => p.category === c.slug) : PRODUCTS;
  return `<div class="wrap">
    <div class="crumbs"><a href="#/">Home</a> / ${c ? `<a href="#/shop">Shop</a> / ${esc(c.name)}` : 'Shop'}</div>
    <div class="page-head"><h1>${c ? esc(c.name) : 'Shop all'}</h1><p>${c ? esc(c.note) + '. Made in small batches, packed in paper.' : 'Agarbatti, dhoop, flowers, diyas and gift boxes — all made from materials the earth can take back.'}</p></div>
    <div class="toolbar">
      <div class="chips"><a class="chip ${!c ? 'on' : ''}" href="#/shop">All</a>${CATEGORIES.map(x => `<a class="chip ${c && c.slug === x.slug ? 'on' : ''}" href="#/shop/${x.slug}">${esc(x.name)}</a>`).join('')}</div>
      <label class="sort">Sort by <select id="sort">
        ${[['featured', 'Featured'], ['new', 'New arrivals'], ['low', 'Price: low to high'], ['high', 'Price: high to low']].map(([v, l]) => `<option value="${v}" ${shopSort === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select></label>
    </div>
    <p class="muted" style="font-size:13px;margin:-18px 0 22px">${list.length} product${list.length === 1 ? '' : 's'}</p>
    <div class="grid" id="grid">${sortList(list).map(card).join('')}</div>
  </div><div class="sec"></div>`;
}

function Search(q) {
  const t = q.toLowerCase().trim();
  const list = t ? PRODUCTS.filter(p => (p.name + ' ' + p.short + ' ' + p.category + ' ' + p.desc).toLowerCase().includes(t)) : [];
  return `<div class="wrap"><div class="crumbs"><a href="#/">Home</a> / Search</div>
    <div class="page-head"><h1>${t ? `Results for “${esc(q)}”` : 'Search'}</h1><p>${list.length} product${list.length === 1 ? '' : 's'} found</p></div>
    ${list.length ? `<div class="grid">${list.map(card).join('')}</div>` : `<div class="empty">Nothing matched. Try “agarbatti”, “diya” or “gift”.<br><br><a href="#/shop" class="btn btn-ghost">Browse all products</a></div>`}
  </div><div class="sec"></div>`;
}

let pd = { id: null, size: 0, qty: 1, view: 0 };
function Product(slug) {
  const p = bySlug(slug); if (!p) return NotFound();
  if (pd.id !== p.id) pd = { id: p.id, size: Math.max(0, p.sizes.findIndex(s => s.stock > 0)), qty: 1, view: 0 };
  const c = catBySlug(p.category), s = p.sizes[pd.size], out = s.stock <= 0;
  const views = [[p.tone, p.art], [TONE_ALT[p.tone], 'pack'], [TONE_ALT[p.tone], p.art]];
  const related = PRODUCTS.filter(x => x.category === p.category && x.id !== p.id).concat(PRODUCTS.filter(x => x.category !== p.category && x.tag)).slice(0, 4);
  const stockNote = out ? 'Sold out — check back soon' : s.stock <= LOW ? `Only ${s.stock} left` : '';
  return `<div class="wrap">
    <div class="crumbs"><a href="#/">Home</a> / <a href="#/shop/${c.slug}">${esc(c.name)}</a> / ${esc(p.name)}</div>
    <div class="pdp">
      <div class="gallery">
        <div class="main" style="background:${TONES[views[pd.view][0]]}">${visual(p, views[pd.view][1])}</div>
        <div class="thumbs">${views.map((v, i) => `<button class="${i === pd.view ? 'on' : ''}" style="background:${TONES[v[0]]}" data-act="view" data-i="${i}" aria-label="View image ${i + 1}">${visual(p, v[1])}</button>`).join('')}</div>
      </div>
      <div class="pdp-info">
        <span class="eyebrow">${esc(c.name)}</span>
        <h1>${esc(p.name)}</h1>
        <p class="pdp-price">${fmt(s.price)}${s.mrp ? `<span class="mrp">${fmt(s.mrp)}</span>` : ''}</p>
        <p class="pdp-tax">Inclusive of all taxes. ${s.price >= CONFIG.freeShippingOver ? 'Ships free.' : `Free shipping above ${fmt(CONFIG.freeShippingOver)}.`}</p>
        <p class="pdp-desc">${esc(p.desc)}</p>
        <p class="opt-label">Size</p>
        <div class="sizes">${p.sizes.map((z, i) => `<button class="size ${i === pd.size ? 'on' : ''}" data-act="size" data-i="${i}" ${z.stock <= 0 ? 'disabled title="Sold out"' : ''}>${esc(z.label)}</button>`).join('')}</div>
        ${stockNote ? `<p class="stock-note">${stockNote}</p>` : ''}
        <div class="buy-row">
          <div class="stepper"><button data-act="pd-dec" aria-label="Decrease">−</button><span id="pd-qty">${pd.qty}</span><button data-act="pd-inc" aria-label="Increase">+</button></div>
          <button class="btn btn-primary" data-act="pd-add" ${out ? 'disabled' : ''}>${out ? 'Sold out' : 'Add to cart'}</button>
        </div>
        <button class="btn btn-ghost btn-block buy-now" data-act="pd-buy" ${out ? 'disabled' : ''}>Buy it now</button>
        <div class="perks"><div><b>Charcoal-free</b>Natural binders</div><div><b>Plastic-free</b>Paper packaging</div><div><b>Dispatch</b>In 1–2 days</div></div>
        ${p.includes ? `<details class="acc" open><summary>What's in the box</summary><div class="acc-body"><ul>${p.includes.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div></details>` : ''}
        <details class="acc" ${p.includes ? '' : 'open'}><summary>Made from</summary><div class="acc-body"><ul>${p.made.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div></details>
        <details class="acc"><summary>How to use</summary><div class="acc-body">${esc(p.use)}</div></details>
        <details class="acc"><summary>Shipping &amp; returns</summary><div class="acc-body">Dispatched in 1–2 working days; delivery in 3–7 days across India. Free shipping above ${fmt(CONFIG.freeShippingOver)}. If anything arrives broken, send us a photo within 48 hours and we will replace it.</div></details>
      </div>
    </div>
    ${related.length ? `<section class="sec" style="padding-top:40px"><div class="sec-head"><div><span class="eyebrow">Pairs well with</span><h2>You may also like</h2></div></div>
      <div class="grid">${related.map(card).join('')}</div></section>` : ''}
  </div>`;
}
function refreshPdp() { const y = scrollY; app.innerHTML = Product(location.hash.split('/')[2]); scrollTo(0, y); }

/* ------------------------------- checkout ------------------------------- */

const field = (id, label, value = '', attrs = '', cls = '', msg = 'Please fill this in') =>
  `<div class="field ${cls}"><label for="${id}">${label}</label><input id="${id}" name="${id}" value="${esc(value)}" ${attrs}><div class="msg">${msg}</div></div>`;

function summaryHTML() {
  const t = totals();
  return `<h3>Order summary</h3>
    ${t.lines.map(l => `<div class="line"><div class="th" style="background:${TONES[l.p.tone]}">${visual(l.p)}</div><div><h4>${esc(l.p.name)}</h4><div class="meta">${esc(l.s.label)} × ${l.qty}</div></div><div class="amt">${fmt(l.amount)}</div></div>`).join('')}
    <div class="row" style="margin-top:14px"><span class="muted">Subtotal</span><span>${fmt(t.subtotal)}</span></div>
    <div class="row"><span class="muted">Shipping</span><span>${t.shipping ? fmt(t.shipping) : 'Free'}</span></div>
    <div class="row total"><span>Total</span><span>${fmt(t.total)}</span></div>
    <p class="muted" style="font-size:12px;margin-top:6px">Inclusive of GST</p>`;
}

function Checkout() {
  if (!user) return needSignIn('Sign in or create an account to check out. Your cart is saved.', '#/checkout');
  const t = totals();
  if (!t.count) return `<div class="wrap done"><h1>Your cart is empty</h1><p class="muted" style="margin:12px 0 26px">Add something to get started.</p><a class="btn btn-primary" href="#/shop">Shop the collection</a></div>`;
  const a = user.address || {};
  const [first = '', ...rest] = (user.name || '').split(' ');
  const online = CONFIG.onlinePayments;
  return `<div class="wrap">
    <div class="crumbs"><a href="#/">Home</a> / Checkout</div>
    <div class="page-head"><h1>Checkout</h1></div>
    <div class="co">
      <form id="co-form" novalidate>
        <h2>Contact</h2>
        <div class="fields">
          ${field('email', 'Email', user.email, 'type="email" readonly style="background:var(--sand)"')}
          ${field('phone', 'Mobile number', user.phone, 'type="tel" inputmode="numeric" maxlength="10" autocomplete="tel" required placeholder="10-digit number"', '', 'Enter a 10-digit mobile number')}
        </div>
        <h2>Delivery address</h2>
        <div class="fields">
          ${field('fname', 'First name', a.firstName ?? first, 'autocomplete="given-name" required')}
          ${field('lname', 'Last name', a.lastName ?? rest.join(' '), 'autocomplete="family-name" required')}
          ${field('address', 'Flat, house no., building, street', a.line1, 'autocomplete="address-line1" required', 'full')}
          ${field('address2', 'Area, landmark (optional)', a.line2, 'autocomplete="address-line2"', 'full')}
          ${field('pincode', 'PIN code', a.pincode, 'inputmode="numeric" maxlength="6" autocomplete="postal-code" required', '', 'Enter a 6-digit PIN code')}
          ${field('city', 'City', a.city, 'autocomplete="address-level2" required')}
          <div class="field full"><label for="state">State</label><select id="state" name="state" required><option value="">Select state</option>${CONFIG.states.map(s => `<option ${s === a.state ? 'selected' : ''}>${s}</option>`).join('')}</select><div class="msg">Select your state</div></div>
          <div class="field full"><label for="gift">Gift message (optional)</label><textarea id="gift" name="gift" maxlength="500" placeholder="We will hand-write this on a seed-paper card"></textarea></div>
        </div>
        <h2>Payment</h2>
        <label class="opt" ${online ? '' : 'style="opacity:.55;cursor:not-allowed"'}><input type="radio" name="pay" value="online" ${online ? 'checked' : 'disabled'}><div><b>Pay online</b><span>${online ? 'UPI, credit &amp; debit cards, netbanking and wallets — secured by Razorpay' : 'Coming soon'}</span></div></label>
        <label class="opt"><input type="radio" name="pay" value="cod" ${online ? '' : 'checked'}><div><b>Cash on delivery</b><span>Pay when your order arrives</span></div></label>
        ${CONFIG.simulatedPayments ? '<p class="note">Test mode: online payment is simulated — no money is charged. Add Razorpay keys on the server to take real payments.</p>' : ''}
        <button class="btn btn-primary btn-block" type="submit" id="place">Place order · ${fmt(t.total)}</button>
        <p class="form-error" id="co-error" hidden></p>
      </form>
      <aside class="summary" id="co-summary">${summaryHTML()}</aside>
    </div>
  </div>`;
}

async function payWithRazorpay(order, payment, prefill) {
  await loadScript('https://checkout.razorpay.com/v1/checkout.js');
  return new Promise(resolve => {
    let settled = false;
    const done = ok => { if (!settled) { settled = true; resolve(ok); } };
    const rzp = new window.Razorpay({
      key: payment.keyId, amount: payment.amount, currency: payment.currency, order_id: payment.razorpayOrderId,
      name: 'Virna', description: `Order ${order.number}`, prefill, theme: { color: '#4F5A3F' },
      handler: async resp => {
        try { await post(`/orders/${order.number}/verify`, resp); done(true); }
        catch (e) { toast(e.message); done(false); }
      },
      modal: {
        ondismiss: async () => {
          if (settled) return;
          try { await post(`/orders/${order.number}/cancel`); } catch {}
          done(false);
        }
      }
    });
    rzp.open();
  });
}

let justPlaced = null;
async function placeOrder(form) {
  const v = id => form.querySelector('#' + id).value.trim();
  const checks = { phone: /^[6-9]\d{9}$/.test(v('phone')), fname: !!v('fname'), lname: !!v('lname'), address: !!v('address'), pincode: /^\d{6}$/.test(v('pincode')), city: !!v('city'), state: !!v('state') };
  let first = null;
  for (const [k, ok] of Object.entries(checks)) { const f = form.querySelector('#' + k).closest('.field'); f.classList.toggle('err', !ok); if (!ok && !first) first = f; }
  if (first) { first.scrollIntoView({ behavior: 'smooth', block: 'center' }); first.querySelector('input,select').focus({ preventScroll: true }); return; }

  const btn = $('#place'), err = $('#co-error');
  const payMethod = form.querySelector('input[name=pay]:checked').value;
  const address = { firstName: v('fname'), lastName: v('lname'), line1: v('address'), line2: v('address2'), city: v('city'), state: v('state'), pincode: v('pincode') };
  const reset = () => { btn.disabled = false; btn.textContent = 'Place order · ' + fmt(totals().total); };
  err.hidden = true;
  btn.disabled = true; btn.textContent = payMethod === 'cod' ? 'Placing order…' : 'Starting payment…';
  try {
    const { order, payment } = await post('/orders', { items: cart.map(({ variantId, qty }) => ({ variantId, qty })), phone: v('phone'), address, payMethod, giftMessage: v('gift') });
    if (payment?.mode === 'razorpay') {
      const ok = await payWithRazorpay(order, payment, { name: `${address.firstName} ${address.lastName}`, email: user.email, contact: v('phone') });
      if (!ok) { reset(); await refreshProducts(); toast('Payment was not completed — your cart is still here'); return; }
    } else if (payment?.mode === 'simulated') {
      btn.textContent = 'Processing payment…';
      await new Promise(r => setTimeout(r, 900));
      await post(`/orders/${order.number}/simulate-payment`);
    }
    Object.assign(user, { address, phone: v('phone') });
    cart = []; saveCart();
    justPlaced = order.number;
    refreshProducts().catch(() => {});
    location.hash = '#/order/' + order.number;
  } catch (e) {
    reset();
    if (e.status === 401) { user = null; updateHeader(); openAuth({ reason: 'Your session ended — please sign in again.', next: '#/checkout' }); return; }
    if (e.status === 409) await refreshProducts();
    err.textContent = e.message; err.hidden = false;
  }
}

async function OrderPage(number) {
  if (!user) return needSignIn('Sign in to see this order.', '#/order/' + number);
  const { order: o } = await api('/orders/' + encodeURIComponent(number));
  const fresh = justPlaced === o.number; justPlaced = null;
  const a = o.address;
  return `<div class="wrap done">
    ${fresh ? `<div class="tick"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#F3EBDC" stroke-width="2.4"><path d="m5 12 5 5 9-10"/></svg></div>` : ''}
    <span class="eyebrow">Order ${o.number}</span>
    <h1 style="margin-top:10px">${fresh ? `Thank you, ${esc(a.firstName)}.` : 'Order details'}</h1>
    <p class="muted" style="margin-top:12px">${fresh ? (o.payMethod === 'cod' ? `Your order is placed. Please keep ${fmt(o.total)} ready at delivery.` : 'Your payment was received and your order is confirmed.') : `Placed ${dateFmt(o.createdAt)}`}</p>
    <div class="box">
      <div class="row" style="margin-bottom:14px"><span class="muted">Status</span>${pill(o.status)}</div>
      ${o.items.map(l => `<div class="row"><span>${esc(l.name)} <span class="muted">· ${esc(l.size)} × ${l.qty}</span></span><span>${fmt(l.amount)}</span></div>`).join('')}
      <div class="row"><span class="muted">Shipping</span><span>${o.shipping ? fmt(o.shipping) : 'Free'}</span></div>
      <div class="row total"><span>Total</span><span>${fmt(o.total)}</span></div>
      <p class="muted" style="font-size:13.5px;margin-top:18px"><b style="color:var(--ink)">Delivering to</b><br>${esc(a.firstName)} ${esc(a.lastName)}, ${esc(a.line1)}${a.line2 ? ', ' + esc(a.line2) : ''}, ${esc(a.city)}, ${esc(a.state)} – ${esc(a.pincode)} · ${esc(o.phone)}</p>
      ${o.giftMessage ? `<p class="muted" style="font-size:13.5px;margin-top:12px"><b style="color:var(--ink)">Gift message</b><br>${esc(o.giftMessage)}</p>` : ''}
    </div>
    <a href="#/shop" class="btn btn-primary">Continue shopping</a> <a href="#/account" class="btn btn-ghost">My orders</a>
  </div>`;
}

/* -------------------------------- account ------------------------------- */

async function Account() {
  if (!user) return needSignIn('Sign in to see your orders and saved address.', '#/account');
  const { orders } = await api('/account/orders');
  return `<div class="wrap"><div class="crumbs"><a href="#/">Home</a> / My account</div>
    <div class="page-head"><h1>Hello${user.name ? ', ' + esc(user.name.split(' ')[0]) : ''}</h1><p>${esc(user.email)}${user.role === 'admin' ? ' · Admin' : ''}</p></div>
    <div class="acct">
      <div><div class="panel"><h2>Your orders</h2>
        ${orders.length ? orders.map(o => `<div class="order-row">
            <div><a class="link" href="#/order/${o.number}">${o.number}</a><div class="meta">${dateFmt(o.createdAt)} · ${o.items.reduce((n, i) => n + i.qty, 0)} item(s) · ${o.payMethod === 'cod' ? 'Cash on delivery' : 'Paid online'}</div></div>
            <div style="text-align:right"><b>${fmt(o.total)}</b><div style="margin-top:4px">${pill(o.status)}</div></div></div>`).join('')
          : '<p class="muted">No orders yet. <a class="link" href="#/shop">Start shopping</a></p>'}
      </div></div>
      <div>
        ${user.role === 'admin' ? `<div class="panel"><h2>Admin</h2><p class="muted" style="margin-bottom:14px">Manage stock, prices and orders.</p><a class="btn btn-primary btn-block" href="#/admin">Open admin panel</a></div>` : ''}
        <div class="panel"><h2>Your details</h2>
          <form id="profile-form" novalidate>
            <div class="field" style="margin-bottom:12px"><label for="pf-name">Name</label><input id="pf-name" value="${esc(user.name)}" required></div>
            <div class="field" style="margin-bottom:14px"><label for="pf-phone">Mobile number</label><input id="pf-phone" value="${esc(user.phone)}" inputmode="numeric" maxlength="10"></div>
            <button class="btn btn-ghost btn-block" type="submit">Save details</button><p class="form-error" hidden></p>
          </form></div>
        <div class="panel"><h2>${user.hasPassword ? 'Change password' : 'Set a password'}</h2>
          ${user.hasPassword ? '' : '<p class="muted" style="font-size:13.5px;margin-bottom:12px">You sign in with Google. Add a password to also sign in with email.</p>'}
          <form id="password-form" novalidate>
            ${user.hasPassword ? '<div class="field" style="margin-bottom:12px"><label for="pw-cur">Current password</label><input id="pw-cur" type="password" autocomplete="current-password"></div>' : ''}
            <div class="field" style="margin-bottom:14px"><label for="pw-new">New password</label><input id="pw-new" type="password" autocomplete="new-password" placeholder="At least 8 characters"></div>
            <button class="btn btn-ghost btn-block" type="submit">Update password</button><p class="form-error" hidden></p>
          </form></div>
        <div class="panel"><button class="btn btn-ghost btn-block" data-act="logout">Sign out</button></div>
      </div>
    </div></div><div class="sec"></div>`;
}

/* --------------------------------- admin -------------------------------- */

let inv = { products: [], q: '', cat: '', low: false };
let ordFilter = { status: '', q: '' };

async function Admin(tab = '') {
  if (!user) return needSignIn('Sign in with an admin account to continue.', '#/admin');
  if (user.role !== 'admin') return `<div class="wrap done"><h1>Admins only</h1><p class="muted" style="margin:12px 0 26px">This account does not have admin access.</p><a class="btn btn-primary" href="#/">Back to the shop</a></div>`;
  const tabs = [['', 'Overview'], ['inventory', 'Inventory'], ['orders', 'Orders'], ['messages', 'Messages']];
  const body = tab === 'inventory' ? await AdminInventory() : tab === 'orders' ? await AdminOrders() : tab === 'messages' ? await AdminMessages() : await AdminOverview();
  return `<div class="wrap"><div class="crumbs"><a href="#/">Home</a> / Admin</div>
    <div class="page-head" style="padding-bottom:18px"><h1>Admin</h1><p>Signed in as ${esc(user.email)}</p></div>
    <nav class="admin-tabs">${tabs.map(([k, l]) => `<a href="#/admin${k ? '/' + k : ''}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</nav>
    ${body}</div><div class="sec"></div>`;
}

async function AdminOverview() {
  const [s, { products }, { orders }] = await Promise.all([api('/admin/summary'), api('/admin/inventory'), api('/admin/orders')]);
  const low = products.flatMap(p => p.sizes.filter(z => z.stock <= LOW).map(z => ({ p, z })));
  return `<div class="stats">
      <div class="stat"><span>Today</span><b>${fmt(s.today.revenue)}</b><small>${s.today.orders} order(s)</small></div>
      <div class="stat"><span>This month</span><b>${fmt(s.month.revenue)}</b><small>${s.month.orders} order(s)</small></div>
      <div class="stat"><span>To ship</span><b>${s.toShip}</b><small><a class="link" href="#/admin/orders">View orders</a></small></div>
      <div class="stat"><span>Low stock</span><b>${s.lowStock}</b><small>${s.customers} customers · ${s.subscribers} subscribers</small></div>
    </div>
    <div class="acct" style="padding:0">
      <div class="panel"><h2>Recent orders</h2>
        ${orders.slice(0, 6).map(o => `<div class="order-row"><div><b>${o.number}</b><div class="meta">${esc(o.customerName || o.email)} · ${dateFmt(o.createdAt)}</div></div><div style="text-align:right"><b>${fmt(o.total)}</b><div style="margin-top:4px">${pill(o.status)}</div></div></div>`).join('') || '<p class="muted">No orders yet.</p>'}
      </div>
      <div class="panel"><h2>Running low</h2>
        ${low.map(({ p, z }) => `<div class="row" style="padding:6px 0"><span>${esc(p.name)} <span class="muted">· ${esc(z.label)}</span></span><b style="color:${z.stock ? 'var(--clay)' : '#8A3A2E'}">${z.stock ? z.stock + ' left' : 'Sold out'}</b></div>`).join('') || '<p class="muted">Everything is well stocked.</p>'}
        <a class="btn btn-ghost btn-block" style="margin-top:14px" href="#/admin/inventory">Update stock</a>
      </div>
    </div>`;
}

async function AdminInventory() {
  const [{ products }, { log }] = await Promise.all([api('/admin/inventory'), api('/admin/inventory/log')]);
  inv.products = products;
  return `<div class="admin-bar">
      <input type="search" id="inv-q" placeholder="Search product or SKU" value="${esc(inv.q)}">
      <select id="inv-cat"><option value="">All categories</option>${CATEGORIES.map(c => `<option value="${c.slug}" ${inv.cat === c.slug ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <label class="switch"><input type="checkbox" id="inv-low" ${inv.low ? 'checked' : ''}> Low stock only (${LOW} or fewer)</label>
    </div>
    <p class="muted" style="font-size:13px;margin-bottom:12px">Change a number, then press Save on that row. Untick “On sale” to hide a product from the shop without deleting it.</p>
    <div class="table-wrap"><table class="t">
      <thead><tr><th>Product</th><th>Size / SKU</th><th>Price ₹</th><th>MRP ₹</th><th>Stock</th><th></th><th>Shop</th></tr></thead>
      <tbody id="inv-body">${invRows()}</tbody>
    </table></div>
    <h2 style="font-size:28px;margin:40px 0 14px">Recent stock changes</h2>
    <div class="table-wrap"><table class="t">
      <thead><tr><th>When</th><th>Product</th><th>Change</th><th>Now</th><th>Reason</th><th>By</th></tr></thead>
      <tbody>${log.map(l => `<tr><td>${dateFmt(l.created_at)}</td><td>${esc(l.name)} <span class="muted">· ${esc(l.label)}</span></td><td style="color:${l.delta < 0 ? 'var(--clay)' : 'var(--olive)'};font-weight:700">${l.delta > 0 ? '+' : ''}${l.delta}</td><td>${l.stock_after}</td><td>${esc(l.reason)}</td><td class="muted">${esc(l.by_email || 'System')}</td></tr>`).join('')}</tbody>
    </table></div>`;
}

function invRows() {
  const q = inv.q.toLowerCase(); let rows = '';
  for (const p of inv.products) {
    if (inv.cat && p.category !== inv.cat) continue;
    if (q && !(p.name + ' ' + p.sizes.map(s => s.sku).join(' ')).toLowerCase().includes(q)) continue;
    const sizes = inv.low ? p.sizes.filter(s => s.stock <= LOW) : p.sizes;
    sizes.forEach((s, i) => {
      rows += `<tr class="${s.stock === 0 ? 'out' : s.stock <= LOW ? 'low' : ''} ${p.active ? '' : 'hidden-product'}" data-variant="${s.id}">
        <td>${i === 0 ? `<b>${esc(p.name)}</b><br><span class="muted" style="font-size:12.5px">${esc(catBySlug(p.category)?.name || p.category)}</span>` : ''}</td>
        <td>${esc(s.label)}<br><span class="muted" style="font-size:12px">${esc(s.sku)}</span></td>
        <td><input type="number" min="1" value="${s.price}" data-f="price" aria-label="Price"></td>
        <td><input type="number" min="1" value="${s.mrp ?? ''}" data-f="mrp" placeholder="—" aria-label="MRP"></td>
        <td><div class="stock-edit"><button type="button" data-act="inv-step" data-d="-1" aria-label="One less">−</button><input type="number" min="0" value="${s.stock}" data-f="stock" aria-label="Stock"><button type="button" data-act="inv-step" data-d="1" aria-label="One more">+</button></div></td>
        <td><button class="btn-sm" data-act="inv-save" disabled>Save</button></td>
        <td>${i === 0 ? `<label class="switch"><input type="checkbox" data-product="${p.id}" ${p.active ? 'checked' : ''}> On sale</label>` : ''}</td></tr>`;
    });
  }
  return rows || '<tr><td colspan="7" class="muted" style="padding:24px 14px">No matching products.</td></tr>';
}

async function saveVariant(tr) {
  const id = Number(tr.dataset.variant), btn = tr.querySelector('[data-act=inv-save]');
  const val = f => tr.querySelector(`[data-f=${f}]`).value.trim();
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const { variant } = await patch(`/admin/variants/${id}`, { stock: Number(val('stock')), price: Number(val('price')), mrp: val('mrp') === '' ? null : Number(val('mrp')) });
    for (const p of inv.products) { const s = p.sizes.find(z => z.id === id); if (s) Object.assign(s, variant); }
    tr.classList.toggle('out', variant.stock === 0);
    tr.classList.toggle('low', variant.stock > 0 && variant.stock <= LOW);
    toast(`Saved — ${variant.stock} in stock at ${fmt(variant.price)}`);
    btn.textContent = 'Saved';
    refreshProducts().catch(() => {});
  } catch (e) {
    toast(e.message); btn.disabled = false; btn.textContent = 'Save';
  }
}

async function AdminOrders() {
  const qs = new URLSearchParams(Object.entries(ordFilter).filter(([, v]) => v)).toString();
  const { orders } = await api('/admin/orders' + (qs ? '?' + qs : ''));
  const chips = [['', 'All'], ['placed', 'COD to ship'], ['paid', 'Paid to ship'], ['shipped', 'Shipped'], ['delivered', 'Delivered'], ['pending_payment', 'Awaiting payment'], ['cancelled', 'Cancelled']];
  return `<div class="admin-bar">
      <div class="chips">${chips.map(([k, l]) => `<button class="chip ${ordFilter.status === k ? 'on' : ''}" data-act="ord-status" data-s="${k}">${l}</button>`).join('')}</div>
      <form id="ord-search" style="display:flex;gap:8px;flex:1;min-width:240px"><input type="search" id="ord-q" placeholder="Order no., email or phone" value="${esc(ordFilter.q)}" style="flex:1"><button class="btn-sm" type="submit">Search</button></form>
    </div>
    ${orders.length ? orders.map(o => {
      const a = o.address;
      const next = { placed: 'shipped', paid: 'shipped', shipped: 'delivered' }[o.status];
      return `<details class="order-card"><summary>
        <b>${o.number}</b><span>${esc(o.customerName || a.firstName + ' ' + a.lastName)}<br><span class="muted" style="font-size:12.5px">${dateFmt(o.createdAt)}</span></span>
        <span class="hide-sm">${o.payMethod === 'cod' ? 'COD' : 'Online'}</span><b class="hide-sm">${fmt(o.total)}</b><span>${pill(o.status)}</span></summary>
        <div class="body">
          <div>
            <h4>Items</h4>
            ${o.items.map(i => `<div class="row"><span>${esc(i.name)} <span class="muted">· ${esc(i.size)} × ${i.qty}</span></span><span>${fmt(i.amount)}</span></div>`).join('')}
            <div class="row"><span class="muted">Shipping</span><span>${o.shipping ? fmt(o.shipping) : 'Free'}</span></div>
            <div class="row total"><span>Total</span><span>${fmt(o.total)}</span></div>
            <h4 style="margin-top:18px">Ship to</h4>
            <p>${esc(a.firstName)} ${esc(a.lastName)}<br>${esc(a.line1)}${a.line2 ? '<br>' + esc(a.line2) : ''}<br>${esc(a.city)}, ${esc(a.state)} – ${esc(a.pincode)}<br>${esc(o.phone)} · ${esc(o.email)}</p>
            ${o.giftMessage ? `<h4 style="margin-top:14px">Gift message</h4><p>${esc(o.giftMessage)}</p>` : ''}
            ${o.paymentId ? `<p class="muted" style="font-size:12.5px;margin-top:12px">Payment ID: ${esc(o.paymentId)}</p>` : ''}
          </div>
          <div>
            ${o.adminNote ? `<div class="warn">${esc(o.adminNote)}</div>` : ''}
            ${o.status === 'cancelled' ? '<p class="muted">This order is cancelled and its stock has been returned.</p>' : `
            <h4>Update status</h4>
            <select data-status-for="${o.number}">
              ${(o.status === 'pending_payment' ? ['pending_payment', 'cancelled'] : [o.status === 'paid' ? 'paid' : 'placed', 'shipped', 'delivered', 'cancelled'])
                .map(s => `<option value="${s}" ${s === (next || o.status) ? 'selected' : ''} ${s === 'pending_payment' ? 'disabled' : ''}>${STATUS[s]}</option>`).join('')}
            </select>
            <p class="muted" style="font-size:12.5px;margin:8px 0 12px">Cancelling puts the items back into stock.</p>
            <button class="btn-sm" data-act="ord-update" data-number="${o.number}">Update order</button>`}
          </div>
        </div></details>`;
    }).join('') : '<p class="muted">No orders match.</p>'}`;
}

async function AdminMessages() {
  const { messages, subscribers } = await api('/admin/messages');
  return `<div class="acct" style="padding:0">
    <div class="panel"><h2>Contact messages</h2>
      ${messages.map(m => `<div class="msg-item"><div class="row"><b>${esc(m.name)} <span class="muted" style="font-weight:400">· <a class="link" href="mailto:${esc(m.email)}">${esc(m.email)}</a></span></b><span class="muted" style="font-size:12.5px">${dateFmt(m.created_at)}</span></div>
        <p class="muted" style="font-size:12.5px;margin:2px 0 6px">${esc(m.topic)}</p><p style="white-space:pre-wrap">${esc(m.body)}</p></div>`).join('') || '<p class="muted">No messages yet.</p>'}
    </div>
    <div class="panel"><h2>Newsletter (${subscribers.length})</h2>
      ${subscribers.map(s => `<div class="row" style="font-size:14px;padding:4px 0"><span>${esc(s.email)}</span><span class="muted" style="font-size:12px">${dateFmt(s.created_at).split(',')[0]}</span></div>`).join('') || '<p class="muted">No subscribers yet.</p>'}
    </div></div>`;
}

/* ------------------------------ info pages ------------------------------ */

function About() {
  return `<div class="wrap"><div class="crumbs"><a href="#/">Home</a> / Our story</div>
    <div class="split">
      <div><span class="eyebrow">Our story</span><h1 style="font-size:clamp(40px,4.6vw,60px);margin:14px 0 18px">Rituals that don't cost the river.</h1>
        <p class="muted" style="font-size:17px">Virna began with a simple question: where do the flowers go after the aarti? Most of them end up in rivers and landfills. We thought they deserved a second life.</p></div>
      <div class="art" style="background:${TONES.sage}">${art({ slug: 'about' }, 'toran')}</div>
    </div>
    <div class="prose">
      <h2>What we make</h2>
      <p>Agarbatti and dhoop rolled from temple flowers and cow dung, without charcoal. Clay diyas painted by hand. Torans and petals dried so they last the season. Gift boxes that carry all of it, in paper.</p>
      <h2>What we won't use</h2>
      <p>Charcoal, synthetic fragrance fillers, plastic wrap, foam inserts. If something can't go back into the soil or be reused at home, we keep looking for an alternative.</p>
      <h2>Who makes it</h2>
      <p>Our products are made in small batches by artisan groups we work with directly. [Placeholder — to be replaced with Virna's own story, founders and partner details.]</p>
      <a href="#/shop" class="btn btn-primary" style="margin-top:14px">Shop the collection</a>
    </div></div><div class="sec"></div>`;
}

function Faq() {
  const qa = [
    ['How long does delivery take?', 'Orders are dispatched in 1–2 working days. Delivery takes 3–7 working days depending on your PIN code.'],
    ['Is shipping free?', `Shipping is free on orders above ${fmt(CONFIG.freeShippingOver)}. Below that, a flat ${fmt(CONFIG.shippingFee)} applies.`],
    ['Do you offer cash on delivery?', 'Yes, COD is available on most PIN codes across India.'],
    ['Do I need an account to order?', 'Yes — a free account lets you track your orders and saves your address for next time. You can sign up with email, or with Google in one click.'],
    ['What if something arrives broken?', 'Diyas are fragile. Send us a photo within 48 hours of delivery and we will send a replacement at no cost.'],
    ['Can I return an order?', 'Because these are consumable and ritual products, we can only accept returns for damaged or incorrect items.'],
    ['Are your agarbatti really charcoal-free?', 'Yes. We use natural binders like jigat instead of charcoal, which means less black smoke and a cleaner burn.'],
    ['Do you do bulk or corporate orders?', 'Yes — custom boxes, branded cards and delivery to multiple addresses on orders of 25 or more. Write to us from the Contact page.']
  ];
  return `<div class="wrap"><div class="crumbs"><a href="#/">Home</a> / FAQs</div>
    <div class="page-head"><h1>Questions, answered</h1><p>Shipping, returns and everything else. Can't find it? <a class="link" href="#/contact">Write to us</a>.</p></div>
    <div class="faq">${qa.map((x, i) => `<details class="acc" ${i === 0 ? 'open' : ''}><summary>${x[0]}</summary><div class="acc-body">${x[1]}</div></details>`).join('')}</div>
  </div><div class="sec"></div>`;
}

function Contact() {
  return `<div class="wrap"><div class="crumbs"><a href="#/">Home</a> / Contact</div>
    <div class="page-head"><h1>Get in touch</h1><p>Questions about an order, or planning a bulk gift? We reply within one working day.</p></div>
    <div class="contact">
      <dl><div><dt>Email</dt><dd><a class="link" href="mailto:hello@virna.in">hello@virna.in</a></dd></div>
        <div><dt>WhatsApp</dt><dd>To be added</dd></div>
        <div><dt>Hours</dt><dd>Monday to Saturday, 10am – 6pm</dd></div></dl>
      <form id="contact-form" novalidate>
        <div class="fields">
          <div class="field"><label for="cname">Name</label><input id="cname" value="${esc(user?.name)}" required></div>
          <div class="field"><label for="cemail">Email</label><input id="cemail" type="email" value="${esc(user?.email)}" required></div>
          <div class="field full"><label for="ctopic">Topic</label><select id="ctopic"><option>Order question</option><option>Bulk / corporate gifting</option><option>Something else</option></select></div>
          <div class="field full"><label for="cmsg">Message</label><textarea id="cmsg" required></textarea></div>
        </div>
        <button class="btn btn-primary" style="margin-top:16px" type="submit">Send message</button>
        <p class="form-error" hidden></p>
      </form>
    </div></div>`;
}

function NotFound() { return `<div class="wrap done"><h1>Page not found</h1><p class="muted" style="margin:12px 0 26px">That link doesn't lead anywhere.</p><a class="btn btn-primary" href="#/">Back to home</a></div>`; }

/* ================================ router ================================ */

let routeSeq = 0;
async function route({ keepScroll = false } = {}) {
  const seq = ++routeSeq;
  const [page = '', a = '', b = ''] = location.hash.replace(/^#\/?/, '').split('/');
  closeDrawers(); $('#searchbar').classList.remove('open');
  const views = {
    '': Home, shop: () => Shop(a), product: () => Product(a), checkout: Checkout, order: () => OrderPage(a),
    account: Account, admin: () => Admin(a), about: About, faq: Faq, contact: Contact, search: () => Search(decodeURIComponent(a))
  };
  let html = (views[page] || NotFound)();
  if (html instanceof Promise) {
    if (!keepScroll) app.innerHTML = '<div class="loading">Loading…</div>';
    try { html = await html; }
    catch (e) {
      if (e.status === 401) { user = null; updateHeader(); html = needSignIn('Please sign in again.', location.hash); }
      else html = `<div class="wrap done"><h1>Couldn't load this page</h1><p class="muted" style="margin:12px 0 26px">${esc(e.message)}</p><a class="btn btn-primary" href="#/">Back to home</a></div>`;
    }
  }
  if (seq !== routeSeq) return;
  const y = scrollY;
  app.innerHTML = html;
  scrollTo(0, keepScroll ? y : 0);
  document.querySelectorAll('.nav a').forEach(n => n.classList.toggle('on', n.getAttribute('href') === '#/' + [page, a].filter(Boolean).join('/')));
  const p = page === 'product' && bySlug(a);
  document.title = p ? `${p.name} — Virna` : page === 'shop' && catBySlug(a) ? `${catBySlug(a).name} — Virna` : page === 'admin' ? 'Admin — Virna' : 'Virna — Sustainable Pooja Essentials';
}

/* ================================ events ================================ */

function goCheckout() {
  closeDrawers();
  if (!user) openAuth({ reason: 'Sign in or create an account to check out. Your cart is saved.', next: '#/checkout' });
  else location.hash = '#/checkout';
}

document.addEventListener('click', async e => {
  if (e.target.id === 'auth') return closeAuth(); // backdrop
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act, variant = Number(el.dataset.variant), i = Number(el.dataset.i);
  const line = cart.find(l => l.variantId === variant);
  switch (act) {
    case 'add': addToCart(variant); break;
    case 'inc': if (line) { const st = VARIANTS.get(variant)?.s.stock ?? 0; if (line.qty < st) { line.qty++; saveCart(); } else toast(`Only ${st} in stock`); } break;
    case 'dec': if (line) { line.qty > 1 ? line.qty-- : cart.splice(cart.indexOf(line), 1); saveCart(); } break;
    case 'rm': if (line) { cart.splice(cart.indexOf(line), 1); saveCart(); } break;
    case 'open-cart': openDrawer('cart'); break;
    case 'menu': openDrawer('mmenu'); break;
    case 'close': closeDrawers(); break;
    case 'checkout': goCheckout(); break;
    case 'account': user ? (location.hash = '#/account') : openAuth(); break;
    case 'signin': openAuth({ next: el.dataset.next }); break;
    case 'close-auth': closeAuth(); break;
    case 'auth-tab': authTab(el.dataset.tab); break;
    case 'logout': await post('/auth/logout').catch(() => {}); user = null; updateHeader(); toast('Signed out'); location.hash = '#/'; break;
    case 'search': { const s = $('#searchbar'); s.classList.toggle('open'); if (s.classList.contains('open')) $('#q').focus(); break; }
    case 'size': pd.size = i; pd.qty = 1; refreshPdp(); break;
    case 'view': pd.view = i; refreshPdp(); break;
    case 'pd-inc': { const st = bySlug(location.hash.split('/')[2])?.sizes[pd.size]?.stock ?? 1; if (pd.qty < st) pd.qty++; else toast(`Only ${st} in stock`); $('#pd-qty').textContent = pd.qty; break; }
    case 'pd-dec': pd.qty = Math.max(1, pd.qty - 1); $('#pd-qty').textContent = pd.qty; break;
    case 'pd-add': { const p = byId(pd.id); addToCart(p.sizes[pd.size].id, pd.qty); break; }
    case 'pd-buy': { const p = byId(pd.id), s = p.sizes[pd.size]; const have = cart.find(l => l.variantId === s.id)?.qty || 0; if (have < pd.qty) addToCart(s.id, pd.qty - have, { open: false }); goCheckout(); break; }
    case 'inv-step': { const tr = el.closest('tr'), input = tr.querySelector('[data-f=stock]'); input.value = Math.max(0, (Number(input.value) || 0) + Number(el.dataset.d)); tr.querySelector('[data-act=inv-save]').disabled = false; tr.querySelector('[data-act=inv-save]').textContent = 'Save'; break; }
    case 'inv-save': saveVariant(el.closest('tr')); break;
    case 'ord-status': ordFilter.status = el.dataset.s; route({ keepScroll: true }); break;
    case 'ord-update': {
      const n = el.dataset.number, status = document.querySelector(`[data-status-for="${n}"]`).value;
      if (status === 'cancelled' && !confirm(`Cancel order ${n}? Its items will go back into stock.`)) return;
      el.disabled = true;
      try { await patch(`/admin/orders/${n}`, { status }); toast(`${n} → ${STATUS[status]}`); refreshProducts().catch(() => {}); route({ keepScroll: true }); }
      catch (err) { toast(err.message); el.disabled = false; }
      break;
    }
  }
});

document.addEventListener('change', async e => {
  const t = e.target;
  if (t.id === 'sort') {
    shopSort = t.value;
    const c = catBySlug(location.hash.split('/')[2]);
    $('#grid').innerHTML = sortList(c ? PRODUCTS.filter(p => p.category === c.slug) : PRODUCTS).map(card).join('');
  } else if (t.id === 'inv-cat' || t.id === 'inv-low') {
    inv.cat = $('#inv-cat').value; inv.low = $('#inv-low').checked; $('#inv-body').innerHTML = invRows();
  } else if (t.dataset.product) {
    try {
      await patch(`/admin/products/${t.dataset.product}`, { active: t.checked });
      const p = inv.products.find(x => x.id === t.dataset.product); p.active = t.checked;
      document.querySelectorAll('#inv-body tr').forEach(tr => { if (p.sizes.some(s => s.id === Number(tr.dataset.variant))) tr.classList.toggle('hidden-product', !t.checked); });
      toast(t.checked ? `${p.name} is back in the shop` : `${p.name} is hidden from the shop`);
      refreshProducts().catch(() => {});
    } catch (err) { toast(err.message); t.checked = !t.checked; }
  }
});

document.addEventListener('input', e => {
  const t = e.target;
  t.closest('.field.err')?.classList.remove('err');
  if (t.id === 'inv-q') { inv.q = t.value; $('#inv-body').innerHTML = invRows(); }
  const tr = t.closest('tr[data-variant]');
  if (tr) { const b = tr.querySelector('[data-act=inv-save]'); b.disabled = false; b.textContent = 'Save'; }
});

document.addEventListener('submit', async e => {
  const f = e.target;
  e.preventDefault();
  const showErr = msg => { const el = f.querySelector('.form-error'); if (el) { el.textContent = msg; el.hidden = false; } else toast(msg); };
  try {
    switch (f.id) {
      case 'search-form': { const q = $('#q').value.trim(); if (q) location.hash = '#/search/' + encodeURIComponent(q); break; }
      case 'co-form': await placeOrder(f); break;
      case 'login-form': case 'register-form': await submitAuth(f); break;
      case 'news-form': await post('/newsletter', { email: $('#nemail').value }); f.outerHTML = '<p style="margin-top:22px;font-weight:600">Thank you — you are on the list.</p>'; break;
      case 'contact-form':
        await post('/contact', { name: $('#cname').value, email: $('#cemail').value, topic: $('#ctopic').value, message: $('#cmsg').value });
        f.innerHTML = '<div class="form-ok" style="font-size:15px">Thank you — we will reply within one working day.</div>'; break;
      case 'profile-form': user = (await patch('/account/profile', { name: $('#pf-name').value, phone: $('#pf-phone').value })).user; toast('Details saved'); break;
      case 'password-form':
        await post('/account/password', { currentPassword: $('#pw-cur')?.value || '', newPassword: $('#pw-new').value });
        user.hasPassword = true; toast('Password updated'); route({ keepScroll: true }); break;
      case 'ord-search': ordFilter.q = $('#ord-q').value.trim(); route({ keepScroll: true }); break;
    }
  } catch (err) { showErr(err.message); }
});

document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDrawers(); if (!$('#auth').hidden) closeAuth(); } });

/* ================================= boot ================================= */

(async function boot() {
  try {
    const [cfg, cats, prods, me] = await Promise.all([api('/config'), api('/categories'), api('/products'), api('/auth/me')]);
    CONFIG = cfg; CATEGORIES = cats.categories; setProducts(prods.products); user = me.user;
  } catch (e) {
    app.innerHTML = `<div class="wrap done"><h1>We couldn't load the shop</h1><p class="muted" style="margin:12px 0 26px">${esc(e.message)}</p><button class="btn btn-primary" onclick="location.reload()">Try again</button></div>`;
    return;
  }
  $('#test-banner').hidden = !CONFIG.simulatedPayments;
  updateHeader();
  reconcileCart();
  window.addEventListener('hashchange', () => route());
  route();
})();
