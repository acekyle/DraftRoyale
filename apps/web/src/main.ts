import './styles.css';
import { applySettings, installCrashCapture } from './settings';
import { initTelemetry } from './telemetry';
import { bindRenderer, go, track, type Screen } from './state';
import { renderHome } from './screens/home';
import { renderReveal } from './screens/reveal';
import { renderDraft } from './screens/draft';
import { renderPrep } from './screens/prep';
import { renderWildcard } from './screens/wildcard';
import { renderBattle } from './battle/battle';
import { renderBreakdown } from './screens/breakdown';
import { renderOnline } from './screens/online';
import { renderBracket } from './screens/bracket';

const screens: Record<Screen, () => void> = {
  home: renderHome,
  reveal: renderReveal,
  draft: renderDraft,
  prep: renderPrep,
  wildcard: renderWildcard,
  battle: renderBattle,
  breakdown: renderBreakdown,
  online: renderOnline,
  bracket: renderBracket,
};

installCrashCapture();
applySettings();
initTelemetry();
bindRenderer((screen) => screens[screen]());
track('web_shell_loaded', {});
// Join links land straight in the online flow (constitution §11 Step 1).
go(location.hash.startsWith('#join=') ? 'online' : 'home');

// Dev/QA hook: cross-engine determinism measurement (ADR-0004/0007, risk R-5).
// Playwright runs a manifest through THIS browser's JS engine and compares the
// event hash against the Node/V8 result. Dev builds only.
if (import.meta.env.DEV) {
  import('@arena/combat-sim').then(({ runManifest }) => {
    import('./content').then(({ SIM_CONTENT }) => {
      (window as unknown as { __replayHash: (m: unknown) => string }).__replayHash = (manifest) =>
        runManifest(manifest as Parameters<typeof runManifest>[0], SIM_CONTENT).hash;
    });
  });
}
