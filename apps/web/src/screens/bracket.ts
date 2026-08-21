/**
 * Bracket Night — basic four-player single-elimination bracket (Phase 4).
 * Local/hotseat sequencing: each bracket match runs through the full
 * draft→battle loop; results are recorded into a persisted bracket tree.
 */
import { go, loadBracket, saveBracket, state, track, type BracketSlot, type BracketState } from '../state';
import { el, esc, mount, q, qa, topbar } from '../ui';

function matchPlayers(b: BracketState, slot: BracketSlot): [string, string] | null {
  if (slot === 'semi1') return [b.names[0], b.names[3]]; // 1v4 seeding
  if (slot === 'semi2') return [b.names[1], b.names[2]]; // 2v3
  const a = b.winners.semi1, c = b.winners.semi2;
  return a && c ? [a, c] : null;
}

function nextSlot(b: BracketState): BracketSlot | null {
  if (!b.winners.semi1) return 'semi1';
  if (!b.winners.semi2) return 'semi2';
  if (!b.winners.final) return 'final';
  return null;
}

export function recordBracketResult(slot: BracketSlot, winnerName: string) {
  const b = loadBracket();
  if (!b) return;
  b.winners[slot] = winnerName;
  saveBracket(b);
  track('bracket_match_recorded', { slot });
}

export function renderBracket() {
  const b = loadBracket();
  if (!b) {
    renderSetup();
    return;
  }
  const next = nextSlot(b);
  const slotBox = (slot: BracketSlot, title: string) => {
    const players = matchPlayers(b, slot);
    const winner = b.winners[slot];
    return `
      <div class="panel ${next === slot ? 'champion-banner' : ''}">
        <h3>${title}</h3>
        ${players
          ? `<p class="display" style="font-size:17px">${esc(players[0])} <span class="muted">vs</span> ${esc(players[1])}</p>`
          : '<p class="muted small">Waiting for semifinal winners…</p>'}
        ${winner ? `<p class="gold display">🏆 ${esc(winner)}</p>` : next === slot && players ? `<button class="primary mt" data-play="${slot}">Play this match (hotseat)</button>` : ''}
      </div>`;
  };

  const node = el(`
  <div>
    ${topbar('Bracket Night — four players, single elimination')}
    <div class="screen">
      <div class="grid cols-2 mb">
        ${slotBox('semi1', 'Semifinal 1 · seeds 1 & 4')}
        ${slotBox('semi2', 'Semifinal 2 · seeds 2 & 3')}
      </div>
      ${slotBox('final', 'Grand Final')}
      ${b.winners.final ? `
        <div class="verdict">
          <div class="muted display">Bracket champion</div>
          <h1>${esc(b.winners.final)}</h1>
          <p class="muted small">Every match of this bracket is preserved in match history with its full manifest.</p>
        </div>` : ''}
      <div class="row mt wrap">
        <button id="btn-new" class="${b.winners.final ? 'primary' : 'danger'}">${b.winners.final ? 'New bracket' : 'Abandon bracket'}</button>
        <button id="btn-home">Lobby</button>
      </div>
    </div>
  </div>`);

  qa(node, '[data-play]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const slot = btn.dataset.play as BracketSlot;
      const players = matchPlayers(b, slot)!;
      state.mode = 'hotseat';
      state.players = [
        { id: 'p1', name: players[0], isAI: false },
        { id: 'p2', name: players[1], isAI: false },
      ];
      state.seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
      state.draft = null;
      state.prep = null;
      state.teams = null;
      state.replayMode = false;
      state.bracketMatch = slot;
      track('bracket_match_started', { slot });
      go('reveal');
    }),
  );
  q(node, '#btn-new').addEventListener('click', () => {
    saveBracket(null);
    renderBracket();
  });
  q(node, '#btn-home').addEventListener('click', () => go('home'));
  mount(node);
}

function renderSetup() {
  const node = el(`
  <div>
    ${topbar('Bracket Night — enter four players')}
    <div class="screen" style="max-width:560px">
      <div class="panel">
        <h3>Four players, one machine</h3>
        <p class="muted small mb">Seeds 1–4. Semifinals are 1v4 and 2v3; winners meet in the final. Each match is a full fresh draft.</p>
        ${[1, 2, 3, 4].map((n) => `<input type="text" id="seed-${n}" placeholder="Seed ${n} name" maxlength="24" class="mb" style="width:100%;margin-bottom:8px"/>`).join('')}
        <button class="primary" id="btn-start" style="width:100%">Start the bracket</button>
      </div>
      <button class="small mt" id="btn-home">Lobby</button>
    </div>
  </div>`);
  q(node, '#btn-start').addEventListener('click', () => {
    const names = [1, 2, 3, 4].map((n) => q<HTMLInputElement>(node, `#seed-${n}`).value.trim() || `Player ${n}`);
    const unique = new Set(names);
    if (unique.size < 4) {
      alert('Players need four distinct names.');
      return;
    }
    saveBracket({ createdAt: new Date().toISOString(), names: names as BracketState['names'], winners: {} });
    track('bracket_created', {});
    renderBracket();
  });
  q(node, '#btn-home').addEventListener('click', () => go('home'));
  mount(node);
}
