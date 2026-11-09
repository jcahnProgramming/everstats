# Error — Blizzard API unavailable

**When:** Blizzard API down/timeouts.

**Appears on:** Any page that fetches live: character (refresh or first lookup), leaderboard (rebuild), admin key test. Toast variant for background refresh failures.

**Design:** Two forms: (1) cached data exists → red-bordered inline alert above content “Showing the last snapshot from [Date]” + Retry; (2) no cache → centred error panel with Try again / Browse leaderboards and a small mono status line.

Mockup: `index.html` (open with `?theme=alliance` / `?theme=horde`). Screenshots: `desktop-{forever,alliance,horde}.png` (1440px) and `phone-{forever,alliance,horde}.png` (390px).
