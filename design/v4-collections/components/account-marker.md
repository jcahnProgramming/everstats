# Account-wide marker

The two-figure glyph (`--es-coll-acct`) **always with text**:

- "Shared across this account" (default and `.tagged` pill)
- "Account" (compact)

It appears on count cards, section headers, screen headers, the board "Scope" row and share cards. Share cards explain it once with a key.

**Detection:** shown only when real data shows the collection is identical across the account's characters. It's removed automatically if later data disagrees.

Live: `gallery/components.html` · `gallery/components-<theme>.png`. Styles: `collections.css` (only `var(--es-*)`); excerpt copied from it:

```css
.acct { display: inline-flex; align-items: center; gap: var(--es-space-5); font-size: var(--es-fs-12); color: var(--es-text-2); white-space: nowrap; }
.acct svg { width: var(--es-size-icon-sm); height: var(--es-size-icon-sm); stroke: var(--es-coll-acct); fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.acct.tagged { padding: var(--es-space-4) var(--es-space-8); border-radius: var(--es-radius-pill); border: var(--es-border-1) solid color-mix(in oklab, var(--es-coll-acct) 45%, var(--es-line)); background: color-mix(in oklab, var(--es-coll-acct) 8%, transparent); }
```
