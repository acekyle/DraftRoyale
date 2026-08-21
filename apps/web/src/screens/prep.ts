import type { FormationId, ReinforcementTrigger, TeamSetup } from '@arena/contracts';
import { computeTeamReadout, createRng } from '@arena/combat-sim';
import { ARENA, DNA_BY_ID, FILE_BY_ID } from '../content';
import { aiPrep } from '../opponentAI';
import { roleColor, roleIcon } from '../roleTheme';
import { go, state, track, type PrepState } from '../state';
import { el, esc, interstitial, mount, q, qa, topbar } from '../ui';

export const FORMATIONS: { id: FormationId; label: string; desc: string }[] = [
  { id: 'balanced', label: 'Balanced Line', desc: 'Even spacing, flexible engagements.' },
  { id: 'protect_captain', label: 'Protect Captain', desc: 'Captain starts behind the front line.' },
  { id: 'spread', label: 'Wide Spread', desc: 'Maximum spacing — blunts area attacks.' },
  { id: 'ambush', label: 'Ambush Wing', desc: 'One fighter starts on the flank.' },
];

export const TRIGGERS: { id: ReinforcementTrigger; label: string }[] = [
  { id: 'ally_ko', label: 'Relay on defeat — reserves enter only when a teammate goes down' },
  { id: 'ally_below_35', label: 'Rotate early — swap out any fighter who falls below 35% vitality' },
  { id: 'enemy_wildcard_deployed', label: 'Wildcard answer — swap the weakest fighter when the enemy wildcard lands' },
  { id: 'one_enemy_remains', label: 'Hold the closer — keep the reserve until one enemy remains' },
];

/**
 * Perceptual bar width for a 0-100 readout axis. Several axes normalize
 * against theoretical maxima, so honest mid values cluster low; a sqrt curve
 * keeps ordering while making them visible. The true value renders beside
 * the bar.
 */
function axisWidth(v: number): number {
  return v <= 0 ? 0 : Math.max(4, Math.round(Math.sqrt(v / 100) * 100));
}

function defaultPrep(p: 'p1' | 'p2'): PrepState {
  const roster = state.draft!.picks[p].roster.map((r) => r.fighterId);
  return {
    activeFighterIds: roster.slice(0, 3),
    captainId: roster[0],
    formation: 'balanced',
    reinforcement: 'ally_ko',
    wildcardId: null,
  };
}

export function renderPrep() {
  if (!state.prep) {
    state.prep = { p1: defaultPrep('p1'), p2: defaultPrep('p2') };
    // AI prep is decided immediately.
    for (const [i, cfg] of state.players.entries()) {
      const pid = i === 0 ? 'p1' as const : 'p2' as const;
      if (cfg.isAI) {
        const rng = createRng(state.seed ^ 0x77aa11);
        if (cfg.frozenTeam) {
          state.prep[pid] = {
            activeFighterIds: cfg.frozenTeam.activeFighterIds,
            captainId: cfg.frozenTeam.captainId,
            formation: cfg.frozenTeam.formation,
            reinforcement: cfg.frozenTeam.reinforcementPlan.trigger,
            wildcardId: cfg.frozenTeam.wildcardId,
          };
        } else {
          const other = pid === 'p1' ? 'p2' : 'p1';
          state.prep[pid] = aiPrep(
            state.draft!.picks[pid].roster.map((r) => r.fighterId),
            rng,
            state.draft!.picks[other].roster.map((r) => r.fighterId),
          );
        }
      }
    }
  }
  renderFor('p1');
}

function renderFor(pid: 'p1' | 'p2') {
  const cfg = state.players[pid === 'p1' ? 0 : 1];
  if (cfg.isAI) {
    finishOrNext(pid);
    return;
  }
  const roster = state.draft!.picks[pid].roster.map((r) => r.fighterId);
  const prep = state.prep![pid];

  const node = el(`
  <div>
    ${topbar(`Team Preparation — ${esc(cfg.name)}`)}
    <div class="screen wide">
      <div class="draft-layout">
        <div>
          <div class="panel mb">
            <h3>Starting three & captain</h3>
            <p class="muted small mb">Exactly 3 fighters start active. The rest wait in the Squad Relay. The star marks your captain.</p>
            <div class="grid cols-3" id="active-grid">
              ${roster.map((id) => {
                const f = FILE_BY_ID.get(id)!;
                const active = prep.activeFighterIds.includes(id);
                const captain = prep.captainId === id;
                const role = f.dna.identity.role;
                const rc = roleColor(role);
                return `
                <div class="fighter-card role-edged role-glow ${active ? 'selected' : ''}" data-id="${esc(id)}"
                  style="--accent:${esc(f.dna.presentation.primaryColor)};--role:${rc};--role-glow:${rc}55">
                  <div class="name">${captain ? '★ ' : ''}${esc(f.contract.identity.displayName)}</div>
                  <div class="meta">
                    <span class="role-badge" style="--accent:${rc}">${roleIcon(role)}<span>${esc(role)}</span></span>
                    <span>${active ? 'ACTIVE' : 'RESERVE'}</span>
                  </div>
                  <button class="small mt" data-captain="${esc(id)}">Make captain</button>
                </div>`;
              }).join('')}
            </div>
          </div>
          <div class="panel mb">
            <h3>Formation</h3>
            <div class="grid cols-2">
              ${FORMATIONS.map((f) => `
                <div class="fighter-card ${prep.formation === f.id ? 'selected' : ''}" data-formation="${f.id}">
                  <div class="name">${f.label}</div><div class="muted small">${f.desc}</div>
                </div>`).join('')}
            </div>
          </div>
          <div class="panel">
            <h3>Reinforcement plan ${roster.length === 3 ? '· (no reserves on a 3-fighter roster)' : ''}</h3>
            ${TRIGGERS.map((t) => `
              <label style="display:block;padding:6px 0;cursor:pointer">
                <input type="radio" name="trig" value="${t.id}" ${prep.reinforcement === t.id ? 'checked' : ''} ${roster.length === 3 && t.id !== 'ally_ko' ? 'disabled' : ''}/>
                <span class="small"> ${t.label}</span>
              </label>`).join('')}
          </div>
        </div>
        <div>
          <div class="panel" id="readout-panel"></div>
          <button class="primary mt" id="btn-continue" style="width:100%">Continue to wildcard selection</button>
        </div>
      </div>
    </div>
  </div>`);

  const refreshReadout = () => {
    const team = buildTeamSetup(pid);
    const r = computeTeamReadout(team, DNA_BY_ID, ARENA);
    q(node, '#readout-panel').innerHTML = `
      <h3>Team Readout — your eyes only</h3>
      <div class="display gold" style="font-size:19px">${esc(r.archetype)}</div>
      <p class="muted small mt">${esc(r.tagline)}</p>
      <div class="readout-axes mt">
        ${Object.entries(r.axes).map(([k, v]) => `
          <div class="stat-bar"><span class="label">${esc(k.replace(/([A-Z])/g, ' $1'))}</span><span class="track"><i style="width:${axisWidth(v)}%"></i></span><span class="val">${v}</span></div>`).join('')}
      </div>
      ${r.notes.length ? `<h3 class="mt">Arena notes</h3>${r.notes.map((n) => `<p class="small muted">· ${esc(n)}</p>`).join('')}` : ''}
      <p class="small muted mt">The Readout explains your own team. It never predicts a win probability and never analyzes the opponent's draft for you.</p>`;
  };

  qa(node, '#active-grid .fighter-card').forEach((card) => {
    card.addEventListener('click', (ev) => {
      if ((ev.target as HTMLElement).dataset.captain) return;
      const id = card.dataset.id!;
      const set = new Set(prep.activeFighterIds);
      if (set.has(id)) {
        if (set.size > 1) set.delete(id);
      } else {
        if (set.size >= 3) set.delete(prep.activeFighterIds[0]);
        set.add(id);
      }
      prep.activeFighterIds = roster.filter((r) => set.has(r));
      renderFor(pid);
    });
  });
  qa(node, '[data-captain]').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      prep.captainId = btn.dataset.captain!;
      renderFor(pid);
    });
  });
  qa(node, '[data-formation]').forEach((card) => {
    card.addEventListener('click', () => {
      prep.formation = card.dataset.formation as FormationId;
      renderFor(pid);
    });
  });
  qa<HTMLInputElement>(node, 'input[name=trig]').forEach((radio) => {
    radio.addEventListener('change', () => {
      prep.reinforcement = radio.value as ReinforcementTrigger;
    });
  });
  q(node, '#btn-continue').addEventListener('click', () => {
    if (prep.activeFighterIds.length !== 3) {
      alert('Select exactly 3 starting fighters.');
      return;
    }
    track('team_prepared', { player: pid, formation: prep.formation });
    finishOrNext(pid);
  });

  mount(node);
  refreshReadout();
}

async function finishOrNext(pid: 'p1' | 'p2') {
  if (pid === 'p1') {
    const p2cfg = state.players[1];
    if (!p2cfg.isAI) {
      await interstitial(`${p2cfg.name}'s preparation`, 'Pass the screen — team prep and readout are private.');
      renderFor('p2');
      return;
    }
  }
  go('wildcard');
}

export function buildTeamSetup(pid: 'p1' | 'p2'): TeamSetup {
  const cfg = state.players[pid === 'p1' ? 0 : 1];
  const picks = state.draft!.picks[pid];
  const prep = state.prep![pid];
  const roster = picks.roster.map((r) => r.fighterId);
  return {
    playerId: pid,
    displayName: cfg.name,
    roster: picks.roster.map((r) => ({ ...r })),
    activeFighterIds: prep.activeFighterIds,
    reserveOrder: roster.filter((id) => !prep.activeFighterIds.includes(id)),
    captainId: prep.captainId,
    formation: prep.formation,
    reinforcementPlan: {
      trigger: prep.reinforcement,
      description: TRIGGERS.find((t) => t.id === prep.reinforcement)?.label ?? '',
    },
    wildcardId: prep.wildcardId,
  };
}
