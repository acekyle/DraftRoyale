/** Tiny DOM helpers — no framework, keep the payload light. */

export function el(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export function q<T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string): T {
  const found = root.querySelector(sel);
  if (!found) throw new Error(`missing element ${sel}`);
  return found as T;
}

export function qa<T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string): T[] {
  return [...root.querySelectorAll(sel)] as T[];
}

export function mount(node: HTMLElement) {
  const app = document.getElementById('app')!;
  app.innerHTML = '';
  app.appendChild(node);
}

/** Full-screen interstitial for hotseat privacy handoffs. */
export function interstitial(title: string, sub: string): Promise<void> {
  return new Promise((resolve) => {
    const node = el(`
      <div class="interstitial">
        <h2>${esc(title)}</h2>
        <p class="muted">${esc(sub)}</p>
        <button class="primary">Ready</button>
      </div>`);
    q(node, 'button').addEventListener('click', () => {
      node.remove();
      resolve();
    });
    document.body.appendChild(node);
  });
}

export function topbar(phase: string): string {
  return `
    <div class="topbar">
      <div class="logo">INFINITE <em>ARENA</em></div>
      <div class="phase">${esc(phase)}</div>
    </div>`;
}
