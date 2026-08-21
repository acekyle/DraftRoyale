/** Player settings (accessibility first — constitution §45) + crash capture. */
// Import direction: settings → state → telemetry → net; state.ts never imports
// settings.ts, so pulling track() in here creates no cycle.
import { track } from './state';

export interface Settings {
  reducedMotion: boolean;
  cameraShake: boolean;
  textScale: 1 | 1.15 | 1.3;
  colorSafeStatus: boolean;
}

const KEY = 'ia_settings';

export function loadSettings(): Settings {
  try {
    return { reducedMotion: false, cameraShake: true, textScale: 1, colorSafeStatus: false, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { reducedMotion: false, cameraShake: true, textScale: 1, colorSafeStatus: false };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* private mode */ }
  applySettings(s);
}

export function applySettings(s: Settings = loadSettings()) {
  const root = document.documentElement;
  root.style.fontSize = `${15 * s.textScale}px`;
  root.classList.toggle('reduced-motion', s.reducedMotion);
  root.classList.toggle('color-safe', s.colorSafeStatus);
}

// ---------------------------------------------------------------------------
// Crash capture (local ring buffer; ships to the control plane once deployed)
// ---------------------------------------------------------------------------

export function installCrashCapture() {
  const record = (kind: string, message: string, stack?: string) => {
    try {
      const buf = JSON.parse(localStorage.getItem('ia_crashes') ?? '[]');
      buf.push({ kind, message, stack: (stack ?? '').slice(0, 2000), at: new Date().toISOString(), url: location.hash });
      localStorage.setItem('ia_crashes', JSON.stringify(buf.slice(-25)));
    } catch { /* quota */ }
    try {
      // Ships with the telemetry pipeline so crash-free % is computable
      // server-side (LAUNCH_PLAN §2). Truncated: no stacks, no PII.
      track('client_crash', { kind, message: message.slice(0, 200) });
    } catch { /* crash capture must never amplify a crash */ }
  };
  window.addEventListener('error', (e) => record('error', String(e.message), e.error?.stack));
  window.addEventListener('unhandledrejection', (e) =>
    record('unhandledrejection', String(e.reason?.message ?? e.reason), e.reason?.stack),
  );
}
