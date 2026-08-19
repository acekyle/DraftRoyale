import { ARENA, money } from '../content';
import {
  state, go, saveProfileName, loadChampion, loadHistory, decodeDethroneHash,
  encodeDethroneLink, track, exportTelemetry,
} from '../state';
import { el, esc, mount, q, topbar } from '../ui';
import { RULESET_S0 } from '@arena/contracts';

export function renderHome() {
  const champion = loadChampion();
  const dethrone = decodeDethroneHash();
  const history = loadHistory();
  if (dethrone) track('challenge_link_opened', { champion: dethrone.playerName });

  const node = el(`
  <div>
    ${topbar('Season 0 · Enhanced Division · Private Alpha (local build)')}
    <div class="screen">
      <div class="hero">
        <h1>INFINITE <em>ARENA</em></h1>
        <div class="tag">Draft a fresh team under the cap. Add one wildcard. Watch the argument get settled.</div>
        <div class="quote">“Run it back. I know what team can beat that.”</div>
      </div>

      ${dethrone ? `
      <div class="panel champion-banner mb">
        <h3>⚔ Challenge received</h3>
        <p><b>${esc(dethrone.playerName)}</b> holds the crown with a ${dethrone.team.roster.length}-fighter squad
          (${esc(dethrone.team.roster.map((r) => r.fighterId).join(', '))}) — win streak ${dethrone.winStreak}.</p>
        <p class="muted small mt">Their lineup is frozen exactly as it won. You draft fresh. Dethrone them.</p>
        <button class="primary mt" id="btn-dethrone">Accept the challenge</button>
      </div>` : ''}

      <div class="panel mb">
        <h3>Guest entry</h3>
        <div class="row wrap">
          <input type="text" id="p1name" placeholder="Your display name" maxlength="24" value="${esc(state.players[0].name)}" />
          <span class="muted small">No account needed. Your history, champion records, and links live in this browser until account upgrade ships.</span>
        </div>
      </div>

      <div class="grid cols-2 mb">
        <div class="panel mode-card" id="mode-solo">
          <div class="icon">🤖</div>
          <h3>Solo Gauntlet</h3>
          <p class="muted small">Draft against Architect-7, the house AI. Full loop: draft → prep → wildcard → battle → breakdown.</p>
        </div>
        <div class="panel mode-card" id="mode-hotseat">
          <div class="icon">🛋️</div>
          <h3>Couch Versus</h3>
          <p class="muted small">Two players, one machine. Wildcard picks stay private via pass-the-screen. Online rooms are the next milestone.</p>
        </div>
      </div>

      ${champion ? `
      <div class="panel champion-banner mb">
        <h3>👑 Reigning champion — ${esc(champion.playerName)}</h3>
        <p class="small">Squad: ${esc(champion.team.roster.map((r) => r.fighterId).join(', '))}
          · streak ${champion.winStreak} · defended ${champion.defended}×</p>
        <div class="row mt">
          <button id="btn-challenge-champ">Challenge the Crown</button>
          <button id="btn-copy-link">Copy dethrone link</button>
          <span class="muted small" id="copy-note"></span>
        </div>
      </div>` : ''}

      <div class="grid cols-2">
        <div class="panel">
          <h3>Tonight's arena</h3>
          <b>${esc(ARENA.name)}</b>
          <p class="muted small mt">${esc(ARENA.description)}</p>
          <p class="small mt">Cap ${money(RULESET_S0.salaryCap)} · rosters ${RULESET_S0.rosterMin}–${RULESET_S0.rosterMax} · ${RULESET_S0.tacticalTokens} command tokens · 1 wildcard each</p>
        </div>
        <div class="panel">
          <h3>Match history</h3>
          ${history.length === 0 ? '<p class="muted small">No matches yet. History is never erased once you have some.</p>' : ''}
          <div class="pick-log">
            ${history.slice(0, 8).map((h) => `
              <div><b class="gold">${esc(h.winnerName)}</b> won by ${esc(h.outcome.reason)} ·
              <span class="muted">${esc(new Date(h.playedAt).toLocaleString())}</span></div>`).join('')}
          </div>
          <button class="small mt" id="btn-export">Export local telemetry</button>
        </div>
      </div>
    </div>
  </div>`);

  const nameOf = () => (q<HTMLInputElement>(node, '#p1name').value.trim() || 'Challenger');

  q(node, '#mode-solo').addEventListener('click', () => start('solo', nameOf()));
  q(node, '#mode-hotseat').addEventListener('click', () => start('hotseat', nameOf()));
  if (dethrone) {
    q(node, '#btn-dethrone').addEventListener('click', () => {
      state.dethroneTarget = dethrone;
      start('dethrone', nameOf());
    });
  }
  if (champion) {
    const challengeBtn = node.querySelector('#btn-challenge-champ');
    challengeBtn?.addEventListener('click', () => {
      state.dethroneTarget = champion;
      start('dethrone', nameOf());
    });
    node.querySelector('#btn-copy-link')?.addEventListener('click', async () => {
      await navigator.clipboard.writeText(encodeDethroneLink(champion));
      q(node, '#copy-note').textContent = 'Link copied — send it to a challenger.';
      track('dethrone_link_created', {});
    });
  }
  q(node, '#btn-export').addEventListener('click', () => {
    const blob = new Blob([exportTelemetry()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'infinite-arena-telemetry.json';
    a.click();
  });

  mount(node);
}

function start(mode: 'solo' | 'hotseat' | 'dethrone', p1name: string) {
  saveProfileName(p1name);
  state.mode = mode;
  state.seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
  state.draft = null;
  state.prep = null;
  state.teams = null;
  state.replayMode = false;
  if (mode === 'solo') {
    state.players = [
      { id: 'p1', name: p1name, isAI: false },
      { id: 'p2', name: 'Architect-7', isAI: true },
    ];
  } else if (mode === 'hotseat') {
    const p2 = prompt('Player 2 — enter your display name:', 'Rival')?.trim() || 'Rival';
    state.players = [
      { id: 'p1', name: p1name, isAI: false },
      { id: 'p2', name: p2, isAI: false },
    ];
  } else {
    const champ = state.dethroneTarget!;
    state.players = [
      { id: 'p1', name: p1name, isAI: false },
      { id: 'p2', name: `${champ.playerName} (frozen champion)`, isAI: true, frozenTeam: champ.team },
    ];
  }
  track('room_created', { mode });
  track('guest_joined', { mode });
  go('reveal');
}
