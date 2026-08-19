import type { ChampionRecord, MatchManifest, TacticalCommandKind } from '@arena/contracts';
import { RULESET_S0 } from '@arena/contracts';
import {
  MatchSim, buildBreakdown, buildManifest, formatTick, generateCommentary,
} from '@arena/combat-sim';
import { ARENA, DNA_BY_ID, FILE_BY_ID, SIM_CONTENT, WILDCARD_BY_ID, displayName } from '../content';
import { AiBattleController } from '../opponentAI';
import { go, loadChampion, pushHistory, saveChampion, state, track } from '../state';
import { el, esc, q, qa } from '../ui';
import { BattleView } from './renderer';

const COMMANDS: { kind: TacticalCommandKind; label: string; needsTarget: 'enemy' | 'ally' | null }[] = [
  { kind: 'focus_target', label: 'Focus', needsTarget: 'enemy' },
  { kind: 'protect_ally', label: 'Protect', needsTarget: 'ally' },
  { kind: 'press_attack', label: 'Press', needsTarget: null },
  { kind: 'disengage', label: 'Disengage', needsTarget: null },
  { kind: 'regroup', label: 'Regroup', needsTarget: null },
  { kind: 'spread_out', label: 'Spread', needsTarget: null },
];

export function renderBattle() {
  const replay = state.replayMode && !!state.lastManifest;
  const teams = replay ? state.lastManifest!.teams : state.teams!;
  const seed = replay ? state.lastManifest!.randomSeed : state.seed;
  const matchId = replay ? state.lastManifest!.matchId : `m-${seed.toString(16)}`;

  const sim = new MatchSim({ matchId, seed, ruleset: RULESET_S0, teams }, SIM_CONTENT);
  const manifest: MatchManifest = replay
    ? state.lastManifest!
    : buildManifest({
        matchId,
        roomId: `room-${state.mode}`,
        createdAt: new Date().toISOString(),
        ruleset: RULESET_S0,
        arenaId: ARENA.arenaId,
        arenaVersion: ARENA.version,
        seed,
        teams,
        content: SIM_CONTENT,
      });

  // Replay timelines (sorted, consumed as ticks pass).
  const rCmds = replay ? [...manifest.commandTimeline].sort((a, b) => a.issuedTick - b.issuedTick) : [];
  const rWcs = replay ? [...manifest.wildcardTimeline].sort((a, b) => a.issuedTick - b.issuedTick) : [];
  let rci = 0, rwi = 0;

  const aiControllers: AiBattleController[] = [];
  if (!replay) {
    for (const [i, cfg] of state.players.entries()) {
      if (cfg.isAI) {
        const team = teams[i];
        aiControllers.push(
          new AiBattleController(sim, team, seed, (kind, detail) => {
            if (kind === 'command') manifest.commandTimeline.push({ kind: detail as TacticalCommandKind, playerId: team.playerId, issuedTick: sim.tick });
            // wildcard deployments are recorded below via the sim call wrapper
          }),
        );
      }
    }
  }

  const humanPids = replay ? [] : (['p1', 'p2'] as const).filter((pid) => !state.players[pid === 'p1' ? 0 : 1].isAI);

  const node = el(`
  <div class="battle-root">
    <div class="battle-canvas" id="canvas-host" style="position:absolute;inset:0"></div>
    <div class="hud">
      <div class="hud-top">
        ${teamPanelHtml(teams[0].playerId, teams[0].displayName, '#4a9dd0')}
        <div></div>
        ${teamPanelHtml(teams[1].playerId, teams[1].displayName, '#e0524a')}
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
          <button class="small" data-speed="1">1×</button>
          <button class="small" data-speed="2">2×</button>
          <button class="small" data-speed="4">4×</button>
          <button class="small" id="btn-tactical">Tactical view</button>
          ${replay ? '<button class="small" id="btn-exit">Exit replay</button>' : '<button class="small" id="btn-ff">Skip to result</button>'}
        </div>
      </div>
    </div>
    <div class="target-picker" id="picker" style="display:none"></div>
  </div>`);
  document.getElementById('app')!.innerHTML = '';
  document.getElementById('app')!.appendChild(node);

  const view = new BattleView(q(node, '#canvas-host'), sim);

  // ---- Command trays for human players ----
  const trays = q(node, '#trays');
  for (const pid of humanPids) {
    const team = teams.find((t) => t.playerId === pid)!;
    const wc = team.wildcardId ? WILDCARD_BY_ID.get(team.wildcardId) : null;
    const tray = el(`
      <div class="cmd-tray" data-pid="${pid}">
        <span class="tokens">${esc(team.displayName)} · <span data-tokens>2</span >⬢</span>
        ${COMMANDS.map((c) => `<button data-cmd="${c.kind}">${c.label}</button>`).join('')}
        ${wc ? `<button data-wildcard style="border-color:var(--purple);color:var(--purple)">⚡ ${esc(wc.normalizedName)}</button>` : ''}
      </div>`);
    trays.appendChild(tray);
  }

  let placingFor: string | null = null;
  const picker = q(node, '#picker');

  const refreshTray = () => {
    for (const pid of humanPids) {
      const tray = trays.querySelector(`[data-pid="${pid}"]`);
      if (!tray) continue;
      const tokens = sim.tokensRemaining(pid);
      (tray.querySelector('[data-tokens]') as HTMLElement).textContent = String(tokens);
      qa(tray as HTMLElement, '[data-cmd]').forEach((b) => ((b as HTMLButtonElement).disabled = tokens <= 0 || sim.over));
      const wcBtn = tray.querySelector('[data-wildcard]') as HTMLButtonElement | null;
      if (wcBtn) wcBtn.disabled = !sim.wildcardAvailable(pid) || sim.over;
    }
  };

  const issueCommand = (pid: string, kind: TacticalCommandKind, target?: string) => {
    const res = sim.applyCommand({ kind, playerId: pid, targetFighterId: target, issuedTick: sim.tick });
    if (res.accepted) {
      manifest.commandTimeline.push({ kind, playerId: pid, targetFighterId: target, issuedTick: sim.tick });
      track('tactical_command', { kind });
    }
    refreshTray();
  };

  trays.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest('button');
    if (!btn) return;
    const pid = (btn.closest('.cmd-tray') as HTMLElement).dataset.pid!;
    if (btn.hasAttribute('data-wildcard')) {
      const team = teams.find((t) => t.playerId === pid)!;
      const wc = WILDCARD_BY_ID.get(team.wildcardId!)!;
      if (wc.deployment === 'global') {
        deployWildcard(pid, 0, 0);
      } else {
        placingFor = pid;
        view.setPlacing(true);
        q(node, '#placing-hint').style.display = 'block';
      }
      return;
    }
    const kind = btn.dataset.cmd as TacticalCommandKind | undefined;
    if (!kind) return;
    const spec = COMMANDS.find((c) => c.kind === kind)!;
    if (!spec.needsTarget) {
      issueCommand(pid, kind);
      return;
    }
    const pool = spec.needsTarget === 'enemy' ? sim.activeOf(sim.opponentOf(pid)) : sim.activeOf(pid);
    picker.innerHTML = `<h3 class="small gold">${spec.label} — choose target</h3>` +
      pool.map((f) => `<button class="small" data-t="${esc(f.fighterId)}">${esc(displayName(f.fighterId))}</button>`).join('') +
      '<button class="small danger" data-cancel>Cancel</button>';
    picker.style.display = 'block';
    picker.onclick = (e2) => {
      const b = (e2.target as HTMLElement).closest('button') as HTMLElement | null;
      if (!b) return;
      picker.style.display = 'none';
      if (b.dataset.t) issueCommand(pid, kind, b.dataset.t);
    };
  });

  const deployWildcard = (pid: string, x: number, z: number) => {
    const team = teams.find((t) => t.playerId === pid)!;
    const res = sim.deployWildcard({ playerId: pid, wildcardId: team.wildcardId!, x, z, issuedTick: sim.tick });
    if (res.accepted) {
      manifest.wildcardTimeline.push({ playerId: pid, wildcardId: team.wildcardId!, x, z, issuedTick: sim.tick });
      track('wildcard_deployed', { wildcardId: team.wildcardId! });
    }
    placingFor = null;
    view.setPlacing(false);
    q(node, '#placing-hint').style.display = 'none';
    refreshTray();
  };
  view.onGroundClick = (x, z) => {
    if (placingFor) deployWildcard(placingFor, x, z);
  };

  // AI wildcard deployments need recording too — wrap the sim method once.
  if (!replay) {
    const orig = sim.deployWildcard.bind(sim);
    sim.deployWildcard = (dep) => {
      const res = orig(dep);
      if (res.accepted && state.players[dep.playerId === 'p1' ? 0 : 1].isAI) {
        manifest.wildcardTimeline.push({ ...dep, issuedTick: sim.tick });
      }
      return res;
    };
  }

  // ---- Speed / view controls ----
  let speed = 1;
  qa(node, '[data-speed]').forEach((b) =>
    b.addEventListener('click', () => { speed = Number(b.dataset.speed); }),
  );
  let tactical = false;
  q(node, '#btn-tactical').addEventListener('click', () => {
    tactical = !tactical;
    view.setTactical(tactical);
    q(node, '#btn-tactical').textContent = tactical ? 'Broadcast view' : 'Tactical view';
  });
  node.querySelector('#btn-exit')?.addEventListener('click', () => {
    stopped = true;
    view.dispose();
    state.replayMode = false;
    go('breakdown');
  });
  node.querySelector('#btn-ff')?.addEventListener('click', () => { speed = 40; });

  // ---- Team panel refresh ----
  const refreshPanels = () => {
    for (const team of teams) {
      const panel = node.querySelector(`[data-team="${team.playerId}"]`);
      if (!panel) continue;
      for (const pick of team.roster) {
        const f = sim.byId(pick.fighterId)!;
        const strip = panel.querySelector(`[data-f="${pick.fighterId}"]`) as HTMLElement;
        if (!strip) continue;
        strip.classList.toggle('ko', f.status === 'ko' || f.status === 'contained' || f.status === 'retired');
        const vit = strip.querySelector('.vit i') as HTMLElement;
        const stab = strip.querySelector('.stab i') as HTMLElement;
        vit.style.width = `${Math.max(0, (f.vitality / f.dna.resources.vitality) * 100)}%`;
        stab.style.width = `${Math.max(0, (f.stability / f.dna.resources.stability) * 100)}%`;
        const status = strip.querySelector('[data-status]') as HTMLElement;
        status.textContent =
          f.status === 'reserve' ? 'RES' : f.status === 'ko' ? 'KO' : f.status === 'contained' ? 'CONT' : f.status === 'retired' ? 'OUT' : '';
      }
    }
  };

  // ---- Commentary ----
  const commentaryEl = q(node, '#commentary');
  let shownLines = 0;
  let hideTimer: number | null = null;
  const transcript: string[] = [];
  const refreshCommentary = () => {
    const lines = generateCommentary(sim.events, DNA_BY_ID);
    if (lines.length > shownLines) {
      const latest = lines[lines.length - 1];
      for (let i = shownLines; i < lines.length; i++) transcript.push(`[${formatTick(lines[i].tick, RULESET_S0.tickMs)}] ${lines[i].text}`);
      shownLines = lines.length;
      commentaryEl.textContent = latest.text;
      commentaryEl.style.display = 'inline-block';
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => { commentaryEl.style.display = 'none'; }, 3800);
    }
  };

  // ---- Main loop ----
  let last = performance.now();
  let accum = 0;
  let stopped = false;
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    const outcome = sim.outcome!;
    const breakdown = buildBreakdown(sim, DNA_BY_ID);
    const winnerTeam = teams.find((t) => t.playerId === outcome.winnerPlayerId)!;
    state.lastManifest = manifest;
    state.lastOutcome = outcome;
    state.lastBreakdown = breakdown;
    (state as { lastTranscript?: string[] }).lastTranscript = transcript;
    if (!replay) {
      pushHistory({
        manifest,
        outcome,
        breakdownSummary: breakdown.summary,
        winnerName: winnerTeam.displayName,
        playedAt: new Date().toISOString(),
      });
      updateChampion(outcome.winnerPlayerId, manifest);
      track('match_completed', { winner: winnerTeam.displayName, reason: outcome.reason, ticks: outcome.finalTick });
    }
    window.setTimeout(() => {
      if (!stopped) {
        stopped = true;
        view.dispose();
        state.replayMode = false;
        go('breakdown');
      }
    }, replay ? 1400 : 2400);
  };

  const loop = (now: number) => {
    if (stopped) return;
    const dt = now - last;
    last = now;
    if (!sim.over) {
      accum += dt * speed;
      let steps = 0;
      while (accum >= RULESET_S0.tickMs && !sim.over && steps < 200) {
        // Apply replay timelines / AI decisions for the tick about to run.
        if (replay) {
          while (rci < rCmds.length && rCmds[rci].issuedTick === sim.tick) sim.applyCommand(rCmds[rci++]);
          while (rwi < rWcs.length && rWcs[rwi].issuedTick === sim.tick) sim.deployWildcard(rWcs[rwi++]);
        } else {
          for (const ai of aiControllers) ai.onTick();
        }
        view.beforeStep();
        const events = sim.step();
        view.afterStep(events);
        accum -= RULESET_S0.tickMs;
        steps++;
      }
      q(node, '#clock').textContent = formatTick(sim.tick, RULESET_S0.tickMs);
      q(node, '#esc-flag').style.display = sim.tick >= RULESET_S0.softLimitTicks ? 'block' : 'none';
      refreshPanels();
      refreshCommentary();
      refreshTray();
      if (sim.over) finish();
    }
    const alpha = Math.min(1, accum / RULESET_S0.tickMs);
    view.frame(dt, alpha);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  refreshTray();
  refreshPanels();
}

export function teamPanelHtml(pid: string, name: string, color: string, teamsOverride?: import('@arena/contracts').TeamSetup[]): string {
  const team = (teamsOverride ?? (state.replayMode && state.lastManifest ? state.lastManifest.teams : state.teams!))
    .find((t) => t.playerId === pid)!;
  return `
  <div class="team-panel" data-team="${esc(pid)}">
    <div class="tname" style="color:${color}">${esc(name)}</div>
    ${team.roster.map((r) => {
      const f = FILE_BY_ID.get(r.fighterId)!;
      const active = team.activeFighterIds.includes(r.fighterId);
      return `
      <div class="fighter-strip" data-f="${esc(r.fighterId)}">
        <span class="dot" style="background:${esc(f.dna.presentation.primaryColor)}"></span>
        <span class="fname">${team.captainId === r.fighterId ? '★ ' : ''}${esc(f.contract.identity.displayName)}</span>
        <span class="bars">
          <span class="vit"><i style="width:100%"></i></span>
          <span class="stab"><i style="width:100%"></i></span>
        </span>
        <span class="muted small" data-status>${active ? '' : 'RES'}</span>
      </div>`;
    }).join('')}
  </div>`;
}

function updateChampion(winnerPid: string, manifest: MatchManifest) {
  const teams = state.teams!;
  const winnerTeam = teams.find((t) => t.playerId === winnerPid)!;
  const winnerCfg = state.players[winnerPid === 'p1' ? 0 : 1];
  const prev = loadChampion();

  if (state.mode === 'dethrone' && winnerPid === 'p2') {
    // The frozen champion defended the crown.
    if (prev && state.dethroneTarget && prev.championId === state.dethroneTarget.championId) {
      prev.defended += 1;
      prev.winStreak += 1;
      saveChampion(prev);
    }
    return;
  }
  const sameHolder = prev && prev.playerName === winnerCfg.name;
  const record: ChampionRecord = {
    championId: `champ-${manifest.matchId}`,
    createdAt: new Date().toISOString(),
    playerName: winnerCfg.name,
    team: winnerTeam,
    matchId: manifest.matchId,
    arenaId: manifest.arenaId,
    rulesetVersion: manifest.rulesetVersion,
    winStreak: sameHolder ? prev!.winStreak + 1 : 1,
    defended: sameHolder ? prev!.defended : 0,
  };
  saveChampion(record);
  track('champion_crowned', { player: winnerCfg.name, streak: record.winStreak });
}
