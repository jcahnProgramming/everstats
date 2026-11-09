/* Everstats share-card filler. The server (or the card maker preview) sets window.CARD_DATA and loads this file.
   Bindings:
     data-slot="a.b"        → textContent (always escaped)
     data-slot-src="a.b"    → <img src>
     data-slot-html="a.b"   → innerHTML — ONLY for server-generated badge/emblem SVG, never user text
     data-if="a.b"          → hidden when falsy        data-if-not="a.b" → hidden when truthy
     data-class="a.b"       → adds the value as a class
     data-slot-width="a.b"  → style.width = value + '%' (progress bars)
     data-fit               → text is shrunk (to 55% minimum) until it fits its box
     data-repeat="a.list"   → clones its single [data-item] child per entry; inside it use
                              data-f / data-f-html / data-f-class / data-f-width (percent)
   Overrides for previews: ?theme=forever|alliance|horde&accent=accent|c2|c3|c4|c5
   When done: <html data-ready="1"> — renderers wait for this before taking the screenshot. */
(function () {
  var d = window.CARD_DATA || {};
  var q = new URLSearchParams(location.search);
  function get(o, p) { return p.split('.').reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
  var card = document.querySelector('[data-card]');
  var theme = q.get('theme') || d.theme || 'forever';
  var accent = q.get('accent') || d.accent || 'accent';
  document.documentElement.setAttribute('data-theme', theme);
  card.style.setProperty('--card-accent', 'var(--es-' + accent + ')');
  if (q.get('norender') === '1') d.render = null;
  function qa(root, sel) { var l = Array.prototype.slice.call(root.querySelectorAll(sel)); if (root.matches && root.matches(sel)) l.unshift(root); return l; }
  function fill(root, ctx, item) {
    var g = item ? function (k) { return get(item, k); } : function (k) { return get(ctx, k); };
    var pre = item ? 'data-f' : 'data-slot';
    qa(root, '[' + pre + ']').forEach(function (e) { if (!item && e.closest('[data-item]')) return; var v = g(e.getAttribute(pre)); e.textContent = v == null ? '' : v; });
    qa(root, '[' + pre + '-html]').forEach(function (e) { if (!item && e.closest('[data-item]')) return; e.innerHTML = g(e.getAttribute(pre + '-html')) || ''; });
    if (item) {
      qa(root, '[data-f-class]').forEach(function (e) { var v = g(e.getAttribute('data-f-class')); if (v) e.classList.add.apply(e.classList, String(v).split(' ')); });
      qa(root, '[data-f-width]').forEach(function (e) { e.style.width = g(e.getAttribute('data-f-width')) + '%'; });
      qa(root, '[data-f-src]').forEach(function (e) { var v = g(e.getAttribute('data-f-src')); if (v) e.src = v; else e.remove(); });
    }
  }
  document.querySelectorAll('[data-repeat]').forEach(function (list) {
    var tpl = list.querySelector('[data-item]'); var items = get(d, list.getAttribute('data-repeat')) || [];
    tpl.remove();
    items.forEach(function (it) { var c = tpl.cloneNode(true); c.removeAttribute('data-item'); fill(c, d, it); if (it && it.cls) c.classList.add.apply(c.classList, String(it.cls).split(' ')); list.appendChild(c); });
  });
  fill(document, d, null);
  document.querySelectorAll('[data-slot-src]').forEach(function (e) { var v = get(d, e.getAttribute('data-slot-src')); if (v) e.src = v; });
  document.querySelectorAll('[data-if]').forEach(function (e) { if (!get(d, e.getAttribute('data-if'))) e.hidden = true; });
  document.querySelectorAll('[data-if-not]').forEach(function (e) { if (get(d, e.getAttribute('data-if-not'))) e.hidden = true; });
  document.querySelectorAll('[data-slot-width]').forEach(function (e) { var v = get(d, e.getAttribute('data-slot-width')); if (v != null) e.style.width = v + '%'; });
  document.querySelectorAll('[data-class]').forEach(function (e) { var v = get(d, e.getAttribute('data-class')); if (v) e.classList.add.apply(e.classList, String(v).split(' ')); });
  // shrink-to-fit: [data-fit] text never overflows its box (long names); floor at 55% of the token size
  function fit() {
    document.querySelectorAll('[data-fit]').forEach(function (e) {
      var base = parseFloat(getComputedStyle(e).fontSize), s = base, n = 0;
      while (e.scrollWidth > e.clientWidth + 1 && s > base * 0.55 && n++ < 40) { s *= 0.96; e.style.fontSize = s + 'px'; }
    });
  }
  var imgs = Array.prototype.slice.call(document.images);
  Promise.all(imgs.map(function (i) { return i.complete ? 0 : new Promise(function (r) { i.onload = i.onerror = r; }); }))
    .then(function () { return document.fonts ? document.fonts.ready : 0; })
    .then(function () { fit(); })
    .then(function () { document.documentElement.setAttribute('data-ready', '1'); });
})();
