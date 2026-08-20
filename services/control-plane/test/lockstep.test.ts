/**
 * LOCKSTEP PROOF: two real ws clients each rebuild the battle locally from the
 * snapshot (teams + seed) using the same MatchSim engine, apply every relayed
 * `battle_input` at its issuedTick before stepping each authorized tick, and
 * must land on the server's exact event hash and outcome.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RULESET_S0, type BattleInput, type ServerMessage } from '@arena/contracts';
import { MatchSim, hashRun, runManifest, type SimContent } from '@arena/combat-sim';
import { loadContent } from '../../../tools/load-content';
import { createControlPlane, type ControlPlane } from '../src/server';
import {
  P2_PICKS,
  TestClient,
  createRoomPair,
  lockWildcards,
  runScriptedDraft,
  submitPreps,
  tmpDataDir,
} from './helpers';

const content = loadContent();

interface LockstepState {
  sim: MatchSim | null;
  inputs: BattleInput[];
  ptr: number;
}

/** Step the local sim up to `tick`, applying inputs exactly as the server does. */
function advance(state: LockstepState, tick: number) {
  const sim = state.sim!;
  while (sim.tick < tick && !sim.over) {
    const next = sim.tick + 1;
    while (state.ptr < state.inputs.length && state.inputs[state.ptr].issuedTick <= next) {
      const inp = state.inputs[state.ptr++];
      if (inp.kind === 'command') {
        sim.applyCommand({
          kind: inp.command,
          playerId: inp.playerId,
          targetFighterId: inp.targetFighterId,
          issuedTick: sim.tick,
        });
      } else {
        sim.deployWildcard({ playerId: inp.playerId, wildcardId: inp.wildcardId, x: inp.x, z: inp.z, issuedTick: sim.tick });
      }
    }
    sim.step();
  }
}

/** Attach a lockstep client sim that follows the live message stream. */
function attachLockstep(c: TestClient): LockstepState {
  const state: LockstepState = { sim: null, inputs: [], ptr: 0 };
  c.hooks.push((m: ServerMessage) => {
    if (m.t === 'room_state' && m.state.phase === 'battle' && m.state.battle && !state.sim) {
      const b = m.state.battle;
      const simContent: SimContent = {
        fighters: new Map(content.fighters),
        wildcards: new Map(content.wildcards),
        arena: content.arenas.get(b.arenaId)!,
      };
      // Room-scoped custom content rides in the same snapshot.
      for (const f of m.state.draft?.customFighters ?? []) simContent.fighters.set(f.dna.identity.fighterId, f.dna);
      for (const w of m.state.wildcard?.customWildcards ?? []) simContent.wildcards.set(w.wildcardId, w);
      state.sim = new MatchSim({ matchId: b.matchId, seed: b.seed, ruleset: RULESET_S0, teams: b.teams }, simContent);
      state.inputs.push(...b.inputs);
      advance(state, b.authorizedTick); // fast-forward (reconnect path shares this)
    }
    if (m.t === 'battle_input') state.inputs.push(m.input);
    if (m.t === 'tick_advance' && state.sim) advance(state, m.tick);
  });
  return state;
}

describe('control plane — lockstep determinism', () => {
  let cp: ControlPlane;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = tmpDataDir();
    cp = await createControlPlane({ port: 0, dataDir, tickIntervalMs: 5 });
  });
  afterAll(async () => {
    await cp.close();
  });

  it('both client sims reproduce the server event hash exactly, inputs included', async () => {
    const { host, p2 } = await createRoomPair(cp.port);
    const hostSim = attachLockstep(host);
    const p2Sim = attachLockstep(p2);

    // Mid-battle input scripting, driven by authoritative tick_advance:
    let sentEarly = false;
    let sentFocus = false;
    host.hooks.push((m) => {
      if (m.t !== 'tick_advance') return;
      if (!sentEarly && m.tick >= 4) {
        sentEarly = true;
        host.send({ t: 'battle_command', command: 'press_attack' });
        p2.send({ t: 'battle_wildcard', x: 5, z: -3 });
      }
      if (!sentFocus && m.tick >= 24) {
        sentFocus = true;
        host.send({ t: 'battle_command', command: 'focus_target', targetFighterId: P2_PICKS[0] }); // an enemy fighter
      }
    });

    await runScriptedDraft(host, p2);
    await submitPreps(host, p2);
    await lockWildcards(host, p2, 'gravity-well', 'eclipse');

    const [overHost, overP2] = await Promise.all([
      host.waitType('battle_over', 60_000),
      p2.waitType('battle_over', 60_000),
    ]);
    expect(overHost.eventHash).toBe(overP2.eventHash);

    // Inputs actually flowed: 2 commands + 1 wildcard deployment relayed to everyone.
    const cmdCount = hostSim.inputs.filter((i) => i.kind === 'command').length;
    const wcCount = hostSim.inputs.filter((i) => i.kind === 'wildcard').length;
    expect(cmdCount).toBe(2);
    expect(wcCount).toBe(1);
    expect(p2Sim.inputs).toEqual(hostSim.inputs);

    // THE lockstep assertion: both local sims === server, bit for bit.
    for (const [label, s] of [
      ['host', hostSim],
      ['p2', p2Sim],
    ] as const) {
      expect(s.sim, label).not.toBeNull();
      expect(s.sim!.over, label).toBe(true);
      expect(s.sim!.tick, label).toBe(overHost.finalTick);
      expect(s.sim!.outcome, label).toEqual(overHost.outcome);
      expect(hashRun(s.sim!.events, s.sim!.outcome!), label).toBe(overHost.eventHash);
    }

    // The client sims saw the inputs take effect.
    const types = new Set(hostSim.sim!.events.map((e) => e.type));
    expect(types.has('TACTICAL_COMMAND_ISSUED')).toBe(true);
    expect(types.has('WILDCARD_DEPLOYED')).toBe(true);

    // Persisted manifest (with recorded timelines) replays to the same hash.
    const lines = readFileSync(join(dataDir, 'matches.jsonl'), 'utf8').trim().split('\n');
    const record = JSON.parse(lines[lines.length - 1]);
    expect(record.manifest.commandTimeline.length).toBe(cmdCount);
    expect(record.manifest.wildcardTimeline.length).toBe(wcCount);
    const replay = runManifest(record.manifest, {
      fighters: content.fighters,
      wildcards: content.wildcards,
      arena: content.arenas.get('meridian-plaza')!,
    });
    expect(replay.hash).toBe(overHost.eventHash);

    host.close();
    p2.close();
  }, 90_000);
});
