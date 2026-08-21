/**
 * Role color language + iconography (Art Bible §3) — single source of truth
 * shared by draft cards, prep roster cards, the pedestal name plate, and any
 * future collection UI. Role color NEVER appears alone: every chip pairs the
 * color with an icon and the role name text (Art Bible §4 accessibility rule).
 */
import type { Role } from '@arena/contracts';

/** Art Bible §3 role color families. */
export const ROLE_COLORS: Record<Role, string> = {
  vanguard: '#e0384a', // crimson red — first through the wall
  defender: '#3f6fd8', // cobalt blue — immovable
  bruiser: '#e0782e', // burnt orange — blunt force
  skirmisher: '#f2d022', // electric yellow — fast, slippery
  artillery: '#c44fe0', // magenta/violet — reach and payload
  controller: '#31c9d4', // teal/cyan — the battlefield bends
  support: '#3ecb7a', // emerald green — keeps the team standing
  tactician: '#dfe5f0', // white/silver — the plan is the weapon
};

export function roleColor(role: string): string {
  return ROLE_COLORS[role as Role] ?? '#8892aa';
}

/**
 * Tiny geometric glyphs, one mechanical concept each (24×24 viewBox, single
 * path, drawn with fill so they stay crisp at 10–14px):
 * spearhead / shield / fist / lightning / crosshair / orbit / cross / chevrons.
 */
const ICON_PATHS: Record<Role, string> = {
  vanguard: 'M12 1 L19 12 L13.6 9.6 L13.6 23 L10.4 23 L10.4 9.6 L5 12 Z',
  defender:
    'M12 2 L20 5 V12 C20 17.4 16.7 20.9 12 22.6 C7.3 20.9 4 17.4 4 12 V5 Z ' +
    'M12 4.6 L6.4 6.7 V12 C6.4 16 8.7 18.7 12 20.1 C15.3 18.7 17.6 16 17.6 12 V6.7 Z',
  bruiser:
    'M6 11 V6 h3 v5 h1 V4.5 h3 V11 h1 V5.5 h3 V13 h1.4 V8.5 H21 V14 c0 4 -2.6 7 -6.4 7 h-3.2 C8 21 6 18.6 6 15.5 Z',
  skirmisher: 'M13.5 1.5 L4.5 13.5 h5.4 L8.6 22.5 L19.5 9.5 h-5.6 Z',
  artillery:
    'M11 1 h2 v3.2 h-2 Z M11 19.8 h2 V23 h-2 Z M1 11 h3.2 v2 H1 Z M19.8 11 H23 v2 h-3.2 Z ' +
    'M12 5.4 a6.6 6.6 0 1 0 0.001 0 Z M12 8.2 a3.8 3.8 0 1 1 -0.001 0 Z M12 10.4 a1.6 1.6 0 1 0 0.001 0 Z',
  controller:
    'M12 4.8 C18.4 4.8 22.8 8.1 22.8 12 C22.8 15.9 18.4 19.2 12 19.2 C5.6 19.2 1.2 15.9 1.2 12 C1.2 8.1 5.6 4.8 12 4.8 Z ' +
    'M12 7 C7 7 3.6 9.5 3.6 12 C3.6 14.5 7 17 12 17 C17 17 20.4 14.5 20.4 12 C20.4 9.5 17 7 12 7 Z ' +
    'M12 8.8 a3.2 3.2 0 1 1 -0.001 0 Z M19.6 4.4 a1.8 1.8 0 1 1 -0.001 0 Z',
  support: 'M9.4 2.6 h5.2 v6.8 h6.8 v5.2 h-6.8 v6.8 H9.4 v-6.8 H2.6 V9.4 h6.8 Z',
  tactician:
    'M12 2.5 L20 9.5 h-4.6 L12 6.6 L8.6 9.5 H4 Z M12 11.5 L20 18.5 h-4.6 L12 15.6 L8.6 18.5 H4 Z',
};

/** Inline icon, colored by the surrounding `--accent` / currentColor. */
export function roleIcon(role: string, cls = 'role-icon'): string {
  const d = ICON_PATHS[role as Role] ?? ICON_PATHS.vanguard;
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="currentColor" fill-rule="evenodd"/></svg>`;
}

/** Hexagonal role chip (icon inside a hex frame) for pedestal name plates. */
export function hexChip(role: string): string {
  const c = roleColor(role);
  const d = ICON_PATHS[role as Role] ?? ICON_PATHS.vanguard;
  return `
  <svg class="hex-chip" viewBox="0 0 32 32" aria-hidden="true">
    <polygon points="16,1.5 28.5,8.5 28.5,23.5 16,30.5 3.5,23.5 3.5,8.5"
      fill="${c}1f" stroke="${c}" stroke-width="1.6"/>
    <g transform="translate(8.2,8.2) scale(0.65)"><path d="${d}" fill="${c}" fill-rule="evenodd"/></g>
  </svg>`;
}

/**
 * Angular collectible name plate: hex role chip + bold fighter name + role
 * name in the role color (icon + text always accompany the color).
 */
export function namePlate(displayName: string, role: string): string {
  const c = roleColor(role);
  const escName = displayName.replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );
  return `
  <div class="name-plate" style="--role:${c}">
    ${hexChip(role)}
    <div class="plate-text">
      <div class="plate-name">${escName}</div>
      <div class="plate-role">${role}</div>
    </div>
  </div>`;
}
