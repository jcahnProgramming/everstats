# Tab switcher

v1 `.tabs`, where each tab is a link with its own URL and an optional count (`.count`). Used for:

- Inbox: Feedback · Reports
- Directory: Accounts · Characters · Guilds
- Badges: Player · Guild
- Data: Crawler · Collections & catalogs · Backups
- Discovery

On phones the tabs scroll sideways.

Live: `gallery/components.html` · `gallery/components-<theme>.png`. Styles: `admin.css` (only `var(--es-*)`); excerpt copied from it:

```css
.ahead .tabs [role="tab"] { min-height: var(--es-size-control-md); font-size: var(--es-fs-13-5); text-decoration: none; }
  .ahead .tabs { overflow-x: auto; }
```
