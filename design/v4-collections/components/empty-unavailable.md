# Empty and unavailable states

| State | Treatment |
|---|---|
| **Empty** (`.cempty`) | Dashed box, the collection glyph, "No {things} yet" and when it was last checked. Never hidden, never faked. |
| **Not returned** (`.cunavail`) | Solid sunken panel with the no-coverage icon: "Blizzard didn't return this", retry, last good snapshot, error code. |
| **Collected only** | v1 `.note` explaining that the full list isn't available. Calm, not a warning. |
| **Never fetched** | "Collections load on the next refresh", with Refresh now. |

`.anno` is a **mockup-only** dashed tag marking optional modules. It never ships.

Live: `gallery/components.html` · `gallery/components-<theme>.png`. Styles: `collections.css` (only `var(--es-*)`); excerpt copied from it:

```css
.anno { display: inline-flex; align-items: center; gap: var(--es-space-6); padding: var(--es-space-3) var(--es-space-8); border: var(--es-border-1) dashed var(--es-coll-optional-edge); border-radius: var(--es-radius-sm); font: var(--es-weight-semibold) var(--es-fs-11)/var(--es-lh-snug) var(--es-font-mono); color: var(--es-text-2); white-space: nowrap; }
.anno::before { content: "◇"; color: var(--es-accent-2); }
.cempty { border: var(--es-border-1-5) dashed var(--es-line-strong); border-radius: var(--es-radius-md); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--es-space-8); text-align: center; padding: var(--es-space-28) var(--es-space-20); }
.cempty .cg { color: var(--es-muted); }
.cempty .h3 { font-size: var(--es-fs-17); }
.cunavail { display: flex; gap: var(--es-space-14); align-items: flex-start; padding: var(--es-space-18) var(--es-space-20); border-radius: var(--es-radius-md); background: var(--es-sunken); border: var(--es-border-1) solid var(--es-line); color: var(--es-text-2); }
.cunavail .ico { color: var(--es-muted); }
.cunavail b { color: var(--es-text); }
```
