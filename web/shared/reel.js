// The reel: short spoken beats, each with captions and the pictures that play under it.
// Caption markup: one line per line. *gold*, ~handwritten~, (small). "|" starts a new card.
import { FORMATS, STAGES } from './model.js';
import { spoken, joinTypes } from './story.js';
import { amenityShot, available, SHOTS } from './shots.js';

const t = (s) => String(s ?? '').trim();
const firstSentence = (s) => t(s).split(/(?<=[.!?])\s|\n|✨/)[0].replace(/[.!\s]+$/, '');
const cap = (s) => t(s).toUpperCase();
const nice = (s) => t(s).replace(/\s*onwards?\s*$/i, '').replace(/\s*all inclusive\s*/i, '').replace(/[.\s]+$/, '').trim();
// People paste names with emoji and stray marks; keep them out of speech and captions.
export const tidy = (s) => t(s).replace(/[\p{Extended_Pictographic}️]/gu, '').replace(/\s+/g, ' ').trim();
const isPrice = (s) => /\d/.test(s) && !/https?:/i.test(s);

export function autoReel(p) {
  const out = [], name = tidy(p.name) || 'Your project', dev = tidy(p.developer), loc = tidy(p.locality), city = tidy(p.city);
  const spot = [loc, city].filter(Boolean).join(', ');
  const homes = p.type === 'commercial' ? 'spaces' : 'homes';
  const hook = firstSentence(p.tagline);
  const add = (key, title, say, caps, shots) => out.push({ key, title, say, cap: caps, shots });

  if (hook && hook.length <= 60) add('hook', 'Hook', `${hook}.`, capLines(hook), ['ext_low', 'ext_close']);
  else add('hook', 'Hook', spot ? `A new address, in ${loc || city}.` : 'A new address.', `A NEW\n*ADDRESS*${spot ? `\nIN ${cap(loc || city)}` : ''}`, ['ext_low', 'ext_close']);

  add('intro', 'Introduction', `Introducing ${name}${dev && !name.toLowerCase().includes(dev.toLowerCase()) ? `, by ${dev}` : ''}${spot ? `, in ${spot}` : ''}.`,
    `~Introducing~\n*${cap(name)}*${spot ? `\n${cap(loc || city)}` : ''}`, ['ext_hero', 'ext_air']);

  const land = t(p.land).match(/^([\d.]+)\s*(.*)$/);
  if (land) {
    const unit = t(land[2]) || 'acres';
    add('land', 'Land', `Spread across ${land[1]} ${unit}${has(p, /garden|landscap/i) ? ', with landscaped gardens' : ''}.`, `SPREAD ACROSS\n*${land[1]} ${cap(unit)}*${has(p, /garden|landscap/i) ? '\n~of landscaped greens~' : ''}`, ['a_garden', 'ext_air']);
  }
  const conf = p.configs.filter((c) => t(c.type)).slice(0, 4);
  if (conf.length > 1) {
    const bhk = conf.map((c) => tidy(c.type).match(/^([\d.]+)\s*BHK/i)), names = bhk.every(Boolean) ? [...new Set(bhk.map((m) => `${m[1]} BHK`))] : conf.map((c) => tidy(c.type));
    const list = joinTypes(names);
    add('homes', 'Homes', `Discover ${list} ${homes}.`, `~Discover~\n*${cap(joinTypes(names, '&'))}*\n${cap(homes)}`, ['living', 'balcony', 'bedroom']);
  }
  const sets = [['living', 'balcony'], ['living2', 'dining'], ['kitchen', 'bedroom'], ['bedroom2', 'living2']];
  conf.forEach((c, i) => {
    const size = nice(tidy(c.size)), price = isPrice(t(c.price)) ? nice(tidy(c.price)) : '', onward = /onward/i.test(c.price || ''), all = /all inc/i.test(c.price || '');
    add('home' + i, tidy(c.type), [`${tidy(c.type)}${size ? `, ${size}` : ''}.`, price ? `${onward || i === 0 ? 'Starting at' : 'At'} ${price}${all ? ', all inclusive' : ''}.` : ''].filter(Boolean).join(' | '),
      [`${cap(c.type)}${size ? `\n*${cap(size)}*` : ''}`, price ? `${onward || i === 0 ? '~Starting at~\n' : ''}*${cap(price)}*${all ? '\n(all inclusive)' : ''}` : ''].filter(Boolean).join('\n|\n'), p.type === 'commercial' ? ['office', 'lobby'] : sets[i]);
  });
  const price = isPrice(t(p.priceFrom)) ? nice(tidy(p.priceFrom)) : '';
  if (price && !conf.some((c) => isPrice(t(c.price)))) add('price', 'Price', `Starting at ${price}.`, `~Starting at~\n*${cap(price)}*`, ['ext_close']);

  const am = p.amenities.slice(0, 6);
  if (am.length) {
    const withPic = [...am].sort((a, b) => !!amenityShot(b) - !!amenityShot(a)).slice(0, 5);
    add('life', 'Amenities', withPic.map((a, i) => `${i === 0 ? 'Enjoy the ' : i === withPic.length - 1 && i > 0 ? 'and the ' : ''}${lower(a)}${i === withPic.length - 1 ? '.' : ','}`).join(' | '),
      withPic.map((a, i) => (i === 0 ? `~Enjoy the~\n*${cap(a)}*` : `*${cap(a)}*`)).join('\n|\n'), withPic.map((a) => amenityShot(a) || 'lobby'));
  }
  const near = p.connectivity.filter((c) => t(c.place)).slice(0, 3);
  if (near.length) add('near', 'Nearby', `${near.map((c, i) => `${i ? '' : 'Close to '}${lower(tidy(c.place))}${t(c.time) ? `, ${tidy(c.time)}` : ''}`).join('. | ')}.`,
    near.map((c, i) => `${i ? '' : 'CLOSE TO\n'}*${cap(c.place)}*${t(c.time) ? `\n${cap(c.time)}` : ''}`).join('\n|\n'), ['ext_air', 'ext_hero', 'ext_low']);

  if (t(p.possession)) add('poss', 'Possession', `Possession by ${tidy(p.possession)}.`, `POSSESSION\n*BY ${cap(p.possession)}*`, ['ext_deck', 'ext_close']);
  else if (p.stage) add('poss', 'Stage', `${STAGES[p.stage]}.`, `*${cap(STAGES[p.stage])}*`, ['ext_deck', 'ext_close']);
  if (t(p.offer)) add('offer', 'Offer', `${tidy(p.offer)}.`, capLines(tidy(p.offer)), ['ext_deck']);
  add('end', 'Contact', `${name}. ${t(p.phone) ? 'Call now to book your site visit.' : 'Book your site visit today.'}`, '', ['ext_dusk']);
  return out;
}
const has = (p, re) => p.amenities.some((a) => re.test(a));
const lower = (s) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
// Breaks a sentence into up to three lines and highlights the weightiest one.
function capLines(s) {
  const w = cap(s).split(' '), n = Math.min(3, Math.ceil(w.length / 2)), lines = [];
  for (let i = 0; i < n; i++) lines.push(w.slice(Math.round((i * w.length) / n), Math.round(((i + 1) * w.length) / n)).join(' '));
  const best = lines.at(-1).length >= 6 ? lines.length - 1 : lines.reduce((b, l, i) => (l.length > lines[b].length ? i : b), 0);
  return lines.map((l, i) => (i === best ? `*${l}*` : l)).join('\n');
}

export function beats(p) {
  const ok = new Set(available(p));
  return autoReel(p).map((b) => {
    const o = p.film.reel?.[b.key] || {};
    const shots = b.shots.filter((k) => ok.has(k) || p.footage?.[k]);
    return { ...b, on: o.on !== false, say: o.say ?? b.say, cap: o.cap ?? b.cap, shots: shots.length ? shots : ['ext_hero'], auto: b };
  });
}
export const shotsNeeded = (p) => [...new Set(beats(p).filter((b) => b.on).flatMap((b) => b.shots))];
// Timing of the lines the person recorded, in the shape the plan takes.
export const ownTiming = (p) => (p.film.voice === 'own' ? Object.fromEntries(Object.entries(p.voiceover || {}).map(([k, v]) => [k, { dur: v.dur, parts: v.parts }])) : {});
export const sayParts = (say) => say.split('|').map((x) => spoken(x).replace(/\b(?!BHK|RERA|NRI|IT\b)[A-Z]{4,}\b/g, (m) => m[0] + m.slice(1).toLowerCase()).replace(/(\d),(?=\d)/g, '$1')).filter(Boolean);

function parseCard(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) =>
    /^\*.*\*$/.test(l) ? { text: l.slice(1, -1), kind: 'gold' } : /^~.*~$/.test(l) ? { text: l.slice(1, -1), kind: 'script' } : /^\(.*\)$/.test(l) ? { text: l, kind: 'small' } : { text: l, kind: 'plain' });
}

// timing: { key: { dur, parts: [end seconds of each spoken part] } } measured from the voice.
export function reelPlan(p, { format = p.film.format, timing = {} } = {}) {
  const { w, h } = FORMATS[format] || FORMATS['9:16'];
  const scenes = [];
  let at = 0, seq = 0;
  for (const b of beats(p)) {
    if (!b.on) continue;
    const parts = sayParts(b.say), own = p.film.voice === 'own';
    const voiced = own ? !!timing[b.key] : p.film.voice !== 'none' && parts.length;
    const est = parts.map((x) => Math.max(0.7, x.split(/\s+/).length / 2.55 + 0.2));
    const tm = timing[b.key];
    const voice = tm ? tm.dur : voiced ? est.reduce((a, x) => a + x, 0) : 0;
    const lead = scenes.length ? 0.12 : 0.35, tail = b.key === 'end' ? 2.2 : 0.22;
    const min = b.key === 'end' ? 4.6 : 1.9;
    const dur = Math.round(Math.max(min, lead + voice + tail) * 30) / 30;
    const cards = b.cap.split('|').map(parseCard).filter((c) => c.length);
    let ends = tm?.parts || est.map((_, i) => est.slice(0, i + 1).reduce((a, x) => a + x, 0));
    if (!voiced && !tm) ends = [];
    const cardAt = cards.map((_, i) => (i === 0 ? 0 : ends.length === cards.length ? lead + ends[i - 1] : (dur * i) / cards.length));
    const times = cards.map((lines, i) => ({ lines, start: i ? cardAt[i] - 0.05 : Math.min(0.1, lead), end: i + 1 < cards.length ? cardAt[i + 1] - 0.05 : dur, speak: Math.max(0.4, (i + 1 < cards.length ? cardAt[i + 1] : lead + voice || dur) - cardAt[i]) }));
    // One picture per card when there is one for each; otherwise change picture every couple of seconds.
    const n = b.shots.length === cards.length && cards.length > 1 ? cards.length : Math.max(1, Math.min(b.shots.length, Math.round(dur / 2.1)));
    const cuts = Array.from({ length: n }, (_, i) => ({ shot: b.shots[i % b.shots.length], start: n === cards.length && n > 1 ? Math.max(0, times[i].start) * (i ? 1 : 0) : (dur * i) / n, seq: seq++ }));
    cuts.forEach((c, i) => (c.dur = (cuts[i + 1]?.start ?? dur) - c.start));
    scenes.push({ key: b.key, title: b.title, start: at, dur, lead, cards: times, cuts, say: b.say });
    at += dur;
  }
  return { w, h, fps: 30, scenes, total: at, reel: true };
}
export { SHOTS };
