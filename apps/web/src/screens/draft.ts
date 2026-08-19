import { RULESET_S0, type FighterFile } from '@arena/contracts';
import { createRng, type Rng } from '@arena/combat-sim';
import { DNA_BY_ID, FIGHTERS, FILE_BY_ID, ROLE_COLORS, money } from '../content';
import { aiDraftPick } from '../opponentAI';
import { go, state, track } from '../state';
import { el, esc, mount, q, qa, topbar } from '../ui';

const MIN_PRICE = 8_000_000;
let aiRng: Rng | null = null;
let aiTimer: number | null = null;

function initDraft() {
  const frozenP2 = !!state.players[1].frozenTeam;
  const order: ('p1' | 'p2')[] = [];
  for (let round = 0; round < RULESET_S0.rosterMax; round++) {
    const pair: ('p1' | 'p2')[] = round % 2 === 0 ? ['p1', 'p2'] : ['p2', 'p1'];
    for (const p of pair) if (!(frozenP2 && p === 'p2')) order.push(p);
  }
  state.draft = {
    order,
    turn: 0,
    picks: {
      p1: { roster: [], passed: false },
      p2: {
        roster: frozenP2 ? state.players[1].frozenTeam!.roster.map((r) => ({ ...r })) : [],
        passed: frozenP2,
      },
    },
  };
  aiRng = createRng(state.seed ^ 0x2c1b3c6d);
}

const spent = (p: 'p1' | 'p2') => state.draft!.picks[p].roster.reduce((s, r) => s + r.pricePaid, 0);
const budget = (p: 'p1' | 'p2') => RULESET_S0.salaryCap - spent(p);
const takenIds = () => new Set([...state.draft!.picks.p1.roster, ...state.draft!.picks.p2.roster].map((r) => r.fighterId));

function canAfford(p: 'p1' | 'p2', fighterId: string): boolean {
  const price = DNA_BY_ID.get(fighterId)!.balance.draftPrice;
  const need = Math.max(0, RULESET_S0.rosterMin - state.draft!.picks[p].roster.length - 1);
  return price <= budget(p) - need * MIN_PRICE;
}

function currentPlayer(): 'p1' | 'p2' | null {
  const d = state.draft!;
  while (d.turn < d.order.length) {
    const p = d.order[d.turn];
    const ps = d.picks[p];
    if (ps.passed || ps.roster.length >= RULESET_S0.rosterMax) {
      d.turn++;
      continue;
    }
    // If a player can't afford any remaining fighter, they are auto-passed.
    const anyAffordable = FIGHTERS.some((f) => !takenIds().has(f.dna.identity.fighterId) && canAfford(p, f.dna.identity.fighterId));
    if (!anyAffordable && ps.roster.length >= RULESET_S0.rosterMin) {
      ps.passed = true;
      d.turn++;
      continue;
    }
    return p;
  }
  return null;
}

function pick(p: 'p1' | 'p2', fighterId: string) {
  const price = DNA_BY_ID.get(fighterId)!.balance.draftPrice;
  state.draft!.picks[p].roster.push({ fighterId, pricePaid: price });
  state.draft!.turn++;
  track('draft_pick', { player: p, fighterId, price });
}

function pass(p: 'p1' | 'p2') {
  state.draft!.picks[p].passed = true;
  state.draft!.turn++;
  track('draft_pass', { player: p });
}

export function renderDraft() {
  if (!state.draft) initDraft();
  if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }

  const p = currentPlayer();
  if (p === null) {
    track('draft_completed', {
      p1Spent: spent('p1'),
      p2Spent: spent('p2'),
      p1Size: state.draft!.picks.p1.roster.length,
      p2Size: state.draft!.picks.p2.roster.length,
    });
    go('prep');
    return;
  }

  const cfg = state.players[p === 'p1' ? 0 : 1];
  const taken = takenIds();
  const isAITurn = cfg.isAI;

  const marketCards = FIGHTERS.map((f) => fighterCard(f, taken, p, isAITurn)).join('');
  const node = el(`
  <div>
    ${topbar('Market Draft — ABBA snake order · prices season-locked')}
    <div class="screen wide">
      <div class="turn-banner ${isAITurn ? 'enemy' : ''}">
        ${isAITurn ? `${esc(cfg.name)} is on the clock…` : `${esc(cfg.name)} — you're on the clock (pick ${state.draft!.picks[p].roster.length + 1})`}
      </div>
      <div class="draft-layout">
        <div>
          <div class="market-grid">${marketCards}</div>
        </div>
        <div>
          ${sidePanel('p1')}
          <div class="mt"></div>
          ${sidePanel('p2')}
          ${!isAITurn && state.draft!.picks[p].roster.length >= RULESET_S0.rosterMin
            ? `<button class="mt" id="btn-pass" style="width:100%">Lock roster with ${state.draft!.picks[p].roster.length} fighters</button>`
            : ''}
          <p class="muted small mt">Minimum ${RULESET_S0.rosterMin}, maximum ${RULESET_S0.rosterMax}. Reserves join through the Squad Relay.</p>
        </div>
      </div>
    </div>
    <div id="inspect-slot"></div>
  </div>`);

  qa(node, '.fighter-card').forEach((card) => {
    card.addEventListener('click', () => openInspect(node, card.dataset.id!, p, isAITurn));
  });
  node.querySelector('#btn-pass')?.addEventListener('click', () => {
    pass(p);
    renderDraft();
  });

  mount(node);

  if (isAITurn) {
    aiTimer = window.setTimeout(() => {
      const available = FIGHTERS.map((f) => f.dna.identity.fighterId).filter((id) => !taken.has(id));
      const choice = aiDraftPick(available, budget(p), state.draft!.picks[p].roster.map((r) => r.fighterId), aiRng!);
      if (choice === 'pass') pass(p);
      else pick(p, choice);
      renderDraft();
    }, 900);
  }
}

function fighterCard(f: FighterFile, taken: Set<string>, p: 'p1' | 'p2', isAITurn: boolean): string {
  const id = f.dna.identity.fighterId;
  const affordable = canAfford(p, id);
  const cls = [
    'fighter-card',
    taken.has(id) ? 'taken' : '',
    !taken.has(id) && !affordable && !isAITurn ? 'unaffordable' : '',
  ].join(' ');
  return `
  <div class="${cls}" data-id="${esc(id)}" style="--accent:${esc(f.dna.presentation.primaryColor)}">
    <div class="portrait">
      ${silhouette(f)}
      <div class="pedestal"></div>
    </div>
    <div class="name">${esc(f.contract.identity.displayName)}</div>
    <div class="meta">
      <span class="role-badge" style="--accent:${ROLE_COLORS[f.dna.identity.role] ?? '#888'}">${esc(f.dna.identity.role)}</span>
      <span>${esc(f.dna.identity.chassis)}</span>
    </div>
    <div class="meta mt" style="margin-top:6px">
      <span class="price">${money(f.dna.balance.draftPrice)}</span>
      <span>${taken.has(id) ? 'DRAFTED' : ''}</span>
    </div>
  </div>`;
}

export function silhouette(f: FighterFile): string {
  const c = f.dna.presentation.primaryColor;
  const e = f.dna.presentation.energyColor;
  const chassis = f.dna.identity.chassis;
  const shapes: Record<string, string> = {
    humanoid: `<circle cx="23" cy="10" r="7" fill="${c}"/><rect x="15" y="19" width="16" height="26" rx="6" fill="${c}"/><rect x="17" y="46" width="5" height="18" rx="2" fill="${c}"/><rect x="25" y="46" width="5" height="18" rx="2" fill="${c}"/><circle cx="23" cy="30" r="3" fill="${e}"/>`,
    heavy: `<circle cx="23" cy="9" r="6" fill="${c}"/><rect x="8" y="16" width="30" height="30" rx="7" fill="${c}"/><rect x="12" y="47" width="8" height="16" rx="3" fill="${c}"/><rect x="26" y="47" width="8" height="16" rx="3" fill="${c}"/><circle cx="23" cy="30" r="4" fill="${e}"/>`,
    quadruped: `<ellipse cx="23" cy="34" rx="19" ry="11" fill="${c}"/><circle cx="39" cy="24" r="7" fill="${c}"/><rect x="8" y="43" width="5" height="16" rx="2" fill="${c}"/><rect x="18" y="44" width="5" height="15" rx="2" fill="${c}"/><rect x="28" y="44" width="5" height="15" rx="2" fill="${c}"/><circle cx="41" cy="22" r="2" fill="${e}"/>`,
    floating: `<circle cx="23" cy="18" r="10" fill="${c}"/><path d="M13 28 L23 58 L33 28 Z" fill="${c}" opacity="0.75"/><circle cx="23" cy="18" r="4" fill="${e}"/><ellipse cx="23" cy="60" rx="12" ry="2.5" fill="${e}" opacity="0.5"/>`,
  };
  return `<svg class="silhouette" viewBox="0 0 46 66" xmlns="http://www.w3.org/2000/svg">${shapes[chassis] ?? shapes.humanoid}</svg>`;
}

function sidePanel(p: 'p1' | 'p2'): string {
  const cfg = state.players[p === 'p1' ? 0 : 1];
  const ps = state.draft!.picks[p];
  const used = spent(p);
  const pct = Math.min(100, (used / RULESET_S0.salaryCap) * 100);
  return `
  <div class="panel">
    <h3>${esc(cfg.name)} ${cfg.frozenTeam ? '· frozen champion squad' : ''}</h3>
    <div class="row between small"><span>Cap used</span><span class="gold">${money(used)} / ${money(RULESET_S0.salaryCap)}</span></div>
    <div class="cap-meter mt" style="margin-top:6px"><div class="fill" style="width:${pct}%"></div></div>
    <div class="pick-log mt">
      ${ps.roster.length === 0 ? '<div class="muted">No picks yet</div>' : ''}
      ${ps.roster.map((r, i) => `<div>${i + 1}. <b>${esc(FILE_BY_ID.get(r.fighterId)?.contract.identity.displayName ?? r.fighterId)}</b> <span class="gold">${money(r.pricePaid)}</span></div>`).join('')}
      ${ps.passed ? '<div class="muted">Roster locked</div>' : ''}
    </div>
  </div>`;
}

function openInspect(root: HTMLElement, fighterId: string, p: 'p1' | 'p2', isAITurn: boolean) {
  const f = FILE_BY_ID.get(fighterId)!;
  const dna = f.dna;
  const taken = takenIds().has(fighterId);
  const affordable = canAfford(p, fighterId);
  track('fighter_inspected', { fighterId });

  const attrs: [string, number][] = [
    ['Force', dna.attributes.forceOutput], ['Durability', dna.attributes.durability],
    ['Combat speed', dna.attributes.combatSpeed], ['Precision', dna.attributes.precision],
    ['Mobility', dna.attributes.mobility], ['Travel speed', dna.attributes.travelSpeed],
    ['Tactical IQ', dna.attributes.tacticalIntelligence], ['Resolve', dna.attributes.resolve],
  ];
  const allAbilities = [
    ...dna.capabilities.foundational.map((a) => ({ a, cat: 'Foundational' })),
    ...dna.capabilities.signature.map((a) => ({ a, cat: 'Signature' })),
    ...dna.capabilities.contextual.map((a) => ({ a, cat: 'Contextual' })),
    { a: dna.capabilities.escalation, cat: 'Escalation' },
  ];

  const slot = q(root, '#inspect-slot');
  slot.innerHTML = '';
  const drawer = el(`
  <div class="inspect" style="--accent:${esc(dna.presentation.primaryColor)}">
    <button class="close small">✕</button>
    <div class="row">
      <div style="width:70px">${silhouette(f)}</div>
      <div>
        <h2>${esc(f.contract.identity.displayName)}</h2>
        <span class="role-badge" style="--accent:${ROLE_COLORS[dna.identity.role] ?? '#888'}">${esc(dna.identity.role)}</span>
        <span class="role-badge">${esc(dna.identity.chassis)}</span>
        <span class="role-badge">${esc(dna.identity.division)}</span>
      </div>
    </div>
    <p class="muted small mt">${esc(f.contract.canon.summary)}</p>

    <h3 class="mt gold">Price — ${money(dna.balance.draftPrice)}</h3>
    <p class="small muted">${esc(dna.balance.priceRationale)}</p>

    <h3 class="mt gold">Attributes</h3>
    ${attrs.map(([label, v]) => `
      <div class="stat-bar"><span class="label">${label}</span><span class="track"><i style="width:${v * 10}%"></i></span><span>${v}</span></div>`).join('')}

    <h3 class="mt gold">Abilities</h3>
    ${allAbilities.map(({ a, cat }) => `
      <div class="ability-row">
        <div class="head"><span>${esc(a.name)}</span><span class="muted small">${cat}</span></div>
        <div class="small muted">${esc(a.description)}</div>
        <div class="small mt" style="margin-top:4px">
          ${a.power ? `PWR ${a.power} · ` : ''}${a.range ? `RNG ${a.range}m · ` : ''}CD ${(a.cooldownTicks / 4).toFixed(0)}s
          ${a.requiresContext ? ` · needs: ${esc(a.requiresContext.join(', '))}` : ''}
        </div>
        <div style="margin-top:4px">${a.tags.map((t) => `<span class="tagchip">${esc(t)}</span>`).join('')}</div>
      </div>`).join('')}

    <h3 class="mt" style="color:var(--danger)">Weaknesses & limitations</h3>
    ${dna.weaknesses.map((w) => `<div class="weakness-row"><b>Severity ${w.severity}</b> — ${esc(w.description)}</div>`).join('')}
    ${f.contract.limitations.map((l) => `<div class="weakness-row"><b>${esc(l.severity)}</b> — ${esc(l.description)}</div>`).join('')}

    <h3 class="mt gold">Behavior</h3>
    <p class="small muted">${esc(dna.behavior.personality)} Prefers ${esc(dna.behavior.targetPreference.replace(/_/g, ' '))} targets.
      ${dna.behavior.constraints.length ? `Constraints: ${esc(dna.behavior.constraints.join(', ').replace(/_/g, ' '))}.` : ''}</p>

    ${!isAITurn && !taken ? `<button class="primary mt" id="btn-pick" style="width:100%" ${affordable ? '' : 'disabled'}>
      ${affordable ? `Draft for ${money(dna.balance.draftPrice)}` : 'Cannot afford (min-roster budget rule)'}
    </button>` : ''}
  </div>`);
  q(drawer, '.close').addEventListener('click', () => drawer.remove());
  drawer.querySelector('#btn-pick')?.addEventListener('click', () => {
    pick(p, fighterId);
    drawer.remove();
    renderDraft();
  });
  slot.appendChild(drawer);
}
