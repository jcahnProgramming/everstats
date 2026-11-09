# Admin grant / revoke form

Owner-only. Lives on its own Admin › Badges page, which belongs to the separate passkey-only admin account.

## Parts
- **Account:** find an account by `@username`. The panel shows display name, username, join date and linked providers, plus a table of the account's badges with source ("Granted by Admin" or "Automatic") and date.
  - Manual badges get a **Revoke** button (`.btn.danger`), which opens a v1 modal with a required reason.
- **Grant a badge:** a select listing **manual badges only** (Dev Team, Moderator, Pro Team Partner, Community Partner, Blizzard Employee, Discord Employee), a **required** reason textarea, and a "Notify the player" checkbox.
  - The Grant button stays disabled until there's a reason.
  - The error state is shown in the mockup.
- **Partner mark:** partner name, a dropzone (SVG preferred; otherwise a transparent PNG at least 256×256, square), and a **preview in Forever, Alliance and Horde** (`.preview3`, each column a `data-theme` subtree) at large, standard and inline sizes.
  - Save stays disabled until the "I've checked the preview" box is ticked.
- **Log:** when, action (Granted / Revoked / Mark updated), badge, account, reason. Append-only.

## Rules
- Every grant, revoke and mark change needs a reason and writes a log row.
- Pro Team Partner can't be granted until a mark has been uploaded for that partner.
- Blizzard and Discord Employee are meant to be verified automatically by work-email domain later. Until that exists, admin can grant them manually with a reason.

Live states: `gallery/components.html` (screenshots `gallery/components-<theme>.png`) and `gallery/all-badges.html` (all badges × sizes × states × dark/light panels, `all-badges-<theme>.png`).

## Tokens
v2 (`../tokens/badges.css`): `--es-badge-*`, `--es-size-badge*`. v1 (`../../v1/tokens/themes.css`): `--es-raised`, `--es-surface`, `--es-sunken`, `--es-line`, `--es-line-strong`, `--es-text`, `--es-text-2`, `--es-muted`, `--es-focus`, `--es-accent`, `--es-success`, `--es-shadow-toast`, spacing/radius/motion tokens.

## CSS reference (verbatim from badges.css)
```css
.dropzone { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--es-space-8); text-align: center; padding: var(--es-space-24); border: var(--es-border-1-5) dashed var(--es-line-strong); border-radius: var(--es-radius-lg); background: var(--es-sunken); color: var(--es-text-2); }
.dropzone:hover, .dropzone.is-hover { border-color: var(--es-accent); }
textarea.inp { height: auto; min-height: var(--es-space-88); padding: var(--es-space-10) var(--es-space-12); resize: vertical; font: var(--es-fs-14)/var(--es-lh-normal) var(--es-font-body); }
.preview3 { display: grid; gap: var(--es-space-12); grid-template-columns: repeat(auto-fit, minmax(min(var(--es-size-col-min-sm), 100%), 1fr)); }
.preview3 > div { display: flex; flex-direction: column; align-items: center; gap: var(--es-space-10); padding: var(--es-space-14); border-radius: var(--es-radius-lg); border: var(--es-border-1) solid var(--es-line-strong); background: var(--es-bg); }
```
