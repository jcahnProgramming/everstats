# Navigation (top bar)

**Chosen option: A · Ledger Bar** — one row: emblem mark + “Everstats” wordmark, Leaderboards, Guilds (and Admin for the owner), search, Sign in / Account. Options B (Atlas Rail) and C (Ruleset Banner) are kept for reference in `gallery/navigation-options.html`.

Live states: `gallery/components.html` (screenshots `gallery/components-<theme>.png`). Styles: `components.css` (excerpt below is copied verbatim from it).

## Anatomy
- `.brand` — 30px mark (assets/emblem/mark.svg, inlined) + Cinzel 700 20px wordmark.
- `.navlinks` — 44px-tall links; current page `aria-current="page"` shows a 2px `--es-accent` underline.
- Search box (desktop only).
- Account: logged-out `Sign in` (`.btn.sm`); logged-in avatar + “Account” (`.btn.sm.ghost`).
- Phone: links, search and account collapse into two 44px icon buttons (search, menu). The menu opens a sheet with Leaderboards, Guilds, Sign in/Account.

## Sizes & spacing
All values are tokens in `../tokens/themes.css`; px shown for reference (1rem = 16px).

| Part | Value | Notes |
|---|---|---|
| Height | 64px desktop (min), 56px phone |  |
| Gap | 20px desktop, 6px phone |  |
| Container | max 1240px, 24px side padding (16px phone) |  |

## States
| State | Treatment |
|---|---|
| Default | Background `--es-topbar-bg` (82% bg), 1px `--es-line` bottom border. |
| Hover | Links go `--es-text-2` → `--es-text`. |
| Focus | 2px focus ring on each link/button. |
| Active (current) | `aria-current="page"` → `--es-text` + inset 2px accent underline. |
| Disabled | n/a. |
| Loading | n/a (static chrome). |

## Tokens used
- `--es-topbar-bg`, `--es-line`, `--es-text`, `--es-text-2`, `--es-accent`
- `--es-size-topbar`, `--es-size-topbar-phone`, `--es-size-brand-mark`, `--es-size-control`

## HTML reference
```html
<header class="topbar"><div class="wrap in">
  <a class="brand" href="/"><svg viewBox="0 0 64 64" aria-hidden="true">…mark…</svg>Everstats</a>
  <nav class="navlinks" aria-label="Primary"><a href="/leaderboards" aria-current="page">Leaderboards</a><a href="/guilds">Guilds</a></nav>
  <span class="spacer"></span>
  <label class="search">…</label>
  <a class="btn sm signin" href="/sign-in">Sign in</a>
  <button class="btn ghost icon nav-icon" aria-label="Search">…</button>
  <button class="btn ghost icon nav-icon" aria-label="Menu">…</button>
</div></header>
```

## CSS reference (from components.css)
```css
.topbar { background: var(--es-topbar-bg); border-bottom: var(--es-border-1) solid var(--es-line); }
.topbar .in { display: flex; align-items: center; gap: var(--es-space-20); flex-wrap: wrap; min-height: var(--es-size-topbar); padding-top: var(--es-space-10); padding-bottom: var(--es-space-10); }
.brand { display: inline-flex; align-items: center; gap: var(--es-space-10); font: var(--es-weight-bold) var(--es-fs-20)/var(--es-lh-none) var(--es-font-display); letter-spacing: var(--es-tracking-brand); color: var(--es-text) !important; text-decoration: none; }
.brand svg { width: var(--es-size-brand-mark); height: var(--es-size-brand-mark); }
.navlinks { display: flex; gap: var(--es-space-2); }
.navlinks a { display: inline-flex; align-items: center; min-height: var(--es-size-control); padding: 0 var(--es-space-12); color: var(--es-text-2); text-decoration: none; font-weight: var(--es-weight-medium); }
.navlinks a:hover { color: var(--es-text); }
.navlinks a[aria-current="page"] { color: var(--es-text); box-shadow: inset 0 calc(var(--es-border-2) * -1) 0 var(--es-accent); }
.btn.nav-icon { display: none; }

@media (max-width: 719px) {
  .topbar .in { min-height: var(--es-size-topbar-phone); gap: var(--es-space-6); flex-wrap: nowrap; padding-top: var(--es-space-6); padding-bottom: var(--es-space-6); }
  .topbar .navlinks, .topbar .search, .topbar .signin { display: none; }
  .brand { font-size: var(--es-fs-18); }
  .brand svg { width: var(--es-size-brand-mark-phone); height: var(--es-size-brand-mark-phone); }
  .btn.nav-icon { display: inline-flex; }
}
```
