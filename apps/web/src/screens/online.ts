/** Online rooms — server-authoritative lobby → draft → prep → wildcard → battle. */
import type {
  CompiledFighterResult, FighterFile, FormationId, ReinforcementTrigger,
  RoomSnapshot, ServerMessage, WildcardContract,
} from '@arena/contracts';
import { RULESET_S0 } from '@arena/contracts';
import { computeTeamReadout } from '@arena/combat-sim';
import {
  ARENA, DNA_BY_ID, FIGHTERS, FILE_BY_ID, ROLE_COLORS, WILDCARDS, WILDCARD_BY_ID,
  money, registerCustomFighter, registerCustomWildcard,
} from '../content';
import { defaultServerUrl, net } from '../net';
import { go, state, track } from '../state';
import { el, esc, mount, q, qa, topbar } from '../ui';
import { silhouette } from './draft';
import { FORMATIONS, TRIGGERS } from './prep';
import { mountOnlineBattle, type OnlineBattleResult } from '../battle/onlineBattle';

let battleMount: ReturnType<typeof mountOnlineBattle> | null = null;
let battleResult: OnlineBattleResult | null = null;
let myPrep: { activeFighterIds: string[]; captainId: string; formation: FormationId; reinforcement: ReinforcementTrigger } | null = null;
let prepSubmitted = false;
let myWildcardChoice: string | null = null;
let myCustomWildcards: WildcardContract[] = [];
let pendingNomination: { fighter: FighterFile; notes: string[]; semanticLeft: number; visualLeft: number } | null = null;
let lastPhase = '';

function resetLocal() {
  battleResult = null;
  myPrep = null;
  prepSubmitted = false;
  myWildcardChoice = null;
  myCustomWildcards = [];
  pendingNomination = null;
  lastPhase = '';
}

export function renderOnline() {
  net.onSnapshot = (snap) => {
    // Register any server-compiled experimental content locally.
    for (const f of snap.draft?.customFighters ?? []) registerCustomFighter(f, false);
    for (const w of snap.wildcard?.customWildcards ?? []) registerCustomWildcard(w, false);
    if (snap.phase !== lastPhase) {
      if (lastPhase === 'battle' && battleMount) {
        // battle end handled by battle_over; nothing to do here
      }
      lastPhase = snap.phase;
    }
    if (state.screen === 'online' && snap.phase !== 'battle') renderPhase();
    if (snap.phase === 'battle' && !battleMount && state.screen === 'online') startBattle();
  };
  net.onMessage = (m: ServerMessage) => {
    if (battleMount && (m.t === 'battle_input' || m.t === 'tick_advance' || m.t === 'battle_over' || m.t === 'reaction')) {
      battleMount.handleMessage(m);
      return;
    }
    if (m.t === 'nomination_result') {
      registerCustomFighter(m.fighter, false);
      pendingNomination = { fighter: m.fighter, notes: m.notes, semanticLeft: m.semanticLeft, visualLeft: m.visualLeft };
      renderPhase();
    } else if (m.t === 'custom_wildcard_result') {
      registerCustomWildcard(m.wildcard, false);
      myCustomWildcards.push(m.wildcard);
      renderPhase();
    } else if (m.t === 'reaction') {
      spawnEmote(m.emote);
    } else if (m.t === 'error') {
      const bar = document.getElementById('online-error');
      if (bar) {
        bar.textContent = m.message;
        setTimeout(() => { if (bar) bar.textContent = ''; }, 4000);
      }
    }
  };
  net.onStatus = () => {
    if (state.screen === 'online' && net.snapshot?.phase !== 'battle') renderPhase();
  };
  renderPhase();
}

function spawnEmote(emote: string) {
  const div = document.createElement('div');
  div.className = 'emote-float';
  div.textContent = emote;
  div.style.left = `${15 + Math.random() * 70}%`;
  div.style.bottom = '30%';
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 1700);
}

function shell(inner: string, sub = ''): HTMLElement {
  const snap = net.snapshot;
  return el(`
  <div>
    ${topbar(`Online Room ${snap ? `· ${esc(snap.roomId)} · ${esc(snap.phase)}` : ''} ${sub}`)}
    <div class="screen wide">
      <div class="row between mb">
        <span class="conn-pill ${net.status === 'open' ? 'ok' : 'bad'}">${net.status === 'open' ? 'connected' : net.status}</span>
        <span class="small" id="online-error" style="color:var(--danger)"></span>
        <button class="small" id="btn-leave">Leave</button>
      </div>
      ${inner}
    </div>
  </div>`);
}

function wireShell(node: HTMLElement) {
  q(node, '#btn-leave').addEventListener('click', () => {
    net.send({ t: 'leave_room' });
    net.close();
    resetLocal();
    go('home');
  });
  mount(node);
}

function renderPhase() {
  if (battleMount && net.snapshot?.phase !== 'battle') {
    if (net.snapshot?.phase === 'finished') {
      // Let the battle mount play its outro and deliver the breakdown + hash
      // verdict via onFinished (which re-renders this phase). Disposing here
      // would race away the causal breakdown.
      return;
    }
    battleMount.dispose();
    battleMount = null;
  }
  const snap = net.snapshot;
  if (!snap || net.status === 'idle') {
    renderConnect();
    return;
  }
  switch (snap.phase) {
    case 'lobby': renderLobby(snap); break;
    case 'draft': renderOnlineDraft(snap); break;
    case 'prep': renderOnlinePrep(snap); break;
    case 'wildcard': renderOnlineWildcard(snap); break;
    case 'battle': break; // battle mounts separately
    case 'finished': renderFinished(snap); break;
  }
}

// ---------------------------------------------------------------------------

function renderConnect() {
  const node = el(`
  <div>
    ${topbar('Online Room — LAN / self-hosted alpha')}
    <div class="screen">
      <div class="panel mb">
        <h3>Connect to an arena server</h3>
        <p class="muted small mb">Run one with <code>npm run server</code> — free, local, server-authoritative. Public hosting is a pending Founder gate.</p>
        <div class="row wrap">
          <input type="text" id="srv" value="${esc(defaultServerUrl())}" style="min-width:280px"/>
          <span class="muted small">Playing as <b>${esc(state.players[0].name || 'Challenger')}</b></span>
        </div>
      </div>
      <div class="grid cols-2">
        <div class="panel">
          <h3>Create a room</h3>
          <label class="small"><input type="checkbox" id="exp" checked /> Experimental (typed custom fighters & wildcards)</label>
          <button class="primary mt" id="btn-create" style="width:100%">Create room</button>
        </div>
        <div class="panel">
          <h3>Join a room</h3>
          <div class="row">
            <input type="text" id="code" placeholder="Room code" maxlength="6" style="text-transform:uppercase;width:140px"/>
            <select id="join-as"><option value="player">As player</option><option value="spectator">As spectator</option></select>
          </div>
          <button class="mt" id="btn-join" style="width:100%">Join</button>
        </div>
      </div>
      <p class="small muted mt" id="conn-msg"></p>
      <button class="small mt" id="btn-back">Back to lobby</button>
    </div>
  </div>`);

  const connectThen = async (after: () => void) => {
    const url = q<HTMLInputElement>(node, '#srv').value.trim();
    const msg = q(node, '#conn-msg');
    msg.textContent = 'Connecting…';
    try {
      if (net.status !== 'open') await net.connect(url, state.players[0].name || 'Challenger');
      msg.textContent = '';
      after();
    } catch {
      msg.textContent = 'Could not reach the server. Is `npm run server` running on that address?';
    }
  };
  q(node, '#btn-create').addEventListener('click', () =>
    connectThen(() => {
      resetLocal();
      net.send({ t: 'create_room', experimental: q<HTMLInputElement>(node, '#exp').checked });
      track('room_created', { mode: 'online' });
    }),
  );
  q(node, '#btn-join').addEventListener('click', () =>
    connectThen(() => {
      resetLocal();
      const code = q<HTMLInputElement>(node, '#code').value.trim().toUpperCase();
      if (!code) return;
      net.send({ t: 'join_room', roomId: code, as: q<HTMLSelectElement>(node, '#join-as').value as 'player' | 'spectator' });
      track('guest_joined', { mode: 'online' });
    }),
  );
  q(node, '#btn-back').addEventListener('click', () => {
    net.close();
    go('home');
  });
  mount(node);
}

function renderLobby(snap: RoomSnapshot) {
  const players = snap.participants.filter((p) => p.seat);
  const spectators = snap.participants.filter((p) => p.role === 'spectator');
  const node = shell(`
    <div class="grid cols-2">
      <div class="panel">
        <h3>Room code — share it</h3>
        <div class="room-code">${esc(snap.roomId)}</div>
        <p class="small muted mt">Arena: <b>${esc(ARENA.name)}</b> · ${esc(snap.division)} division · cap ${money(RULESET_S0.salaryCap)}
        ${snap.experimental ? ' · <span class="badge-exp">EXPERIMENTAL</span> custom creation enabled' : ''}</p>
        ${net.amHost() ? `<button class="primary mt" id="btn-start" style="width:100%" ${players.length >= 2 ? '' : 'disabled'}>
          ${players.length >= 2 ? 'Start the Market Draft' : 'Waiting for a second player…'}</button>` : '<p class="muted small mt">Waiting for the host to start the draft…</p>'}
      </div>
      <div class="panel">
        <h3>In the room</h3>
        ${snap.participants.map((p) => `
          <div class="participant-row ${p.connected ? '' : 'offline'}">
            <span class="pdot"></span>
            <b>${esc(p.name)}</b>
            <span class="muted small">${p.role === 'host' ? '👑 host' : p.role}${p.seat ? ` · ${p.seat}` : ''}</span>
          </div>`).join('')}
        <p class="muted small mt">${spectators.length}/20 spectator slots used</p>
        <div class="emote-bar mt" id="lobby-emotes"></div>
      </div>
    </div>`);
  node.querySelector('#btn-start')?.addEventListener('click', () => net.send({ t: 'start_draft' }));
  const bar = q(node, '#lobby-emotes');
  for (const e of ['🔥', '😂', '👏', '⚡']) {
    const b = document.createElement('button');
    b.className = 'small';
    b.textContent = e;
    b.addEventListener('click', () => net.send({ t: 'reaction', emote: e }));
    bar.appendChild(b);
  }
  wireShell(node);
}

// ---------------------------------------------------------------------------

function renderOnlineDraft(snap: RoomSnapshot) {
  const draft = snap.draft!;
  const seat = net.mySeat();
  const myTurn = seat !== null && draft.onClock === seat;
  const taken = new Set([...draft.picks.p1.roster, ...draft.picks.p2.roster].map((r) => r.fighterId));
  const files: FighterFile[] = [...FIGHTERS, ...draft.customFighters];
  const nameOf = (s: 'p1' | 'p2') => snap.participants.find((p) => p.seat === s)?.name ?? s;

  const budget = (s: 'p1' | 'p2') => RULESET_S0.salaryCap - draft.picks[s].roster.reduce((a, r) => a + r.pricePaid, 0);
  const canAfford = (s: 'p1' | 'p2', id: string) => {
    const dna = DNA_BY_ID.get(id);
    if (!dna) return false;
    const need = Math.max(0, RULESET_S0.rosterMin - draft.picks[s].roster.length - 1);
    return dna.balance.draftPrice <= budget(s) - need * 8_000_000;
  };

  const node = shell(`
    <div class="turn-banner ${myTurn ? '' : 'enemy'}">
      ${draft.onClock ? `${esc(nameOf(draft.onClock))} is on the clock` : 'Draft complete'} ${myTurn ? '— your pick' : ''}
    </div>
    <div class="draft-layout">
      <div>
        <div class="market-grid">
          ${files.map((f) => {
            const id = f.dna.identity.fighterId;
            const isCustom = draft.customFighters.some((c) => c.dna.identity.fighterId === id);
            const cls = ['fighter-card', taken.has(id) ? 'taken' : '', seat && !taken.has(id) && !canAfford(seat, id) ? 'unaffordable' : ''].join(' ');
            return `
            <div class="${cls}" data-id="${esc(id)}" tabindex="0" style="--accent:${esc(f.dna.presentation.primaryColor)}">
              ${isCustom ? '<div style="margin-bottom:4px"><span class="badge-exp">EXPERIMENTAL</span></div>' : ''}
              <div class="portrait">${silhouette(f)}<div class="pedestal"></div></div>
              <div class="name">${esc(f.contract.identity.displayName)}</div>
              <div class="meta">
                <span class="role-badge" style="--accent:${ROLE_COLORS[f.dna.identity.role] ?? '#888'}">${esc(f.dna.identity.role)}</span>
                <span class="price">${money(f.dna.balance.draftPrice)}</span>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div>
        ${(['p1', 'p2'] as const).map((s) => `
          <div class="panel ${s === 'p2' ? 'mt' : ''}">
            <h3>${esc(nameOf(s))}</h3>
            <div class="row between small"><span>Cap left</span><span class="gold">${money(budget(s))}</span></div>
            <div class="pick-log mt">
              ${draft.picks[s].roster.map((r, i) => `<div>${i + 1}. <b>${esc(FILE_BY_ID.get(r.fighterId)?.contract.identity.displayName ?? r.fighterId)}</b> <span class="gold">${money(r.pricePaid)}</span></div>`).join('') || '<div class="muted">No picks yet</div>'}
              ${draft.picks[s].passed ? '<div class="muted">Roster locked</div>' : ''}
            </div>
          </div>`).join('')}
        ${myTurn && draft.picks[seat!].roster.length >= RULESET_S0.rosterMin
          ? `<button class="mt" id="btn-pass" style="width:100%">Lock roster with ${draft.picks[seat!].roster.length} fighters</button>` : ''}
        <div id="nom-slot" class="mt"></div>
      </div>
    </div>`);

  qa(node, '.fighter-card').forEach((card) => {
    card.addEventListener('click', () => {
      if (!myTurn) return;
      const id = card.dataset.id!;
      if (taken.has(id)) return;
      net.send({ t: 'draft_pick', fighterId: id });
      track('draft_pick', { fighterId: id, online: true });
    });
  });
  node.querySelector('#btn-pass')?.addEventListener('click', () => net.send({ t: 'draft_pass' }));

  // Custom nomination (experimental rooms, seated players, one per player).
  if (snap.experimental && seat) {
    const slot = q(node, '#nom-slot');
    const nomState = draft.nominations[seat];
    if (pendingNomination) {
      const f = pendingNomination.fighter;
      slot.innerHTML = `
        <div class="compiler-panel">
          <h3 style="color:var(--purple)">${esc(f.contract.identity.displayName)} <span class="badge-exp">EXPERIMENTAL</span></h3>
          <p class="small">${esc(f.dna.identity.role)} · ${esc(f.dna.identity.chassis)} · <b class="gold">${money(f.dna.balance.draftPrice)}</b></p>
          ${pendingNomination.notes.map((n) => `<div class="compiler-note">${esc(n)}</div>`).join('')}
          ${pendingNomination.semanticLeft > 0 ? `<input type="text" id="nom-sem" placeholder="Semantic correction (${pendingNomination.semanticLeft} left)" class="mt"/><button class="small mt" id="nom-sem-btn">Apply</button>` : ''}
          ${pendingNomination.visualLeft > 0 ? `<input type="text" id="nom-vis" placeholder="Visual correction (${pendingNomination.visualLeft} left)" class="mt"/><button class="small mt" id="nom-vis-btn">Apply</button>` : ''}
          <div class="row mt">
            <button class="primary" id="nom-accept">Accept</button>
            <button class="danger" id="nom-reject">Discard</button>
          </div>
        </div>`;
      slot.querySelector('#nom-sem-btn')?.addEventListener('click', () => {
        const v = q<HTMLInputElement>(slot, '#nom-sem').value.trim();
        if (v) net.send({ t: 'custom_correction', kind: 'semantic', instruction: v });
      });
      slot.querySelector('#nom-vis-btn')?.addEventListener('click', () => {
        const v = q<HTMLInputElement>(slot, '#nom-vis').value.trim();
        if (v) net.send({ t: 'custom_correction', kind: 'visual', instruction: v });
      });
      slot.querySelector('#nom-accept')?.addEventListener('click', () => {
        net.send({ t: 'custom_resolve', accept: true });
        pendingNomination = null;
      });
      slot.querySelector('#nom-reject')?.addEventListener('click', () => {
        net.send({ t: 'custom_resolve', accept: false });
        pendingNomination = null;
        renderPhase();
      });
    } else if (!nomState.used) {
      slot.innerHTML = `
        <div class="compiler-panel">
          <h3 style="color:var(--purple)">Live custom nomination <span class="badge-exp">EXPERIMENTAL</span></h3>
          <textarea id="nom-desc" rows="2" maxlength="400" placeholder="Describe a fighter…"></textarea>
          <button class="small mt" id="nom-go" style="width:100%">Compile</button>
        </div>`;
      q(slot, '#nom-go').addEventListener('click', () => {
        const v = q<HTMLTextAreaElement>(slot, '#nom-desc').value.trim();
        if (v.length >= 8) {
          net.send({ t: 'nominate_custom', description: v });
          track('custom_nomination', { online: true });
        }
      });
    }
  }
  wireShell(node);
}

// ---------------------------------------------------------------------------

function renderOnlinePrep(snap: RoomSnapshot) {
  const seat = net.mySeat();
  if (!seat) {
    wireShell(shell('<div class="panel"><h3>Players are preparing their teams…</h3><p class="muted small">Prep is private. The battle begins when both are ready.</p></div>'));
    return;
  }
  const roster = snap.draft!.picks[seat].roster.map((r) => r.fighterId);
  if (!myPrep) {
    myPrep = { activeFighterIds: roster.slice(0, 3), captainId: roster[0], formation: 'balanced', reinforcement: 'ally_ko' };
  }
  if (prepSubmitted) {
    wireShell(shell('<div class="panel"><h3>Prep locked ✓</h3><p class="muted small">Waiting for your opponent…</p></div>'));
    return;
  }
  const prep = myPrep;
  const team = {
    playerId: seat,
    displayName: 'me',
    roster: snap.draft!.picks[seat].roster,
    activeFighterIds: prep.activeFighterIds,
    reserveOrder: roster.filter((id) => !prep.activeFighterIds.includes(id)),
    captainId: prep.captainId,
    formation: prep.formation,
    reinforcementPlan: { trigger: prep.reinforcement, description: '' },
    wildcardId: null,
  };
  const readout = computeTeamReadout(team, DNA_BY_ID, ARENA);
  const node = shell(`
    <div class="draft-layout">
      <div>
        <div class="panel mb">
          <h3>Starting three & captain</h3>
          <div class="grid cols-3">
            ${roster.map((id) => {
              const f = FILE_BY_ID.get(id)!;
              const active = prep.activeFighterIds.includes(id);
              return `
              <div class="fighter-card ${active ? 'selected' : ''}" data-id="${esc(id)}" style="--accent:${esc(f.dna.presentation.primaryColor)}">
                <div class="name">${prep.captainId === id ? '★ ' : ''}${esc(f.contract.identity.displayName)}</div>
                <div class="meta"><span>${esc(f.dna.identity.role)}</span><span>${active ? 'ACTIVE' : 'RESERVE'}</span></div>
                <button class="small mt" data-captain="${esc(id)}">Make captain</button>
              </div>`;
            }).join('')}
          </div>
        </div>
        <div class="panel mb">
          <h3>Formation</h3>
          <div class="grid cols-2">
            ${FORMATIONS.map((f) => `<div class="fighter-card ${prep.formation === f.id ? 'selected' : ''}" data-formation="${f.id}"><div class="name">${f.label}</div><div class="muted small">${f.desc}</div></div>`).join('')}
          </div>
        </div>
        <div class="panel">
          <h3>Reinforcement plan</h3>
          ${TRIGGERS.map((t) => `
            <label style="display:block;padding:6px 0;cursor:pointer">
              <input type="radio" name="trig" value="${t.id}" ${prep.reinforcement === t.id ? 'checked' : ''} ${roster.length === 3 && t.id !== 'ally_ko' ? 'disabled' : ''}/>
              <span class="small"> ${t.label}</span></label>`).join('')}
        </div>
      </div>
      <div>
        <div class="panel">
          <h3>Team Readout — your eyes only</h3>
          <div class="display gold" style="font-size:19px">${esc(readout.archetype)}</div>
          <p class="muted small mt">${esc(readout.tagline)}</p>
        </div>
        <button class="primary mt" id="btn-submit" style="width:100%">Lock preparation</button>
      </div>
    </div>`);
  qa(node, '[data-captain]').forEach((b) => b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    prep.captainId = (b as HTMLElement).dataset.captain!;
    renderPhase();
  }));
  qa(node, '.fighter-card[data-id]').forEach((card) => card.addEventListener('click', (ev) => {
    if ((ev.target as HTMLElement).dataset.captain) return;
    const id = card.dataset.id!;
    const set = new Set(prep.activeFighterIds);
    if (set.has(id)) { if (set.size > 1) set.delete(id); }
    else { if (set.size >= 3) set.delete(prep.activeFighterIds[0]); set.add(id); }
    prep.activeFighterIds = roster.filter((r) => set.has(r));
    renderPhase();
  }));
  qa(node, '[data-formation]').forEach((card) => card.addEventListener('click', () => {
    prep.formation = card.dataset.formation as FormationId;
    renderPhase();
  }));
  qa<HTMLInputElement>(node, 'input[name=trig]').forEach((r) => r.addEventListener('change', () => {
    prep.reinforcement = r.value as ReinforcementTrigger;
  }));
  q(node, '#btn-submit').addEventListener('click', () => {
    if (prep.activeFighterIds.length !== 3) { alert('Select exactly 3 starting fighters.'); return; }
    net.send({ t: 'submit_prep', prep });
    prepSubmitted = true;
    track('team_prepared', { online: true });
    renderPhase();
  });
  wireShell(node);
}

// ---------------------------------------------------------------------------

function renderOnlineWildcard(snap: RoomSnapshot) {
  const seat = net.mySeat();
  const wc = snap.wildcard!;
  if (!seat) {
    wireShell(shell('<div class="panel"><h3>Wildcard selection in progress…</h3><p class="muted small">Both picks stay secret until locked.</p></div>'));
    return;
  }
  if (wc.locked[seat]) {
    const revealed = wc.revealed;
    wireShell(shell(revealed
      ? `<div class="grid cols-2">${(['p1', 'p2'] as const).map((s) => {
          const w = revealed[s] ? WILDCARD_BY_ID.get(revealed[s]!) : null;
          return `<div class="panel wildcard-card"><h3>${esc(snap.participants.find((p) => p.seat === s)?.name ?? s)}</h3>
            ${w ? `<h4>${esc(w.normalizedName)}</h4><p class="small muted">${esc(w.counterplay[0] ?? '')}</p>` : '<p class="muted">No wildcard</p>'}</div>`;
        }).join('')}</div><p class="center muted mt">Battle starting…</p>`
      : '<div class="panel"><h3>Wildcard locked ✓</h3><p class="muted small">Waiting for your opponent to lock…</p></div>'));
    return;
  }
  const options = [...WILDCARDS, ...myCustomWildcards];
  const node = shell(`
    <div class="grid cols-4" id="wc-grid">
      ${options.map((w) => `
        <div class="wildcard-card ${myWildcardChoice === w.wildcardId ? 'selected' : ''}" data-id="${esc(w.wildcardId)}">
          <div class="wc-class">${esc(w.class)}${myCustomWildcards.includes(w) ? ' · <span class="badge-exp">EXP</span>' : ''}</div>
          <h4>${esc(w.normalizedName)}</h4>
          <div class="small muted">${esc(w.counterplay[0] ?? '')}</div>
        </div>`).join('')}
    </div>
    <div class="grid cols-2 mt">
      <div>
        ${snap.experimental && myCustomWildcards.length === 0 ? `
        <div class="compiler-panel">
          <h3 style="color:var(--purple)">Typed custom wildcard <span class="badge-exp">EXPERIMENTAL</span></h3>
          <textarea id="cwc-desc" rows="2" maxlength="240" placeholder="Describe a wildcard…"></textarea>
          <button class="small mt" id="cwc-go" style="width:100%">Compile</button>
        </div>` : ''}
      </div>
      <button class="primary" id="btn-lock" ${myWildcardChoice ? '' : 'disabled'}>Lock wildcard</button>
    </div>`);
  qa(node, '.wildcard-card').forEach((c) => c.addEventListener('click', () => {
    myWildcardChoice = c.dataset.id!;
    renderPhase();
  }));
  node.querySelector('#cwc-go')?.addEventListener('click', () => {
    const v = q<HTMLTextAreaElement>(node, '#cwc-desc').value.trim();
    if (v.length >= 6) net.send({ t: 'custom_wildcard', description: v });
  });
  q(node, '#btn-lock').addEventListener('click', () => {
    net.send({ t: 'lock_wildcard', wildcardId: myWildcardChoice });
    track('wildcard_locked', { online: true });
  });
  wireShell(node);
}

// ---------------------------------------------------------------------------

function startBattle() {
  const root = document.getElementById('app')!;
  track('match_started', { mode: 'online' });
  battleMount = mountOnlineBattle(root, net, (result) => {
    battleMount = null;
    battleResult = result;
    renderPhase();
  });
}

function renderFinished(snap: RoomSnapshot) {
  const r = battleResult;
  const outcome = r?.outcome ?? snap.outcome;
  if (!outcome) {
    wireShell(shell('<div class="panel"><h3>Match finished</h3></div>'));
    return;
  }
  const winner = snap.battle?.teams.find((t) => t.playerId === outcome.winnerPlayerId);
  const node = shell(`
    <div class="verdict">
      <div class="muted display">Victory by ${esc(outcome.reason)}</div>
      <h1>${esc(winner?.displayName ?? outcome.winnerPlayerId)}</h1>
      ${r && !r.hashMatched ? '<p class="small" style="color:var(--danger)">Local replay diverged from the server — showing the authoritative server result.</p>' : ''}
    </div>
    ${r?.breakdown ? `
    <div class="panel mb">
      <h3>Why the winner won</h3>
      <p>${esc(r.breakdown.summary)}</p>
      ${r.breakdown.factors.slice(0, 4).map((f) => `<div class="factor"><div class="icon">·</div><div><b>${esc(f.headline)}</b><div class="small muted">${esc(f.detail)}</div></div></div>`).join('')}
    </div>` : ''}
    <div class="row center wrap" style="justify-content:center">
      <button class="primary" id="btn-again">Back to home — run it back</button>
    </div>`);
  q(node, '#btn-again').addEventListener('click', () => {
    net.close();
    resetLocal();
    go('home');
  });
  wireShell(node);
}
