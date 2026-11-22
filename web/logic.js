// The script rules, for the server. It asks this page instead of keeping a second copy of them,
// so the preview and the finished film can never disagree.
import { plan, autoScenes, spoken } from './shared/story.js';
import { reelPlan, beats, sayParts, shotsNeeded, SHOTS } from './shared/reel.js';
import { cues } from './shared/cues.js';

window.logic = {
  needed: (p) => shotsNeeded(p),
  shots: (p, keys) => keys.filter((k) => SHOTS[k]).map((k) => ({ key: k, label: SHOTS[k].label, ref: !!SHOTS[k].ref, prompt: SHOTS[k].prompt(p) })),
  reelSpeech: (p) => beats(p).filter((b) => b.on).map((b) => ({ key: b.key, parts: sayParts(b.say) })).filter((b) => b.parts.length),
  reel: (p, format, timing) => { const x = reelPlan(p, { format, timing }); return { plan: x, cues: cues(x) }; },
  filmSpeech: (p, format) => plan(p, { format }).scenes.map((s) => ({ key: s.key, text: spoken(s.say || ''), parts: sayParts(s.say || '') })).filter((s) => s.text),
  film: (p, format, durations) => plan(p, { format, durations }),
  sceneKeys: (p) => autoScenes(p).map((s) => s.key),
  shotKeys: Object.keys(SHOTS),
};
