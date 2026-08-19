/**
 * Online battle — lockstep-deterministic mirror of the server's authoritative sim.
 * The client applies only server-validated inputs at their issued ticks and never
 * steps past the server-authorized tick. The server's outcome + event hash win
 * any divergence (ADR-0007).
 */
import type { BattleInput, MatchOutcome, ServerMessage, TacticalCommandKind } from '@arena/contracts';
import { RULESET_S0 } from '@arena/contracts';
import { MatchSim, buildBreakdown, formatTick, generateCommentary, hashRun } from '@arena/combat-sim';
import type { CausalBreakdown } from '@arena/contracts';
import { DNA_BY_ID, SIM_CONTENT, WILDCARD_BY_ID, displayName } from '../content';
import type { NetClient } from '../net';
import { track } from '../state';
import { el, esc, q, qa } from '../ui';
import { BattleView } from './renderer';
import { teamPanelHtml } from './battle';

const COMMANDS: { kind: TacticalCommandKind; label: string; needsTarget: 'enemy' | 'ally' | null }[] = [
  { kind: 'focus_target', label: 'Focus', needsTarget: 'enemy' },
  { kind: 'protect_ally', label: 'Protect', needsTarget: 'ally' },
  { kind: 'press_attack', label: 'Press', needsTarget: null },
  { kind: 'disengage', label: 'Disengage', needsTarget: null },
  { kind: 'regroup', label: 'Regroup', needsTarget: null },
  { kind: 'spread_out', label: 'Spread', needsTarget: null },
];

export interface OnlineBattleResult {
  outcome: MatchOutcome;
  breakdown: CausalBreakdown | null;
  transcript: string[];
  hashMatched: boolean;
  serverHash: string;
}

export function mountOnlineBattle(
  root: HTMLElement,
  netClient: NetClient,
  onFinished: (r: OnlineBattleResult) => void,
): { dispose(): void; handleMessage(m: ServerMessage): void } {
  const snap = netClient.snapshot!;
  const battle = snap.battle!;
  const teams = battle.teams;
  const mySeat = netClient.mySeat();

  const sim = new MatchSim(
    { matchId: battle.matchId, seed: battle.seed, ruleset: RULESET_S0, teams },
    SIM_CONTENT,
  );

  const inputs: BattleInput[] = [...battle.inputs];
  let authorizedTick = battle.authorizedTick;
  let lastStepAt = performance.now();
  let stopped = false;
  let finished = false;
  let serverOutcome: { outcome: MatchOutcome; eventHash: string; finalTick: number } | null = null;

  const node = el(`
  <div class="battle-root">
    <div class="battle-canvas" id="canvas-host" style="position:absolute;inset:0"></div>
    <div class="hud">
      <div class="hud-top">
        ${teamPanelHtml(teams[0].playerId, teams[0].displayName, '#4a9dd0', teams)}
        <div></div>
        ${teamPanelHtml(teams[1].playerId, teams[1].displayName, '#e0524a', teams)}
      </div>
      <div class="hud-mid">
        <div class="clock" id="clock">0:00</div>
        <div class="esc-flag" id="esc-flag" style="display:none">⚠ Escalation active</div>
      </div>
      <div class="commentary"><span class="line" id="commentary" style="display:none"></span></div>
      <div class="placing-hint" id="placing-hint" style="display:none">Click the arena to place your wildcard</div>
      <div class="hud-bottom">
        <div class="row" id="trays"></div>
        <div class="speed-tray">
          <span class="conn-pill" id="conn">live</span>
          <div class="emote-bar" id="emotes"></div>
          <button class="small" id="btn-tactical">Tactical view</button>
        </div>
      </div>
    </div>
    <div class="target-picker" id="picker" style="display:none"></div>
  </div>`);
  root.innerHTML = '';
  root.appendChild(node);

  const view = new BattleView(q(node, '#canvas-host'), sim);

  // Reactions bar (players and spectators alike).
  const emotes = q(node, '#emotes');
  for (const e of ['🔥', '😂', '😱', '👏', '💀', '⚡']) {
    const b = document.createElement('button');
    b.className = 'small';
    b.textContent = e;
    b.addEventListener('click', () => netClient.send({ t: 'reaction', emote: e }));
    emotes.appendChild(b);
  }

  // Command tray only for seated players.
  const trays = q(node, '#trays');
  let placing = false;
  if (mySeat) {
    const team = teams.find((t) => t.playerId === mySeat)!;
    const wc = team.wildcardId ? WILDCARD_BY_ID.get(team.wildcardId) : null;
    const tray = el(`
      <div class="cmd-tray">
        <span class="tokens">${esc(team.displayName)} · <span data-tokens>${RULESET_S0.tacticalTokens}</span>⬢</span>
        ${COMMANDS.map((c) => `<button data-cmd="${c.kind}">${c.label}</button>`).join('')}
        ${wc ? `<button data-wildcard style="border-color:var(--purple);color:var(--purple)">⚡ ${esc(wc.normalizedName)}</button>` : ''}
      </div>`);
    trays.appendChild(tray);
    const picker = q(node, '#picker');
    tray.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest('button');
      if (!btn) return;
      if (btn.hasAttribute('data-wildcard')) {
        const contract = wc!;
        if (contract.deployment === 'global') {
          netClient.send({ t: 'battle_wildcard', x: 0, z: 0 });
        } else {
          placing = true;
          view.setPlacing(true);
          q(node, '#placing-hint').style.display = 'block';
        }
        return;
      }
      const kind = btn.dataset.cmd as TacticalCommandKind | undefined;
      if (!kind) return;
      const spec = COMMANDS.find((c) => c.kind === kind)!;
      if (!spec.needsTarget) {
        netClient.send({ t: 'battle_command', command: kind });
        return;
      }
      const pool = spec.needsTarget === 'enemy' ? sim.activeOf(sim.opponentOf(mySeat)) : sim.activeOf(mySeat);
      picker.innerHTML = `<h3 class="small gold">${spec.label} — choose target</h3>` +
        pool.map((f) => `<button class="small" data-t="${esc(f.fighterId)}">${esc(displayName(f.fighterId))}</button>`).join('') +
        '<button class="small danger" data-cancel>Cancel</button>';
      picker.style.display = 'block';
      picker.onclick = (e2) => {
        const b = (e2.target as HTMLElement).closest('button') as HTMLElement | null;
        if (!b) return;
        picker.style.display = 'none';
        if (b.dataset.t) netClient.send({ t: 'battle_command', command: kind, targetFighterId: b.dataset.t });
      };
    });
    view.onGroundClick = (x, z) => {
      if (!placing) return;
      placing = false;
      view.setPlacing(false);
      q(node, '#placing-hint').style.display = 'none';
      netClient.send({ t: 'battle_wildcard', x, z });
    };
  }

  let tactical = false;
  q(node, '#btn-tactical').addEventListener('click', () => {
    tactical = !tactical;
    view.setTactical(tactical);
    q(node, '#btn-tactical').textContent = tactical ? 'Broadcast view' : 'Tactical view';
  });

  // ---- Panels / commentary ----
  const refreshPanels = () => {
    for (const team of teams) {
      const panel = node.querySelector(`[data-team="${team.playerId}"]`);
      if (!panel) continue;
      for (const pick of team.roster) {
        const f = sim.byId(pick.fighterId)!;
        const strip = panel.querySelector(`[data-f="${pick.fighterId}"]`) as HTMLElement;
        if (!strip) continue;
        strip.classList.toggle('ko', f.status === 'ko' || f.status === 'contained' || f.status === 'retired');
        (strip.querySelector('.vit i') as HTMLElement).style.width = `${Math.max(0, (f.vitality / f.dna.resources.vitality) * 100)}%`;
        (strip.querySelector('.stab i') as HTMLElement).style.width = `${Math.max(0, (f.stability / f.dna.resources.stability) * 100)}%`;
        (strip.querySelector('[data-status]') as HTMLElement).textContent =
          f.status === 'reserve' ? 'RES' : f.status === 'ko' ? 'KO' : f.status === 'contained' ? 'CONT' : f.status === 'retired' ? 'OUT' : '';
      }
    }
  };
  const commentaryEl = q(node, '#commentary');
  let shownLines = 0;
  let hideTimer: number | null = null;
  const transcript: string[] = [];
  const refreshCommentary = () => {
    const lines = generateCommentary(sim.events, DNA_BY_ID);
    if (lines.length > shownLines) {
      for (let i = shownLines; i < lines.length; i++)
        transcript.push(`[${formatTick(lines[i].tick, RULESET_S0.tickMs)}] ${lines[i].text}`);
      shownLines = lines.length;
      commentaryEl.textContent = lines[lines.length - 1].text;
      commentaryEl.style.display = 'inline-block';
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => { commentaryEl.style.display = 'none'; }, 3800);
    }
  };

  // ---- Lockstep stepping ----
  const stepTo = (target: number) => {
    while (sim.tick < target && !sim.over) {
      const next = sim.tick + 1;
      for (const input of inputs) {
        if (input.issuedTick !== next) continue;
        if (input.kind === 'command') {
          sim.applyCommand({ kind: input.command, playerId: input.playerId, targetFighterId: input.targetFighterId, issuedTick: input.issuedTick });
        } else {
          sim.deployWildcard({ playerId: input.playerId, wildcardId: input.wildcardId, x: input.x, z: input.z, issuedTick: input.issuedTick });
        }
      }
      view.beforeStep();
      const events = sim.step();
      view.afterStep(events);
      lastStepAt = performance.now();
    }
  };
  stepTo(authorizedTick); // reconnect fast-forward

  const maybeFinish = () => {
    if (finished || !serverOutcome) return;
    stepTo(serverOutcome.finalTick);
    finished = true;
    const localHash = sim.over && sim.outcome ? hashRun(sim.events, sim.outcome) : 'incomplete';
    const hashMatched = localHash === serverOutcome.eventHash;
    const breakdown = sim.over ? buildBreakdown(sim, DNA_BY_ID) : null;
    track('match_completed', { online: true, hashMatched });
    window.setTimeout(() => {
      if (stopped) return;
      stopped = true;
      view.dispose();
      onFinished({
        outcome: serverOutcome!.outcome,
        breakdown,
        transcript,
        hashMatched,
        serverHash: serverOutcome!.eventHash,
      });
    }, 2200);
  };

  const handleMessage = (m: ServerMessage) => {
    if (m.t === 'battle_input') {
      inputs.push(m.input);
    } else if (m.t === 'tick_advance') {
      authorizedTick = Math.max(authorizedTick, m.tick);
    } else if (m.t === 'battle_over') {
      serverOutcome = { outcome: m.outcome, eventHash: m.eventHash, finalTick: m.finalTick };
      maybeFinish();
    } else if (m.t === 'reaction') {
      spawnEmote(m.emote, m.name);
    }
  };

  const spawnEmote = (emote: string, name: string) => {
    const div = document.createElement('div');
    div.className = 'emote-float';
    div.textContent = `${emote}`;
    div.title = name;
    div.style.left = `${15 + Math.random() * 70}%`;
    div.style.bottom = '120px';
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 1700);
  };

  const loop = (now: number) => {
    if (stopped) return;
    stepTo(Math.min(authorizedTick, sim.tick + 4));
    if (serverOutcome) maybeFinish();
    q(node, '#clock').textContent = formatTick(sim.tick, RULESET_S0.tickMs);
    q(node, '#esc-flag').style.display = sim.tick >= RULESET_S0.softLimitTicks ? 'block' : 'none';
    const conn = q(node, '#conn');
    conn.className = `conn-pill ${netClient.status === 'open' ? 'ok' : 'bad'}`;
    conn.textContent = netClient.status === 'open' ? 'live' : 'reconnecting…';
    refreshPanels();
    refreshCommentary();
    if (mySeat) {
      const tokensEl = node.querySelector('[data-tokens]') as HTMLElement | null;
      if (tokensEl) tokensEl.textContent = String(sim.tokensRemaining(mySeat));
      qa(node, '[data-cmd]').forEach((b) => ((b as HTMLButtonElement).disabled = sim.tokensRemaining(mySeat) <= 0 || sim.over));
      const wcBtn = node.querySelector('[data-wildcard]') as HTMLButtonElement | null;
      if (wcBtn) wcBtn.disabled = !sim.wildcardAvailable(mySeat) || sim.over;
    }
    const alpha = Math.min(1, (now - lastStepAt) / RULESET_S0.tickMs);
    view.frame(16, alpha);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  return {
    dispose() {
      stopped = true;
      view.dispose();
    },
    handleMessage,
  };
}
