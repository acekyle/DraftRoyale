import { ARENA, DNA_BY_ID, money } from '../content';
import {
  state, go, saveProfileName, loadChampion, loadHistory, decodeDethroneHash,
  encodeDethroneLink, track, exportTelemetry,
} from '../state';
import { downloadChampionCard } from '../championCard';
import { loadSettings, saveSettings } from '../settings';
import { el, esc, mount, q, topbar } from '../ui';
import { RULESET_S0, type ChampionRecord } from '@arena/contracts';

export function renderHome() {
  const champion = loadChampion();
  const dethrone = decodeDethroneHash();
  const history = loadHistory();
  const settings = loadSettings();
  if (dethrone) track('challenge_link_opened', {});

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

      <div class="grid cols-3 mb">
        <div class="panel mode-card" id="mode-solo">
          <div class="icon">🤖</div>
          <h3>Solo Gauntlet</h3>
          <p class="muted small">Draft against Architect-7, the house AI. Full loop: draft → prep → wildcard → battle → breakdown.</p>
        </div>
        <div class="panel mode-card" id="mode-hotseat">
          <div class="icon">🛋️</div>
          <h3>Couch Versus</h3>
          <p class="muted small">Two players, one machine. Wildcard picks stay private via pass-the-screen.</p>
        </div>
        <div class="panel mode-card" id="mode-online">
          <div class="icon">🌐</div>
          <h3>Online Room</h3>
          <p class="muted small">Server-authoritative rooms with spectators and reactions. LAN/self-hosted while the alpha deployment gate is pending.</p>
        </div>
      </div>
      <div class="row mb" style="justify-content:center">
        <button class="small" id="mode-bracket">🏆 Bracket Night — four players, single elimination</button>
      </div>

      ${champion ? `
      <div class="panel champion-banner mb">
        <h3>👑 Reigning champion — ${esc(champion.playerName)}</h3>
        <p class="small">Squad: ${esc(champion.team.roster.map((r) => r.fighterId).join(', '))}
          · streak ${champion.winStreak} · defended ${champion.defended}×</p>
        <div class="row mt wrap">
          <button id="btn-challenge-champ">Challenge the Crown</button>
          <button id="btn-copy-link">Copy dethrone link</button>
          <button id="btn-champ-card">Download champion card</button>
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

      <div class="panel mt">
        <h3>Settings & accessibility</h3>
        <div class="settings-row">
          <label><input type="checkbox" id="set-motion" ${settings.reducedMotion ? 'checked' : ''}/> Reduced motion</label>
          <label><input type="checkbox" id="set-shake" ${settings.cameraShake ? 'checked' : ''}/> Camera shake</label>
          <label><input type="checkbox" id="set-colorsafe" ${settings.colorSafeStatus ? 'checked' : ''}/> Color-independent status bars</label>
          <label>Text size
            <select id="set-scale">
              <option value="1" ${settings.textScale === 1 ? 'selected' : ''}>Normal</option>
              <option value="1.15" ${settings.textScale === 1.15 ? 'selected' : ''}>Large</option>
              <option value="1.3" ${settings.textScale === 1.3 ? 'selected' : ''}>Larger</option>
            </select>
          </label>
          <span class="muted small">Commentary is text-captioned by default. Full keyboard navigation of the web UI is supported via Tab/Enter.</span>
        </div>
      </div>
    </div>
  </div>`);

  const nameOf = () => (q<HTMLInputElement>(node, '#p1name').value.trim() || 'Challenger');

  q(node, '#mode-solo').addEventListener('click', () => start('solo', nameOf()));
  q(node, '#mode-hotseat').addEventListener('click', () => start('hotseat', nameOf()));
  q(node, '#mode-online').addEventListener('click', () => {
    saveProfileName(nameOf());
    go('online');
  });
  q(node, '#mode-bracket').addEventListener('click', () => {
    saveProfileName(nameOf());
    go('bracket');
  });

  // Settings wiring.
  const syncSettings = () => {
    saveSettings({
      reducedMotion: (q<HTMLInputElement>(node, '#set-motion')).checked,
      cameraShake: (q<HTMLInputElement>(node, '#set-shake')).checked,
      colorSafeStatus: (q<HTMLInputElement>(node, '#set-colorsafe')).checked,
      textScale: Number((q<HTMLSelectElement>(node, '#set-scale')).value) as 1 | 1.15 | 1.3,
    });
  };
  for (const id of ['#set-motion', '#set-shake', '#set-colorsafe', '#set-scale'])
    q(node, id).addEventListener('change', syncSettings);
  if (dethrone) {
    q(node, '#btn-dethrone').addEventListener('click', () => {
      state.dethroneTarget = repriceUnderCurrentRules(dethrone);
      if (state.dethroneTarget) start('dethrone', nameOf());
    });
  }
  if (champion) {
    const challengeBtn = node.querySelector('#btn-challenge-champ');
    challengeBtn?.addEventListener('click', () => {
      state.dethroneTarget = repriceUnderCurrentRules(champion);
      if (state.dethroneTarget) start('dethrone', nameOf());
    });
    node.querySelector('#btn-champ-card')?.addEventListener('click', () => {
      downloadChampionCard(champion);
      track('champion_card_shared', {});
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

/**
 * "Challenge Under Current Rules" (constitution §28): the historical champion
 * record is immutable, but a fresh challenge recompiles the lineup at current
 * locked prices. Incompatible lineups (removed fighters) cannot be challenged.
 */
function repriceUnderCurrentRules(champ: ChampionRecord): ChampionRecord | null {
  const roster = champ.team.roster
    .filter((r) => DNA_BY_ID.has(r.fighterId))
    .map((r) => ({ fighterId: r.fighterId, pricePaid: DNA_BY_ID.get(r.fighterId)!.balance.draftPrice }));
  if (roster.length < champ.team.roster.length || roster.length < 3) {
    alert('This champion lineup is no longer compatible with the current ruleset. The historical record remains preserved.');
    return null;
  }
  return {
    ...champ,
    team: {
      ...champ.team,
      roster,
      activeFighterIds: champ.team.activeFighterIds.filter((id) => DNA_BY_ID.has(id)),
    },
  };
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
