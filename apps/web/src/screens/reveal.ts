import { RULESET_S0 } from '@arena/contracts';
import { ARENA, FIGHTERS, money } from '../content';
import { go, state, track } from '../state';
import { el, esc, mount, q, topbar } from '../ui';

export function renderReveal() {
  track('arena_revealed', { arena: ARENA.arenaId });
  const node = el(`
  <div>
    ${topbar('Arena Reveal — study it before you draft')}
    <div class="screen">
      <div class="center mb">
        <h2 style="font-size:32px">${esc(ARENA.name)}</h2>
        <p class="muted">${esc(ARENA.description)}</p>
      </div>
      <div class="grid cols-2">
        <div class="panel">
          <h3>Every mechanical property, disclosed now</h3>
          <ul class="disclosure-list">
            ${ARENA.disclosures.map((d) => `<li>${esc(d)}</li>`).join('')}
          </ul>
        </div>
        <div>
          <div class="panel mb">
            <h3>Ruleset — Season 0 (${esc(RULESET_S0.version)})</h3>
            <p class="small">Division: <b>Enhanced</b> · Salary cap <b>${money(RULESET_S0.salaryCap)}</b></p>
            <p class="small">Rosters ${RULESET_S0.rosterMin}–${RULESET_S0.rosterMax} fighters · 3 start active, rest in relay reserve</p>
            <p class="small">Draft order: <b>ABBA snake</b> (fairness-simulated, see Decision Ledger)</p>
            <p class="small">1 wildcard + ${RULESET_S0.tacticalTokens} tactical command tokens per player</p>
            <p class="small">Escalation begins at 3:00, decision at 4:30 — no stalemates</p>
            <p class="small muted mt">Fighter prices are season-locked and do NOT change for the arena — spotting situational value is your edge.</p>
          </div>
          <div class="panel">
            <h3>Market preview</h3>
            <p class="small">${FIGHTERS.length} fighters on the board tonight, ${money(Math.min(...FIGHTERS.map((f) => f.dna.balance.draftPrice)))} – ${money(Math.max(...FIGHTERS.map((f) => f.dna.balance.draftPrice)))}.</p>
            <p class="small muted">Exact versions are unique within a draft — if your rival takes a fighter, that version is gone.</p>
          </div>
          <button class="primary mt" id="btn-draft" style="width:100%">Enter the Market Draft</button>
        </div>
      </div>
    </div>
  </div>`);
  q(node, '#btn-draft').addEventListener('click', () => {
    track('draft_started', { mode: state.mode });
    go('draft');
  });
  mount(node);
}
