/** Shareable champion card — canvas-rendered PNG, no external services. */
import type { ChampionRecord } from '@arena/contracts';
import { FILE_BY_ID, money } from './content';

export function downloadChampionCard(champ: ChampionRecord) {
  const W = 900, H = 500;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // Backdrop — collectible pedestal glow.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1a2340');
  bg.addColorStop(1, '#0b0e17');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, H - 60, 20, W / 2, H - 60, 420);
  glow.addColorStop(0, 'rgba(245,185,60,0.35)');
  glow.addColorStop(1, 'rgba(245,185,60,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#f5b93c';
  ctx.lineWidth = 3;
  ctx.strokeRect(14, 14, W - 28, H - 28);

  ctx.fillStyle = '#f5b93c';
  ctx.font = '700 26px Rajdhani, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('INFINITE ARENA — REIGNING CHAMPION', W / 2, 64);

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 58px Rajdhani, sans-serif';
  ctx.fillText(champ.playerName.toUpperCase(), W / 2, 130);

  ctx.fillStyle = '#9aa5c0';
  ctx.font = '500 20px Barlow, sans-serif';
  ctx.fillText(
    `Win streak ${champ.winStreak} · defended ${champ.defended}× · ${champ.arenaId} · ruleset ${champ.rulesetVersion}`,
    W / 2, 165,
  );

  // Roster row.
  const roster = champ.team.roster;
  const slotW = Math.min(180, (W - 120) / roster.length);
  const x0 = W / 2 - (slotW * roster.length) / 2;
  for (const [i, pick] of roster.entries()) {
    const f = FILE_BY_ID.get(pick.fighterId);
    const cx = x0 + i * slotW + slotW / 2;
    const color = f?.dna.presentation.primaryColor ?? '#888888';
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, 260, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(245,185,60,0.6)';
    ctx.fillRect(cx - 40, 300, 80, 4);
    ctx.fillStyle = '#e8ecf6';
    ctx.font = '700 17px Rajdhani, sans-serif';
    ctx.fillText(f?.contract.identity.displayName ?? pick.fighterId, cx, 330);
    ctx.fillStyle = '#f5b93c';
    ctx.font = '600 14px Rajdhani, sans-serif';
    ctx.fillText(money(pick.pricePaid), cx, 350);
    if (pick.fighterId === champ.team.captainId) {
      ctx.fillStyle = '#f5b93c';
      ctx.font = '700 22px sans-serif';
      ctx.fillText('★', cx, 218);
    }
  }

  const spent = roster.reduce((s, r) => s + r.pricePaid, 0);
  ctx.fillStyle = '#9aa5c0';
  ctx.font = '500 18px Barlow, sans-serif';
  ctx.fillText(
    `${money(spent)} of cap · wildcard: ${champ.team.wildcardId ?? 'none'} · frozen as an immutable challenge`,
    W / 2, 405,
  );
  ctx.fillStyle = '#f5b93c';
  ctx.font = '600 20px Rajdhani, sans-serif';
  ctx.fillText('“Run it back. I know what team can beat that.”', W / 2, 448);

  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `champion-${champ.playerName.replace(/\W+/g, '-')}.png`;
  a.click();
}
