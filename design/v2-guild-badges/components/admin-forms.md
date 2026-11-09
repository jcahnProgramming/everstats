# Admin forms (guild badges)

Owner-only, in the separate passkey-only admin account.

## Grant or revoke
- Pick a guild, then a **staff badge** (Featured Guild or Partner Guild).
- Optional event label and "show until" date (Featured only).
- **Required reason.** Revoke asks for its own reason. Everything is logged.

## Early Guild window
- Opens/closes date fields, a status tag ("Not set", "Open", "Closed") and a Save button.
- Guilds first tracked inside the window unlock Early Guild.
- Founding Guild uses the open-beta dates and can't be edited.

## Level thresholds
- Pick a levelled badge, then edit the I–V threshold inputs.
- A **preview histogram** shows how many guilds would hold each level with the new numbers.
- **Lowering** a threshold unlocks levels immediately. **Raising** one never removes a level a guild already holds.

## Partner guild mark
- Upload an emblem (SVG preferred; otherwise a transparent PNG at least 256px).
- **Preview in Forever, Alliance and Horde** at large, standard and inline sizes, plus as a small pill.
- Save stays disabled until "checked in all three themes" is ticked.

## Log
Records grants, revokes, mark updates and threshold changes.

Live states: `gallery/components.html` (`components-<theme>.png`) and `gallery/all-guild-badges.html` (`all-guild-badges-<theme>.png`).

## CSS reference (verbatim from guild-badges.css)
```css
.hist { display: grid; grid-template-columns: var(--es-space-40) minmax(0, 1fr) var(--es-space-72); gap: var(--es-space-8) var(--es-space-12); align-items: center; font-size: var(--es-fs-12-5); }
.hist .b { height: var(--es-space-12); border-radius: var(--es-radius-xs); background: var(--es-gbadge-progress); }

@media (max-width: 719px) {
  .hist { grid-template-columns: var(--es-space-32) minmax(0, 1fr) var(--es-space-56); }
}
```
