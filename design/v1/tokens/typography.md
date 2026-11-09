# Typography

Three families, all **SIL Open Font License 1.1** (free for commercial use, embedding and redistribution). Source: Google Fonts. Self-hosted copies (Latin subset, woff2) and licence texts are in `../assets/fonts/` with `fonts.css` declaring the `@font-face` rules — the mockups use those, so nothing loads from a third party.

| Role | Family | Weights shipped | Token | Fallback stack |
|---|---|---|---|---|
| Display — headings, character names, tier letters, rank numerals, brand wordmark | **Cinzel** (Natanael Gama) · fonts.google.com/specimen/Cinzel | 500, 600, 700, 800 | `--es-font-display` | 'Trajan Pro', Georgia, 'Times New Roman', serif |
| Body & data — UI text, all numbers, tables | **Inter** (Rasmus Andersson) · fonts.google.com/specimen/Inter | 400, 500, 600, 700 | `--es-font-body` | system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif |
| Utility — API keys, version tag, recovery codes, OTP, code | **JetBrains Mono** · fonts.google.com/specimen/JetBrains+Mono | 400, 500 | `--es-font-mono` | ui-monospace, SFMono-Regular, Menlo, Consolas, monospace |

Google Fonts URL if you prefer hosted: `https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap`

## Rules
- **Cinzel never sets body copy, table cells or values.** Cinzel is all-caps-styled small caps by design; lowercase letters render as small capitals.
- **Every number uses Inter with tabular, lining figures**: `font-variant-numeric: tabular-nums lining-nums`. Applied automatically to `td`, `.v`, `.num`, `.big`. Exception: rank numerals in tables (`.rk`) are Cinzel 700 with tabular nums.
- Inter character variant `cv11` (single-storey a) is on globally: `font-feature-settings: 'cv11' 1`.
- Uppercase is only used for eyebrows, table headers and tags (with positive tracking).
- `text-wrap: balance` on hero headline, `text-wrap: pretty` on lead paragraphs.
- Minimum text size 11px (eyebrows/table headers only, 600 weight, uppercase). Body minimum 12px.

## Type scale
| Style | Family | Size token | Size | Weight | Line height | Tracking | Use |
|---|---|---|---|---|---|---|---|
| Hero | Cinzel | `--es-fs-hero` | clamp(40px, 5vw, 64px) | 700 | 1.05 `--es-lh-tight` | 0.02em `--es-tracking-display` | Home headline |
| Display | Cinzel | `--es-fs-display` | clamp(36px, 4.4vw, 56px); 32px phone | 700 | 1.05 | 0.02em | Character / guild name |
| H1 | Cinzel | `--es-fs-44` | 44px; 30px phone | 700 | 1.2 `--es-lh-snug` | 0.02em | Page titles |
| H2 | Cinzel | `--es-fs-24` (22px in panels) | 24px | 700 | 1.2 | 0.03em `--es-tracking-heading` | Section titles |
| H3 | Cinzel | `--es-fs-18` | 18px | 700 | 1.2 | 0.03em | Category headers, card titles |
| Brand | Cinzel | `--es-fs-20` | 20px; 18px phone | 700 | 1 | 0.04em `--es-tracking-brand` | Wordmark |
| Tier letter L/M/S | Cinzel | `--es-size-tier-{lg,md,sm}-font` | 70 / 22 / 13px | 800 | 1 | 0 | Badges |
| Rank numeral | Cinzel | `--es-fs-15` (17 phone list, 18 guild) | 15px | 700 | 1.45 | 0 | Leaderboards |
| Stat KPI | Inter | `--es-fs-32` / `--es-fs-28` | 32 / 28px | 600 | 1.2 | 0 | Chart KPI, stat card |
| Lead | Inter | `--es-fs-17` | 17px | 400 | 1.6 `--es-lh-relaxed` | 0 | Home pitch |
| Stat value | Inter | `--es-fs-16` | 16px | 600 | 1.45 | 0 | Stat rows |
| Body | Inter | `--es-fs-14` | 14px | 400 | 1.45 `--es-lh-normal` | 0 | Default |
| Table cell | Inter | `--es-fs-14` | 14px | 400 / 600 values | 1.45 | 0 | Tables |
| Small | Inter | `--es-fs-13` | 13px | 400 | 1.45 | 0 | Secondary copy |
| Meta | Inter | `--es-fs-12-5` / `--es-fs-12` | 12.5 / 12px | 400 | 1.45 | 0 | Freshness, captions |
| Eyebrow | Inter | `--es-fs-11` | 11px | 600 | 1.2 | 0.14em `--es-tracking-eyebrow` | Section labels (uppercase) |
| Table header | Inter | `--es-fs-11` | 11px | 600 | 1.45 | 0.08em `--es-tracking-th` | `th` (uppercase) |
| Tag | Inter | `--es-fs-11` | 11px | 600 | 1 | 0.06em `--es-tracking-tag` | Tags (uppercase) |
| Mono | JetBrains Mono | `--es-fs-13`–`--es-fs-14-5` | 13–14.5px | 400/500 | 1.45 | 0.06em `--es-tracking-code` | Keys, codes, version |
| OTP | JetBrains Mono | `--es-fs-18` / `--es-fs-24` | 18 / 24px | 400 | 1 | 0.3em / 0.4em | 2FA inputs |

All size tokens: `--es-fs-10`, `--es-fs-11`, `--es-fs-11-5`, `--es-fs-12`, `--es-fs-12-5`, `--es-fs-13`, `--es-fs-13-5`, `--es-fs-14`, `--es-fs-14-5`, `--es-fs-15`, `--es-fs-16`, `--es-fs-17`, `--es-fs-18`, `--es-fs-20`, `--es-fs-22`, `--es-fs-24`, `--es-fs-26`, `--es-fs-28`, `--es-fs-30`, `--es-fs-32`, `--es-fs-40`, `--es-fs-44`, `--es-fs-48`, `--es-fs-56`, `--es-fs-70`, `--es-fs-display`, `--es-fs-hero`.
