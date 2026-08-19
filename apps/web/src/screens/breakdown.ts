import { formatTick } from '@arena/combat-sim';
import { RULESET_S0 } from '@arena/contracts';
import { FILE_BY_ID, WILDCARD_BY_ID, displayName, money } from '../content';
import { encodeDethroneLink, go, loadChampion, state, track } from '../state';
import { el, esc, mount, q, topbar } from '../ui';

const FACTOR_ICONS: Record<string, string> = {
  draft_value: '📋',
  arena_interaction: '🏟️',
  weakness_exploited: '🎯',
  wildcard_impact: '⚡',
  tactical_command: '📣',
  reserve_entry: '🔄',
  decisive_swing: '📈',
};

export function renderBreakdown() {
  const outcome = state.lastOutcome;
  const breakdown = state.lastBreakdown;
  const manifest = state.lastManifest;
  if (!outcome || !breakdown || !manifest) {
    go('home');
    return;
  }
  track('breakdown_opened', {});
  const winnerTeam = manifest.teams.find((t) => t.playerId === outcome.winnerPlayerId)!;
  const transcript = ((state as { lastTranscript?: string[] }).lastTranscript ?? []);
  const champion = loadChampion();

  const node = el(`
  <div>
    ${topbar('Post-match breakdown — why the winner won')}
    <div class="screen">
      <div class="verdict">
        <div class="muted display">Victory by ${esc(outcome.reason)}</div>
        <h1>${esc(winnerTeam.displayName)}</h1>
        <p class="muted">Final: ${formatTick(outcome.finalTick, RULESET_S0.tickMs)} ·
          ${manifest.teams.map((t) => `${esc(t.displayName)} ${Math.round((outcome.teamVitalityPct[t.playerId] ?? 0) * 100)}%`).join(' vs ')}</p>
      </div>

      <div class="panel mb">
        <h3>The story of the match</h3>
        <p>${esc(breakdown.summary)}</p>
        <p class="small muted mt">Turning point — ${esc(breakdown.turningPoint.description)}</p>
      </div>

      <div class="grid cols-2 mb">
        <div class="panel">
          <h3>Causal factors</h3>
          ${breakdown.factors.slice(0, 7).map((f) => `
            <div class="factor">
              <div class="icon">${FACTOR_ICONS[f.kind] ?? '·'}</div>
              <div><b>${esc(f.headline)}</b><div class="small muted">${esc(f.detail)}</div></div>
            </div>`).join('')}
        </div>
        <div class="panel">
          <h3>Fighter performance</h3>
          <table class="stats-table">
            <tr><th>Fighter</th><th>Team</th><th>Dealt</th><th>Taken</th><th>Healed</th><th>Fate</th></tr>
            ${breakdown.perFighter.map((f) => {
              const team = manifest.teams.find((t) => t.playerId === f.teamId)!;
              return `
              <tr class="${f.survived ? '' : 'ko'}">
                <td><b>${esc(displayName(f.fighterId))}</b></td>
                <td class="muted">${esc(team.displayName)}</td>
                <td>${f.damageDealt}</td><td>${f.damageTaken}</td><td>${f.healingDone}</td>
                <td>${f.survived ? 'Standing' : f.koTick !== null ? `Down ${formatTick(f.koTick, RULESET_S0.tickMs)}` : '—'}</td>
              </tr>`;
            }).join('')}
          </table>
        </div>
      </div>

      <div class="grid cols-2 mb">
        <div class="panel">
          <h3>Rosters & spend</h3>
          ${manifest.teams.map((t) => `
            <p class="small"><b>${esc(t.displayName)}</b> — ${money(t.roster.reduce((s, r) => s + r.pricePaid, 0))} of cap
              ${t.wildcardId ? ` · wildcard: ${esc(WILDCARD_BY_ID.get(t.wildcardId)?.normalizedName ?? t.wildcardId)}` : ''}</p>
            <p class="small muted">${t.roster.map((r) => `${esc(FILE_BY_ID.get(r.fighterId)?.contract.identity.displayName ?? r.fighterId)} (${money(r.pricePaid)})`).join(' · ')}</p>`).join('')}
          <p class="small muted mt">Ruleset ${esc(manifest.rulesetVersion)} · arena ${esc(manifest.arenaId)} v${esc(manifest.arenaVersion)} · seed ${manifest.randomSeed} — this record replays exactly, forever.</p>
        </div>
        <div class="panel">
          <h3>Commentary transcript</h3>
          <div class="pick-log" style="max-height:150px">
            ${transcript.map((l) => `<div class="small">${esc(l)}</div>`).join('') || '<p class="muted small">—</p>'}
          </div>
        </div>
      </div>

      ${champion ? `
      <div class="panel champion-banner mb">
        <h3>👑 ${esc(champion.playerName)} holds the crown — streak ${champion.winStreak}</h3>
        <p class="small muted">The champion lineup is frozen as an immutable challenge. Fresh drafts only from here.</p>
      </div>` : ''}

      <div class="row wrap center" style="justify-content:center">
        <button class="primary" id="btn-runback" style="font-size:17px">🔁 Run it back</button>
        <button id="btn-replay">Watch replay</button>
        ${champion ? '<button id="btn-dethrone-link">Copy dethrone link</button>' : ''}
        <button id="btn-export">Export match manifest</button>
        <button id="btn-home">Lobby</button>
      </div>
      <p class="center muted small mt" id="note"></p>
    </div>
  </div>`);

  q(node, '#btn-runback').addEventListener('click', () => {
    track('run_it_back', { mode: state.mode });
    state.seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    state.draft = null;
    state.prep = null;
    state.teams = null;
    state.replayMode = false;
    go('reveal');
  });
  q(node, '#btn-replay').addEventListener('click', () => {
    track('replay_opened', {});
    state.replayMode = true;
    go('battle');
  });
  node.querySelector('#btn-dethrone-link')?.addEventListener('click', async () => {
    const c = loadChampion();
    if (c) {
      await navigator.clipboard.writeText(encodeDethroneLink(c));
      q(node, '#note').textContent = 'Dethrone link copied — anyone who opens it drafts fresh against the frozen champion.';
      track('dethrone_link_created', {});
    }
  });
  q(node, '#btn-export').addEventListener('click', () => {
    const blob = new Blob(
      [JSON.stringify({ manifest, outcome, breakdown }, null, 2)],
      { type: 'application/json' },
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${manifest.matchId}.match.json`;
    a.click();
  });
  q(node, '#btn-home').addEventListener('click', () => go('home'));

  mount(node);
}
