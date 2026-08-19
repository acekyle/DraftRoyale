/** WebSocket client for the control plane — reconnects with its session token. */
import type { ClientMessage, RoomSnapshot, ServerMessage } from '@arena/contracts';

export type NetStatus = 'idle' | 'connecting' | 'open' | 'closed';

export class NetClient {
  guestId = '';
  snapshot: RoomSnapshot | null = null;
  status: NetStatus = 'idle';
  onSnapshot: (s: RoomSnapshot) => void = () => {};
  onMessage: (m: ServerMessage) => void = () => {};
  onStatus: (s: NetStatus) => void = () => {};

  private ws: WebSocket | null = null;
  private url = '';
  private name = '';
  private closedByUser = false;
  private reconnectTimer: number | null = null;

  private tokenKey() {
    return `ia_session_${this.url}`;
  }

  connect(url: string, name: string): Promise<void> {
    this.url = url;
    this.name = name;
    this.closedByUser = false;
    return this.open();
  }

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.setStatus('connecting');
      let settled = false;
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => {
        const token = localStorage.getItem(this.tokenKey()) ?? undefined;
        ws.send(JSON.stringify({ t: 'hello', name: this.name, sessionToken: token } satisfies ClientMessage));
      };
      ws.onmessage = (ev) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (msg.t === 'welcome') {
          this.guestId = msg.guestId;
          try {
            localStorage.setItem(this.tokenKey(), msg.sessionToken);
          } catch { /* private mode */ }
          this.setStatus('open');
          if (!settled) {
            settled = true;
            resolve();
          }
          return;
        }
        if (msg.t === 'room_state') {
          if (!this.snapshot || msg.state.rev >= this.snapshot.rev) {
            this.snapshot = msg.state;
            this.onSnapshot(msg.state);
          }
          return;
        }
        this.onMessage(msg);
      };
      ws.onclose = () => {
        this.setStatus('closed');
        if (!settled) {
          settled = true;
          reject(new Error('connection failed'));
        }
        if (!this.closedByUser) {
          this.reconnectTimer = window.setTimeout(() => {
            this.open().catch(() => { /* retry loop continues via onclose */ });
          }, 1500);
        }
      };
      ws.onerror = () => {
        // onclose follows; nothing else needed
      };
    });
  }

  send(msg: ClientMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  mySeat(): 'p1' | 'p2' | null {
    return this.snapshot?.participants.find((p) => p.guestId === this.guestId)?.seat ?? null;
  }
  amHost(): boolean {
    return this.snapshot?.hostGuestId === this.guestId;
  }
  isSpectator(): boolean {
    const me = this.snapshot?.participants.find((p) => p.guestId === this.guestId);
    return me?.role === 'spectator';
  }

  close() {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.snapshot = null;
    this.setStatus('idle');
  }

  private setStatus(s: NetStatus) {
    this.status = s;
    this.onStatus(s);
  }
}

export const net = new NetClient();

export function defaultServerUrl(): string {
  return `ws://${location.hostname || 'localhost'}:8790`;
}
