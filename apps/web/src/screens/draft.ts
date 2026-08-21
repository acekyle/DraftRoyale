import { RULESET_S0, minRosterReserve, type FighterFile } from '@arena/contracts';
import { createRng, type Rng } from '@arena/combat-sim';
import { compileFighterFromText, applySemanticCorrection, applyVisualCorrection } from '@arena/character-compiler';
import { DNA_BY_ID, FIGHTERS, FILE_BY_ID, money, registerCustomFighter } from '../content';
import { requestStatueForge, statueForgeStatus, watchStatueForge } from '../customStatueForge';
import { hasHeroModel } from '../heroModels';
import { aiDraftPick } from '../opponentAI';
import { mountPedestal } from '../pedestalPreview';
import { namePlate, roleColor, roleIcon } from '../roleTheme';
import { go, state, track } from '../state';
import { el, esc, mount, q, qa, topbar } from '../ui';

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
    customFighters: [],
    nominations: {
      p1: { used: false, semanticLeft: 1, visualLeft: 1, pending: null },
      p2: { used: false, semanticLeft: 1, visualLeft: 1, pending: null },
    },
  };
  aiRng = createRng(state.seed ^ 0x2c1b3c6d);
}

function marketFiles(): FighterFile[] {
  return [...FIGHTERS, ...state.draft!.customFighters.map((c) => c.file)];
}

const spent = (p: 'p1' | 'p2') => state.draft!.picks[p].roster.reduce((s, r) => s + r.pricePaid, 0);
const budget = (p: 'p1' | 'p2') => RULESET_S0.salaryCap - spent(p);
const takenIds = () => new Set([...state.draft!.picks.p1.roster, ...state.draft!.picks.p2.roster].map((r) => r.fighterId));

function opponentCapacity(p: 'p1' | 'p2'): number {
  const opp = state.draft!.picks[p === 'p1' ? 'p2' : 'p1'];
  return opp.passed ? 0 : RULESET_S0.rosterMax - opp.roster.length;
}

/** Prices of fighters p could still draft, excluding taken ones and `excludeId`. */
function remainingPricesFor(p: 'p1' | 'p2', excludeId: string): number[] {
  const taken = takenIds();
  return marketFiles()
    .filter((f) => {
      const id = f.dna.identity.fighterId;
      if (id === excludeId || taken.has(id)) return false;
      const custom = state.draft!.customFighters.find((c) => c.file === f);
      return !custom || custom.nominator === p; // nominator-exclusive right
    })
    .map((f) => f.dna.balance.draftPrice);
}

function canAfford(p: 'p1' | 'p2', fighterId: string): boolean {
  const price = DNA_BY_ID.get(fighterId)!.balance.draftPrice;
  const need = Math.max(0, RULESET_S0.rosterMin - state.draft!.picks[p].roster.length - 1);
  // Live-market reserve: a static price floor let the opponent drain the cheap
  // end of the market and cap-lock a roster below the minimum (2026-08-20).
  const reserve = minRosterReserve(remainingPricesFor(p, fighterId), need, opponentCapacity(p));
  return price <= budget(p) - reserve;
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
    const anyAffordable = marketFiles().some((f) => {
      const custom = state.draft!.customFighters.find((c) => c.file === f);
      if (custom && custom.nominator !== p) return false; // nominator-exclusive right
      return !takenIds().has(f.dna.identity.fighterId) && canAfford(p, f.dna.identity.fighterId);
    });
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
  document.body.style.overflow = '';

  const p = currentPlayer();
  if (p === null) {
    // Backstop: a draft that ends with any roster below the minimum cannot
    // produce a legal match — offer a clean restart instead of letting the
    // prep/wildcard legality check bounce the player forever.
    const short = (['p1', 'p2'] as const).find(
      (id) => state.draft!.picks[id].roster.length < RULESET_S0.rosterMin,
    );
    if (short) {
      track('draft_voided', { shortSeat: short, size: state.draft!.picks[short].roster.length });
      renderVoidDraft(short);
      return;
    }
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

  const marketCards = marketFiles().map((f) => fighterCard(f, taken, p, isAITurn)).join('');
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
          <div id="nomination-slot" class="mt"></div>
        </div>
      </div>
    </div>
    <div id="inspect-slot"></div>
  </div>`);

  qa(node, '.fighter-card').forEach((card) => {
    const open = () => openInspect(node, card.dataset.id!, p, isAITurn);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (ev) => {
      if ((ev as KeyboardEvent).key === 'Enter') open();
    });
  });
  if (!isAITurn) renderNominationPanel(node, p);
  node.querySelector('#btn-pass')?.addEventListener('click', () => {
    pass(p);
    renderDraft();
  });

  mount(node);

  if (isAITurn) {
    aiTimer = window.setTimeout(() => {
      const available = FIGHTERS.map((f) => f.dna.identity.fighterId).filter((id) => !taken.has(id));
      const choice = aiDraftPick(
        available, budget(p), state.draft!.picks[p].roster.map((r) => r.fighterId), aiRng!, opponentCapacity(p),
      );
      if (choice === 'pass') pass(p);
      else pick(p, choice);
      renderDraft();
    }, 900);
  }
}

function renderVoidDraft(short: 'p1' | 'p2') {
  const name = state.players[short === 'p1' ? 0 : 1].name;
  const node = el(`
  <div>
    ${topbar('Market Draft — draft voided')}
    <div class="screen">
      <div class="panel" style="max-width:560px;margin:40px auto">
        <h3>Draft voided — cap-locked roster</h3>
        <p class="small">${esc(name)} ended the draft with fewer than ${RULESET_S0.rosterMin} fighters
        and no affordable fighter left on the market, so no legal match can start.
        No result is recorded.</p>
        <button class="primary mt" id="btn-redraft" style="width:100%">Run a fresh draft</button>
      </div>
    </div>
  </div>`);
  q(node, '#btn-redraft').addEventListener('click', () => {
    state.seed = (state.seed ^ 0x9e3779b9) >>> 0;
    state.draft = null;
    state.prep = null;
    renderDraft();
  });
  mount(node);
}

function fighterCard(f: FighterFile, taken: Set<string>, p: 'p1' | 'p2', isAITurn: boolean): string {
  const id = f.dna.identity.fighterId;
  const affordable = canAfford(p, id);
  const custom = state.draft!.customFighters.find((c) => c.file.dna.identity.fighterId === id);
  const cls = [
    'fighter-card',
    'role-edged',
    taken.has(id) ? 'taken' : '',
    !taken.has(id) && !affordable && !isAITurn ? 'unaffordable' : '',
  ].join(' ');
  const role = f.dna.identity.role;
  const rc = roleColor(role);
  const badge = custom ? `<div style="margin-bottom:4px"><span class="badge-exp">EXPERIMENTAL · ${custom.nominator === p ? 'YOUR NOMINEE' : 'RIVAL NOMINEE'}</span></div>` : '';
  return `
  <div class="${cls}" data-id="${esc(id)}" tabindex="0" role="button" style="--accent:${esc(f.dna.presentation.primaryColor)};--role:${rc}">
    ${badge}
    <div class="portrait">
      ${silhouette(f)}
      <img class="card-portrait" alt="" loading="lazy" draggable="false"
        src="${import.meta.env.BASE_URL ?? '/'}${custom ? 'custom-heroes' : 'heroes'}/${esc(id)}.webp" onerror="this.remove()">
      <div class="pedestal"></div>
    </div>
    <div class="name">${esc(f.contract.identity.displayName)}</div>
    <div class="meta">
      <span class="role-badge" style="--accent:${rc}">${roleIcon(role)}<span>${esc(role)}</span></span>
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

/** Live custom nomination — the compiler runs client-side (deterministic, rule-based). */
function renderNominationPanel(root: HTMLElement, p: 'p1' | 'p2') {
  const slot = q(root, '#nomination-slot');
  const nom = state.draft!.nominations[p];

  const render = () => {
    if (nom.used && !nom.pending) {
      slot.innerHTML = '<p class="muted small">Custom nomination used for this draft.</p>';
      return;
    }
    if (!nom.pending) {
      slot.innerHTML = `
        <div class="compiler-panel">
          <h3 style="color:var(--purple)">Live custom nomination <span class="badge-exp">EXPERIMENTAL</span></h3>
          <p class="muted small mb">Describe a fighter. The compiler produces a full Character Contract at a formula price — one semantic and one visual correction allowed. Private rooms only; not ranked-eligible.</p>
          <textarea id="nom-desc" rows="3" maxlength="400" placeholder="e.g. A patient ice-sculptor monk who freezes the ground and shields allies with walls of ice"></textarea>
          <button class="mt" id="nom-compile" style="width:100%">Compile fighter</button>
          <div id="nom-error"></div>
        </div>`;
      q(slot, '#nom-compile').addEventListener('click', () => {
        const desc = q<HTMLTextAreaElement>(slot, '#nom-desc').value.trim();
        if (desc.length < 8) return;
        try {
          nom.pending = compileFighterFromText(desc, { seed: state.seed ^ (p === 'p1' ? 1 : 2) });
          track('custom_nomination', { player: p });
        } catch {
          q(slot, '#nom-error').innerHTML = '<div class="compiler-note">Compiler is still being assembled by the workshop team — try again shortly.</div>';
          return;
        }
        render();
      });
      return;
    }
    const r = nom.pending;
    const dna = r.fighter.dna;
    slot.innerHTML = `
      <div class="compiler-panel">
        <h3 style="color:var(--purple)">${esc(r.fighter.contract.identity.displayName)} <span class="badge-exp">EXPERIMENTAL</span></h3>
        <p class="small">${esc(dna.identity.role)} · ${esc(dna.identity.chassis)} · <b class="gold">${money(dna.balance.draftPrice)}</b></p>
        <p class="muted small">${esc(r.fighter.contract.canon.summary)}</p>
        <p class="small mt"><b>Signatures:</b> ${dna.capabilities.signature.map((a) => esc(a.name)).join(', ')}</p>
        <p class="small"><b>Weaknesses:</b> ${dna.weaknesses.map((w) => `${esc(w.description.split('—')[0].split('.')[0])} (sev ${w.severity})`).join(' · ')}</p>
        ${r.notes.map((n) => `<div class="compiler-note">${esc(n)}</div>`).join('')}
        ${nom.semanticLeft > 0 ? `
          <input type="text" id="nom-sem" placeholder="Semantic correction (1 left): e.g. 'more defensive, weak to fire'" class="mt"/>
          <button class="small mt" id="nom-sem-btn">Apply semantic correction</button>` : ''}
        ${nom.visualLeft > 0 ? `
          <input type="text" id="nom-vis" placeholder="Visual correction (1 left): e.g. 'crimson and gold, larger'" class="mt"/>
          <button class="small mt" id="nom-vis-btn">Apply visual correction</button>` : ''}
        <div class="row mt">
          <button class="primary" id="nom-accept">Add to market at ${money(dna.balance.draftPrice)}</button>
          <button class="danger" id="nom-discard">Discard</button>
        </div>
        <p class="muted small mt">Approving also forges this fighter's 3D statue on the spot (same pipeline as the season roster) when the local forge service is up — the procedural chassis stands in until it lands.</p>
      </div>`;
    slot.querySelector('#nom-sem-btn')?.addEventListener('click', () => {
      const instr = q<HTMLInputElement>(slot, '#nom-sem').value.trim();
      if (!instr) return;
      try {
        nom.pending = applySemanticCorrection(r, instr);
        nom.semanticLeft -= 1;
        track('custom_correction', { kind: 'semantic' });
      } catch { /* compiler offline */ }
      render();
    });
    slot.querySelector('#nom-vis-btn')?.addEventListener('click', () => {
      const instr = q<HTMLInputElement>(slot, '#nom-vis').value.trim();
      if (!instr) return;
      try {
        nom.pending = applyVisualCorrection(r, instr);
        nom.visualLeft -= 1;
        track('custom_correction', { kind: 'visual' });
      } catch { /* compiler offline */ }
      render();
    });
    q(slot, '#nom-accept').addEventListener('click', () => {
      registerCustomFighter(r.fighter);
      state.draft!.customFighters.push({ file: r.fighter, nominator: p });
      nom.used = true;
      nom.pending = null;
      track('fighter_approved', { fighterId: dna.identity.fighterId });
      beginStatueForge(r.fighter);
      renderDraft();
    });
    q(slot, '#nom-discard').addEventListener('click', () => {
      // Rev-2 (parity with online): a declined nomination does NOT spend the
      // one-per-player right — only approval does. Correction budgets are
      // per-nomination, so the next nomination starts fresh.
      nom.pending = null;
      nom.semanticLeft = 1;
      nom.visualLeft = 1;
      render();
    });
  };
  render();
}

/**
 * On-the-spot statue parity for custom nominations (D-029): kick the forge
 * fire-and-forget. 'unavailable' (deployed build / no key / cap) is a normal
 * quiet outcome — the procedural chassis is the designed fallback.
 */
function beginStatueForge(file: FighterFile) {
  const fighterId = file.dna.identity.fighterId;
  void requestStatueForge(file).then((reply) => {
    track('custom_forge_requested', { fighterId, state: reply.state, reason: reply.reason ?? '' });
    if (reply.state === 'running') {
      watchStatueForge(fighterId, (settled) =>
        track(settled.state === 'done' ? 'custom_forge_done' : 'custom_forge_failed', { fighterId }));
    }
  });
}

function openInspect(root: HTMLElement, fighterId: string, p: 'p1' | 'p2', isAITurn: boolean) {
  const f = FILE_BY_ID.get(fighterId)!;
  const dna = f.dna;
  const taken = takenIds().has(fighterId);
  const affordable = canAfford(p, fighterId);
  const custom = state.draft!.customFighters.find((c) => c.file.dna.identity.fighterId === fighterId);
  const rivalNominee = !!custom && custom.nominator !== p;
  document.body.style.overflow = 'hidden';
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
  const rc = roleColor(dna.identity.role);
  const drawer = el(`
  <div class="inspect" style="--accent:${esc(dna.presentation.primaryColor)};--role:${rc}">
    <button class="close small">✕</button>
    <div class="hero-stage">
      <div class="stage-fallback">${silhouette(f)}</div>
    </div>
    ${namePlate(f.contract.identity.displayName, dna.identity.role)}
    <div class="row wrap" style="gap:6px">
      <span class="role-badge" style="--accent:${rc}">${roleIcon(dna.identity.role)}<span>${esc(dna.identity.role)}</span></span>
      <span class="role-badge">${esc(dna.identity.chassis)}</span>
      <span class="role-badge">${esc(dna.identity.division)}</span>
    </div>
    ${custom ? `<div class="row mt" style="gap:8px;align-items:center">
      <button class="small" id="btn-forge">Forge 3D statue</button>
      <span class="muted small" id="forge-note"></span>
    </div>` : ''}
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

    ${!isAITurn && !taken ? `<button class="primary mt" id="btn-pick" style="width:100%" ${affordable && !rivalNominee ? '' : 'disabled'}>
      ${rivalNominee ? 'Nominated by your rival — only they may draft this version' : affordable ? `Draft for ${money(dna.balance.draftPrice)}` : 'Cannot afford (min-roster budget rule)'}
    </button>` : ''}
  </div>`);
  const closeDrawer = () => {
    document.body.style.overflow = '';
    preview?.dispose();
    drawer.remove();
  };
  q(drawer, '.close').addEventListener('click', closeDrawer);
  drawer.querySelector('#btn-pick')?.addEventListener('click', () => {
    pick(p, fighterId);
    closeDrawer();
    renderDraft();
  });
  // D-029: manual forge control for custom fighters (covers customs approved
  // before the forge existed, and retries after a failed forge).
  const forgeBtn = drawer.querySelector<HTMLButtonElement>('#btn-forge');
  if (forgeBtn && custom) {
    const note = q<HTMLElement>(drawer, '#forge-note');
    const show = (text: string, disable: boolean) => { note.textContent = text; forgeBtn.disabled = disable; };
    const watchNote = () => watchStatueForge(fighterId, (settled) => {
      track(settled.state === 'done' ? 'custom_forge_done' : 'custom_forge_failed', { fighterId });
      show(settled.state === 'done' ? 'Statue ready — reopen to view it on the pedestal.' : 'Forge failed — you may retry.', settled.state === 'done');
    });
    void Promise.all([hasHeroModel(fighterId), statueForgeStatus(fighterId)]).then(([has, st]) => {
      if (has || st.state === 'done') show('Statue live.', true);
      else if (st.state === 'running') { show('Forging… statues land in ~2–3 minutes.', true); watchNote(); }
      else if (st.state === 'failed') show('Last forge failed — you may retry.', false);
      else if (st.state === 'unavailable') show('Forge service offline — procedural chassis stands.', true);
    });
    forgeBtn.addEventListener('click', () => {
      show('Requesting…', true);
      void requestStatueForge(custom.file).then((reply) => {
        track('custom_forge_requested', { fighterId, state: reply.state, reason: reply.reason ?? '' });
        if (reply.state === 'running') { show('Forging… statues land in ~2–3 minutes.', true); watchNote(); }
        else if (reply.state === 'done') show('Statue live.', true);
        else if (reply.reason === 'no-key') show('Forge disabled — TRIPO_API_KEY not set on the dev server.', false);
        else show(`Forge unavailable (${reply.reason ?? reply.state}) — procedural chassis stands.`, false);
      });
    });
  }
  slot.appendChild(drawer);

  // Live 3D pedestal turntable (shared renderer; falls back to the 2D
  // silhouette when WebGL is unavailable, e.g. blocked contexts).
  const stage = q(drawer, '.hero-stage');
  const preview = mountPedestal(stage, dna);
  if (preview) q<HTMLElement>(drawer, '.stage-fallback').style.display = 'none';
}
