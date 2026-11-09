/* Everstats layout pass for share cards (0.8.1). Loaded after the kit's fill.js; the renderer calls
   window.everstatsLayout() once <html data-ready="1"> is set (data bound, images and fonts loaded) and screenshots
   after it returns. It only measures and sizes: it never changes a word or a number.

     1. tiles (.stats, .cats, guild .totals): widths so the last row is never left half empty
     2. names: one line first (shrinking to 60%); only a name that still doesn't fit wraps, at a stepped-down size
     3. the render panel: the figure (already cut to its outline on the server) is sized from the panel, head near the
        top of the ring, feet near the bottom, centred; the ring is sized from the panel too, and both stay above the
        gear strip when it shows
     4. (0.9.0) the guild tier bar: Unranked members get their own line under the bar (CARD_DATA.tiers_unranked); the
        bar itself holds ranked letters only. The bar and the line share the bar's grid area in one wrapper. */
(function () {
  function visible(e) { return !e.hidden && getComputedStyle(e).display !== 'none'; }
  function overflows(e) { return e.scrollWidth > e.clientWidth + 1; }

  function tiles(card) {
    card.querySelectorAll('.stats, .cats, .t-guild .totals').forEach(function (list) {
      if (!visible(list)) return;
      var items = Array.prototype.filter.call(list.children, visible);
      var n = items.length;
      if (!n) return;
      var max = parseInt(getComputedStyle(list).getPropertyValue('--max-cols'), 10) || 3;
      var rows = Math.ceil(n / max);
      var cols = Math.ceil(n / rows);
      var gap = parseFloat(getComputedStyle(list).columnGap) || 0;
      var w = (list.clientWidth - gap * (cols - 1)) / cols;
      list.setAttribute('data-n', String(n));
      items.forEach(function (e) { e.style.flex = '0 0 ' + Math.floor(w) + 'px'; e.style.maxWidth = Math.floor(w) + 'px'; });
    });
  }

  function names(card) {
    card.querySelectorAll('.cname[data-fit]').forEach(function (h) {
      h.style.fontSize = '';
      h.classList.add('one');
      h.classList.remove('two');
      var base = parseFloat(getComputedStyle(h).fontSize);
      var s = base;
      var n = 0;
      while (overflows(h) && s > base * 0.6 && n++ < 60) { s *= 0.97; h.style.fontSize = s + 'px'; }
      if (!overflows(h)) return;
      h.classList.remove('one');
      h.classList.add('two');
      s = base * 0.8;
      h.style.fontSize = s + 'px';
      n = 0;
      while (overflows(h) && s > base * 0.5 && n++ < 60) { s *= 0.97; h.style.fontSize = s + 'px'; }
    });
  }

  /* the gear strip: rows of equal length (16 icons → 8 + 8, never 15 + 1), icons as large as the kit drew them or
     smaller to make that fit */
  function gearRows(fr) {
    var gear = fr.querySelector(':scope > .cgear');
    if (!gear || !visible(gear)) return;
    var icons = Array.prototype.slice.call(gear.children);
    var n = icons.length;
    if (!n) return;
    var size = icons[0].offsetWidth;
    var gap = parseFloat(getComputedStyle(gear).columnGap) || 0;
    var avail = gear.clientWidth - parseFloat(getComputedStyle(gear).paddingLeft) - parseFloat(getComputedStyle(gear).paddingRight);
    var fit = Math.max(1, Math.floor((avail + gap) / (size + gap)));
    var rows = Math.ceil(n / fit);
    // more than two rows eats the figure's height: two rows of slightly smaller icons, if they stay ≥ 60% of the kit's
    if (rows > 2 && (avail - gap * (Math.ceil(n / 2) - 1)) / Math.ceil(n / 2) >= size * 0.6) rows = 2;
    var perRow = Math.ceil(n / rows);
    var s = Math.min(size, Math.floor((avail - gap * (perRow - 1)) / perRow));
    icons.forEach(function (i) { i.style.width = s + 'px'; i.style.height = s + 'px'; });
    gear.style.maxWidth = (perRow * s + (perRow - 1) * gap + (gear.clientWidth - avail) + 1) + 'px';
    gear.style.marginLeft = 'auto';
    gear.style.marginRight = 'auto';
  }

  function renderPanels(card) {
    card.querySelectorAll('.rframe').forEach(function (fr) {
      gearRows(fr);
      var W = fr.clientWidth;
      var H = fr.clientHeight;
      if (!W || !H) return;
      var gear = fr.querySelector(':scope > .cgear');
      var floor = H;
      if (gear && visible(gear) && gear.children.length) floor = gear.offsetTop - Math.max(6, H * 0.02);
      var d = Math.min(W * 0.9, floor * 0.96);
      var cy = floor / 2;
      var ring = fr.querySelector(':scope > .ring');
      if (ring) { ring.style.width = d + 'px'; ring.style.top = cy + 'px'; }
      var img = fr.querySelector(':scope > img');
      if (!img || !visible(img) || !img.naturalWidth) return;
      var ar = img.naturalWidth / img.naturalHeight;
      var fh = d * 0.86;
      var fw = fh * ar;
      if (fw > W * 0.94) { fw = W * 0.94; fh = fw / ar; }
      img.style.left = (W / 2 - fw / 2) + 'px';
      img.style.top = (cy - fh / 2) + 'px';
      img.style.bottom = 'auto';
      img.style.width = fw + 'px';
      img.style.height = fh + 'px';
    });
  }

  function tierLine(card) {
    var bar = card.querySelector('.ctierbar');
    var text = (window.CARD_DATA || {}).tiers_unranked;
    if (!bar || !text || bar.parentNode.classList.contains('ctierwrap')) return;
    var wrap = document.createElement('div');
    wrap.className = 'ctierwrap a-d';
    bar.parentNode.insertBefore(wrap, bar);
    bar.classList.remove('a-d');
    wrap.appendChild(bar);
    var line = document.createElement('span');
    line.className = 'ctierunr';
    line.textContent = text;
    wrap.appendChild(line);
  }

  window.everstatsLayout = function () {
    var card = document.querySelector('[data-card]');
    if (!card) return false;
    names(card);
    tierLine(card);
    tiles(card);
    renderPanels(card);
    document.documentElement.setAttribute('data-laid-out', '1');
    return true;
  };
})();
