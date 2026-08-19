import './styles.css';
import { applySettings, installCrashCapture } from './settings';
import { bindRenderer, go, track, type Screen } from './state';
import { renderHome } from './screens/home';
import { renderReveal } from './screens/reveal';
import { renderDraft } from './screens/draft';
import { renderPrep } from './screens/prep';
import { renderWildcard } from './screens/wildcard';
import { renderBattle } from './battle/battle';
import { renderBreakdown } from './screens/breakdown';
import { renderOnline } from './screens/online';

const screens: Record<Screen, () => void> = {
  home: renderHome,
  reveal: renderReveal,
  draft: renderDraft,
  prep: renderPrep,
  wildcard: renderWildcard,
  battle: renderBattle,
  breakdown: renderBreakdown,
  online: renderOnline,
};

installCrashCapture();
applySettings();
bindRenderer((screen) => screens[screen]());
track('web_shell_loaded', {});
go('home');
