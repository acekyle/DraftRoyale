import type { WildcardContract } from '@arena/contracts';
import { RULESET_S0, hasErrors, validateTeamSetup } from '@arena/contracts';
import { DNA_BY_ID, WILDCARDS, WILDCARD_BY_ID } from '../content';
import { go, state, track } from '../state';
import { el, esc, interstitial, mount, q, qa, topbar } from '../ui';
import { buildTeamSetup } from './prep';

export function renderWildcard() {
  renderFor('p1');
}

function humanizeEffect(w: WildcardContract): string[] {
  const out: string[] = [];
  for (const e of w.effects) {
    const who = e.affects === 'both' ? 'both teams' : e.affects === 'allies' ? 'your team' : 'the enemy team';
    switch (e.kind) {
      case 'suppress_tags': out.push(`Suppresses ${e.tags?.join(' + ')} powers for ${who}`); break;
      case 'dot': out.push(`${e.magnitude}/tick ${e.damageType ?? ''} damage to ${who}`); break;
      case 'hot': out.push(`${e.magnitude}/tick healing for ${who}`); break;
      case 'speed_mult': out.push(`Movement ×${e.magnitude} for ${who}`); break;
      case 'accuracy_delta': out.push(`${(e.magnitude ?? 0) > 0 ? '+' : ''}${Math.round((e.magnitude ?? 0) * 100)}% hit chance for ${who}`); break;
      case 'ground_flight': out.push(`Forces fliers to the ground (${who})`); break;
      case 'stealth_bonus': out.push(`Harder to hit while stealthed (${who})`); break;
      case 'add_context_tags': out.push(`Adds battlefield condition: ${e.tags?.join(', ')}`); break;
      case 'remove_context_tags': out.push(`Removes battlefield condition: ${e.tags?.join(', ')}`); break;
    }
  }
  return out;
}

function renderFor(pid: 'p1' | 'p2') {
  const cfg = state.players[pid === 'p1' ? 0 : 1];
  if (cfg.isAI) {
    finishOrNext(pid);
    return;
  }
  const prep = state.prep![pid];

  const node = el(`
  <div>
    ${topbar(`Wildcard — ${esc(cfg.name)} · exact mechanics shown before you lock`)}
    <div class="screen wide">
      <p class="muted mb">One wildcard per player. You see its exact compiled mechanics now; both wildcards are revealed only after both players lock. Deployment timing stays in your hands during battle. Every wildcard has counterplay.</p>
      <div class="grid cols-4" id="wc-grid">
        ${WILDCARDS.map((w) => `
          <div class="wildcard-card ${prep.wildcardId === w.wildcardId ? 'selected' : ''}" data-id="${esc(w.wildcardId)}">
            <div class="wc-class">${esc(w.class)} · ${w.durationTicks === 0 ? 'permanent' : `${(w.durationTicks / 4).toFixed(0)}s`}${w.objectHp ? ` · ${w.objectHp} HP` : ''}${w.radius ? ` · ${w.radius}m` : ''}</div>
            <h4>${esc(w.normalizedName)}</h4>
            <div class="small">${humanizeEffect(w).map((s) => `<div>· ${esc(s)}</div>`).join('')}</div>
            <div class="small muted mt"><b>Counterplay:</b> ${esc(w.counterplay[0] ?? '')}</div>
          </div>`).join('')}
      </div>
      <div class="grid cols-2 mt">
        <div class="panel" id="wc-detail"><h3>Select a wildcard</h3><p class="muted small">Click a card to inspect its full compiled contract.</p></div>
        <div>
          <button class="primary" id="btn-lock" style="width:100%" disabled>Lock wildcard</button>
          <p class="muted small mt">Locking is final for this match.</p>
        </div>
      </div>
    </div>
  </div>`);

  const detail = q(node, '#wc-detail');
  const lockBtn = q<HTMLButtonElement>(node, '#btn-lock');

  const select = (id: string) => {
    prep.wildcardId = id;
    const w = WILDCARD_BY_ID.get(id)!;
    qa(node, '.wildcard-card').forEach((c) => c.classList.toggle('selected', c.dataset.id === id));
    detail.innerHTML = `
      <h3>${esc(w.normalizedName)} — full compiled mechanics</h3>
      <p class="small">${esc(w.inputDescription)}</p>
      <div class="small mt">${humanizeEffect(w).map((s) => `<div>· ${esc(s)}</div>`).join('')}</div>
      <h3 class="mt">Counterplay</h3>
      ${w.counterplay.map((c) => `<p class="small muted">· ${esc(c)}</p>`).join('')}
      <h3 class="mt">Side effects</h3>
      ${w.sideEffects.map((c) => `<p class="small muted">· ${esc(c)}</p>`).join('')}
      <h3 class="mt">Manifestation</h3>
      <p class="small muted">${esc(w.visualManifestation)}</p>
      <p class="small mt">Confidence: <b>${esc(w.confidence)}</b> · ${esc(w.provenance)}</p>`;
    lockBtn.disabled = false;
    track('wildcard_inspected', { wildcardId: id });
  };

  qa(node, '.wildcard-card').forEach((c) => c.addEventListener('click', () => select(c.dataset.id!)));
  if (prep.wildcardId) select(prep.wildcardId);

  lockBtn.addEventListener('click', () => {
    track('wildcard_locked', { player: pid, wildcardId: prep.wildcardId! });
    finishOrNext(pid);
  });

  mount(node);
}

async function finishOrNext(pid: 'p1' | 'p2') {
  if (pid === 'p1') {
    const p2cfg = state.players[1];
    if (!p2cfg.isAI) {
      await interstitial(`${p2cfg.name}'s wildcard`, 'Pass the screen — wildcard picks are secret until both are locked.');
      renderFor('p2');
      return;
    }
  }
  revealAndLaunch();
}

function revealAndLaunch() {
  // Server-side-style legality check before anything launches (never trust the UI).
  const teams = [buildTeamSetup('p1'), buildTeamSetup('p2')];
  for (const t of teams) {
    const issues = validateTeamSetup(t, RULESET_S0, DNA_BY_ID);
    if (hasErrors(issues)) {
      alert(`Draft legality check failed for ${t.displayName}:\n` + issues.map((i) => i.message).join('\n'));
      go('draft');
      return;
    }
  }
  state.teams = teams;

  const w1 = teams[0].wildcardId ? WILDCARD_BY_ID.get(teams[0].wildcardId) : null;
  const w2 = teams[1].wildcardId ? WILDCARD_BY_ID.get(teams[1].wildcardId) : null;
  const node = el(`
  <div>
    ${topbar('Wildcards revealed')}
    <div class="screen">
      <div class="grid cols-2 mb">
        ${[{ t: teams[0], w: w1 }, { t: teams[1], w: w2 }].map(({ t, w }) => `
          <div class="panel wildcard-card">
            <h3>${esc(t.displayName)}</h3>
            ${w ? `<h4>${esc(w.normalizedName)}</h4>
              <div class="small">${humanizeEffect(w).map((s) => `<div>· ${esc(s)}</div>`).join('')}</div>
              <p class="small muted mt">Counterplay: ${esc(w.counterplay[0] ?? '')}</p>` : '<p class="muted">No wildcard locked</p>'}
          </div>`).join('')}
      </div>
      <div class="center">
        <button class="primary" id="btn-battle" style="font-size:19px;padding:14px 44px">⚔ Begin the battle</button>
      </div>
    </div>
  </div>`);
  q(node, '#btn-battle').addEventListener('click', () => {
    track('match_started', { mode: state.mode });
    go('battle');
  });
  mount(node);
}
