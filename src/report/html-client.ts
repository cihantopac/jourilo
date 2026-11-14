// Client behaviour of the report: language and theme (with saved preferences), tabs, filters, selection and the
// repair prompt dialog. The report renders fully without it; this only adds interaction. Untrusted text reaches the
// DOM only through textContent and the prompt textarea's value. Plain ES5 so it runs in every browser as is.

/** Runs in <head> before the first paint so a saved dark/light choice never flashes the other theme. */
export const HEAD_JS = `(function(){try{var t=localStorage.getItem('jourilo.theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export const REPORT_JS = String.raw`(function () {
'use strict';
var D = JSON.parse(document.getElementById('jourilo-data').textContent);
var I = D.i18n;
var store = {
  get: function (k) { try { return window.localStorage.getItem('jourilo.' + k); } catch (e) { return null; } },
  set: function (k, v) { try { window.localStorage.setItem('jourilo.' + k, v); } catch (e) { /* storage unavailable */ } }
};
function qsa(s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); }
function fill(tpl, v) {
  return String(tpl).replace(/\{(\w+)(:s)?\}/g, function (m, k, pl) { var x = v ? v[k] : undefined; if (pl) return Number(x) === 1 ? '' : 's'; return x === undefined ? '' : String(x); });
}
function t(key, v) { return fill((I[lang] && I[lang][key]) || I.en[key] || key, v); }

/* ---------- language ---------- */
var lang = store.get('lang');
if (lang !== 'en' && lang !== 'tr') {
  var prefs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
  lang = /^tr\b/i.test(prefs[0] || '') ? 'tr' : 'en';
}
function vars(el) { try { return el.getAttribute('data-i18n-v') ? JSON.parse(el.getAttribute('data-i18n-v')) : {}; } catch (e) { return {}; } }
function applyLang() {
  document.documentElement.lang = lang;
  qsa('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n'), vars(el)); });
  qsa('[data-i18n-attr]').forEach(function (el) {
    var v = vars(el);
    el.getAttribute('data-i18n-attr').split(';').forEach(function (pair) {
      var i = pair.indexOf('='); if (i > 0) el.setAttribute(pair.slice(0, i), t(pair.slice(i + 1), v));
    });
  });
  qsa('[data-rl]').forEach(function (el) { el.hidden = el.getAttribute('data-rl') !== lang; });
  qsa('[data-date]').forEach(function (el) {
    try { el.textContent = new Date(el.getAttribute('data-date')).toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { /* keep server text */ }
  });
  qsa('#lang button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === lang)); });
  applyFilters();
  updateBar();
}
qsa('#lang button').forEach(function (b) {
  b.addEventListener('click', function () { lang = b.getAttribute('data-lang'); store.set('lang', lang); applyLang(); });
});

/* ---------- theme ---------- */
function applyTheme(choice) {
  if (choice === 'light' || choice === 'dark') document.documentElement.setAttribute('data-theme', choice);
  else document.documentElement.removeAttribute('data-theme');
  qsa('#theme button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-theme') === choice)); });
}
var theme = store.get('theme');
if (theme !== 'light' && theme !== 'dark') theme = 'system';
applyTheme(theme);
qsa('#theme button').forEach(function (b) {
  b.addEventListener('click', function () { theme = b.getAttribute('data-theme'); store.set('theme', theme); applyTheme(theme); });
});

/* ---------- tabs ---------- */
var tabs = qsa('[role=tab]');
var panels = qsa('.panel');
function show(id, focus) {
  if (!document.getElementById(id)) return;
  tabs.forEach(function (b) {
    var on = b.getAttribute('aria-controls') === id;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    if (on && focus) b.focus();
  });
  panels.forEach(function (p) { p.hidden = p.id !== id; });
}
tabs.forEach(function (b, i) {
  b.addEventListener('click', function () { show(b.getAttribute('aria-controls')); });
  b.addEventListener('keydown', function (e) {
    var j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -2;
    if (j === -2) return;
    e.preventDefault();
    j = (j + tabs.length) % tabs.length;
    show(tabs[j].getAttribute('aria-controls'), true);
  });
});
/* Links to an item in another panel (#rc-…, #j-…) switch the panel first, then open and scroll to the item. */
function reveal(hash, smooth) {
  var id = decodeURIComponent(String(hash || '').replace(/^#/, ''));
  if (!id) return false;
  var el = document.getElementById(id);
  if (!el) return false;
  var panel = el.closest('.panel');
  if (panel) show(panel.id);
  var det = el.querySelector('details') || (el.tagName === 'DETAILS' ? el : null);
  if (det) det.open = true;
  if (el.hidden) { resetFilters(); }
  el.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
  var focusEl = el.querySelector('summary') || el;
  if (!focusEl.hasAttribute('tabindex') && focusEl.tagName !== 'SUMMARY') focusEl.setAttribute('tabindex', '-1');
  focusEl.focus({ preventScroll: true });
  return true;
}
document.addEventListener('click', function (e) {
  var a = e.target.closest && e.target.closest('a[href^="#"]');
  if (!a || a.classList.contains('skip')) return;
  var h = a.getAttribute('href');
  if (panels.some(function (p) { return '#' + p.id === h; })) { e.preventDefault(); show(h.slice(1)); return; }
  if (reveal(h, true)) { e.preventDefault(); history.replaceState(null, '', h); }
});
panels.forEach(function (p, i) { if (i > 0) p.hidden = true; });

/* ---------- filters ---------- */
var sels = qsa('.filters select');
function resetFilters() { sels.forEach(function (s) { s.value = ''; }); applyFilters(); }
function applyFilters() {
  var f = {};
  sels.forEach(function (s) { f[s.getAttribute('data-f')] = s.value; });
  var groups = 0, findings = 0;
  qsa('#findings .rc[data-kind]').forEach(function (el) {
    var ok = (!f.kind || el.getAttribute('data-kind') === f.kind) &&
      (!f.sev || el.getAttribute('data-sev') === f.sev) &&
      (!f.cat || el.getAttribute('data-cat') === f.cat) &&
      (!f.path || el.getAttribute('data-path') === f.path) &&
      (!f.page || (' ' + el.getAttribute('data-pages') + ' ').indexOf(' ' + f.page + ' ') >= 0);
    el.hidden = !ok;
    if (ok) { groups++; findings += Number(el.getAttribute('data-n') || 1); }
  });
  qsa('#findings .kgroup').forEach(function (g) { g.hidden = !g.querySelector('.rc:not([hidden])'); });
  var c = document.getElementById('fcount');
  if (c) c.textContent = t('f.count', { g: groups, n: findings });
  var none = document.getElementById('fnone');
  if (none) none.hidden = groups > 0;
}
sels.forEach(function (s) { s.addEventListener('change', applyFilters); });

/* ---------- selection ---------- */
var byId = {};
D.findings.forEach(function (f) { byId[f.id] = f; });
var selected = {};
function idsOf(box) { return (box.getAttribute('data-ids') || '').split(' ').filter(Boolean); }
function syncBoxes() {
  qsa('input.sel').forEach(function (box) {
    var ids = idsOf(box);
    var on = ids.filter(function (id) { return selected[id]; }).length;
    box.checked = on > 0 && on === ids.length;
    box.indeterminate = on > 0 && on < ids.length;
  });
  updateBar();
}
document.addEventListener('change', function (e) {
  var box = e.target;
  if (!box.classList || !box.classList.contains('sel')) return;
  idsOf(box).forEach(function (id) { if (box.checked) selected[id] = true; else delete selected[id]; });
  syncBoxes();
});
var selShown = document.getElementById('selshown');
if (selShown) selShown.addEventListener('click', function () {
  qsa('#findings .rc[data-kind]:not([hidden]) > .pick input.sel').forEach(function (box) { idsOf(box).forEach(function (id) { selected[id] = true; }); });
  syncBoxes();
});
var bar = document.getElementById('actionbar');
function selectedList() {
  var order = { critical: 0, serious: 1, moderate: 2, minor: 3, info: 4 };
  var pathOrder = { auto: 0, agent: 1, manual: 2, experiment: 3 };
  return Object.keys(selected).map(function (id) { return byId[id]; }).filter(Boolean).sort(function (a, b) {
    return (pathOrder[a.path] - pathOrder[b.path]) || (order[a.sev] - order[b.sev]) || (a.title < b.title ? -1 : 1);
  });
}
/* One prompt item per root cause: findings of the same group become one entry listing every page and id. */
function promptItems() {
  var out = [], lead = {};
  selectedList().forEach(function (f) {
    var l = lead[f.rc];
    if (!l) { l = lead[f.rc] = JSON.parse(JSON.stringify(f)); l.also = []; out.push(l); }
    else l.also.push({ id: f.id, url: f.url, vp: f.vp });
  });
  return out;
}
function updateBar() {
  if (!bar) return;
  var n = selectedList().length;
  bar.hidden = n === 0;
  var c = document.getElementById('selcount');
  if (c) c.textContent = t('ab.selected', { n: n });
}
var clearBtn = document.getElementById('selclear');
if (clearBtn) clearBtn.addEventListener('click', function () { selected = {}; syncBoxes(); });

/* ---------- repair prompt ---------- */
function runDir() {
  if (location.protocol !== 'file:') return '';
  var p = decodeURIComponent(location.pathname);
  p = p.slice(0, p.lastIndexOf('/'));
  return /^\/[A-Za-z]:/.test(p) ? p.slice(1) : p;
}
function nonce() {
  var a = new Uint8Array(9);
  try { window.crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); }
  return Array.prototype.map.call(a, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
}
var dlg = document.getElementById('prompt');
var area = document.getElementById('prompt-text');
var status = document.getElementById('prompt-status');
var opener = null;
function openPrompt(e) {
  var list = promptItems();
  if (!list.length || !dlg) return;
  opener = e && e.currentTarget;
  area.value = JouriloPrompt.build({ lang: lang, nonce: nonce(), dir: runDir(), run: D.run, items: list });
  var c = { auto: 0, agent: 0, manual: 0, experiment: 0 };
  list.forEach(function (f) { c[f.path]++; });
  var mix = document.getElementById('prompt-mix');
  mix.removeAttribute('data-i18n');
  mix.textContent = t('pr.mix', { a: c.auto, g: c.agent, m: c.manual, e: c.experiment }).split(' · ').filter(function (p) { return !/^0\s/.test(p); }).join(' · ');
  status.textContent = '';
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  area.focus();
  area.setSelectionRange(0, 0);
  area.scrollTop = 0;
}
function closePrompt() {
  if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
}
if (dlg) {
  dlg.addEventListener('close', function () { if (opener && opener.focus) opener.focus(); });
  document.getElementById('prompt-close').addEventListener('click', closePrompt);
  document.getElementById('prompt-copy').addEventListener('click', function () {
    function fallback() {
      area.focus(); area.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      status.textContent = ok ? t('pr.copied') : t('pr.copyBlocked');
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(area.value).then(function () { status.textContent = t('pr.copied'); }, fallback);
      } else fallback();
    } catch (e) { fallback(); }
  });
  document.getElementById('prompt-download').addEventListener('click', function () {
    var file = 'jourilo-repair-' + String(D.run.id).replace(/[^A-Za-z0-9-]/g, '') + '.md';
    var url = URL.createObjectURL(new Blob([area.value], { type: 'text/markdown;charset=utf-8' }));
    var a = document.createElement('a');
    a.href = url; a.download = file; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    status.textContent = t('pr.downloaded', { f: file });
  });
}
qsa('[data-action=prompt]').forEach(function (b) { b.addEventListener('click', openPrompt); });

/* Sticky filter bar sits right under the sticky masthead, whatever its height. */
function mastHeight() { var m = document.querySelector('.mast'); if (m) document.documentElement.style.setProperty('--mast-h', m.offsetHeight + 'px'); }
window.addEventListener('resize', mastHeight);
mastHeight();
applyLang();
if (!reveal(location.hash, false)) show(panels[0].id);
})();`;
