// Turns project details into the list of scenes a film is made of.
// Nothing here invents a claim: a scene exists only if its details were filled in.
import { STAGES, FORMATS } from './model.js';

const clean = (s) => String(s ?? '').trim();
const join = (a, and = 'and') =>
  a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} ${and} ${a[a.length - 1]}`;
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
// "2 BHK, 3 BHK and 4 BHK" reads better as "2, 3 and 4 BHK".
export const joinTypes = (a, and = 'and') => {
  const m = a.map((x) => x.match(/^([\d.]+)\s+(.+)$/));
  return a.length > 1 && m.every((x) => x && x[2] === m[0][2]) ? `${join(m.map((x) => x[1]), and)} ${m[0][2]}` : join(a, and);
};
const dot = (s) => (s && !/[.!?।]$/.test(s) ? s + '.' : s);
const lowerFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

export function placeName(p) {
  return [clean(p.locality), clean(p.city)].filter(Boolean).join(', ');
}

function sizeRange(configs) {
  const nums = configs.flatMap((c) => (clean(c.size).replace(/,/g, '').match(/\d+(\.\d+)?/g) || []).map(Number));
  const unit = clean(configs[0]?.size).replace(/[\d,.\s–-]+/g, ' ').trim();
  if (!nums.length) return '';
  const lo = Math.min(...nums), hi = Math.max(...nums), f = (n) => n.toLocaleString('en-IN');
  return `${lo === hi ? f(lo) : `${f(lo)} to ${f(hi)}`} ${unit || 'sq ft'}`;
}

export function autoScenes(p) {
  const b = p.building, place = placeName(p), out = [];
  const name = clean(p.name) || 'Your project';
  const stage = STAGES[p.stage] || '';

  out.push({
    key: 'open', title: 'Opening', shot: 'rise', light: 0, base: 5.2,
    kicker: clean(p.developer) ? `${clean(p.developer)} presents` : stage,
    head: name, sub: clean(p.tagline) || (place ? `Coming up at ${place}` : ''),
    say: dot(`Introducing ${name}${clean(p.developer) ? ` by ${clean(p.developer)}` : ''}${place ? `, coming up at ${place}` : ''}`)
      + (clean(p.tagline) ? ' ' + dot(clean(p.tagline)) : ''),
  });

  const near = p.connectivity.filter((c) => clean(c.place)).slice(0, 4);
  if (place || near.length) {
    const spoken = near.slice(0, 3).map((c) => (clean(c.time) ? `${clean(c.place)}, ${clean(c.time)}` : clean(c.place)));
    out.push({
      key: 'place', title: 'Location', shot: 'aerial', light: 0.35, base: 4.2,
      kicker: 'Location', head: clean(p.locality) || clean(p.city), sub: clean(p.locality) ? clean(p.city) : '',
      list: near.map((c) => [clean(c.place), clean(c.time)]),
      say: near.length ? dot(`Close to what matters. ${spoken.join('. ')}`) : dot(`Set in ${place}`),
    });
  }

  const isVilla = p.type === 'villas';
  const thing = isVilla ? 'villa' : p.type === 'commercial' ? 'block' : 'tower';
  const stats = [];
  if (!isVilla) stats.push([String(b.towers), b.towers === 1 ? thing : thing + 's']);
  stats.push([String(b.floors), b.floors === 1 ? 'floor' : 'floors']);
  if (clean(p.land)) {
    const m = clean(p.land).match(/^([\d.,]+)\s*(.*)$/);
    stats.push(m ? [m[1], m[2] || 'acres'] : [clean(p.land), 'land']);
  }
  if (clean(p.units)) stats.push([clean(p.units), p.type === 'commercial' ? 'units' : isVilla ? 'villas' : 'homes']);
  const landSay = clean(p.land) ? ` on ${clean(p.land)}` : '';
  out.push({
    key: 'scale', title: 'The project', shot: 'orbit', light: 0.8, base: 4.2,
    kicker: 'The project', head: stats.length > 2 ? '' : isVilla ? plural(b.floors, 'floor') : `${plural(b.towers, thing)}, ${plural(b.floors, 'floor')}`,
    stats: stats.length > 2 ? stats : null,
    say: isVilla
      ? dot(`${clean(p.units) ? `${clean(p.units)} villas` : 'Independent villas'} across ${plural(b.floors, 'floor')}${landSay}`)
      : dot(`${plural(b.towers, thing)}, rising ${plural(b.floors, 'floor')}${landSay}`),
  });

  const conf = p.configs.filter((c) => clean(c.type)).slice(0, 4);
  if (conf.length) {
    const r = sizeRange(conf);
    out.push({
      key: 'homes', title: p.type === 'commercial' ? 'Spaces' : 'Homes', shot: 'close', light: 1.0, base: 4.4,
      kicker: p.type === 'commercial' ? 'Spaces' : 'Homes', head: joinTypes(conf.map((c) => clean(c.type)), '&'),
      list: conf.map((c) => [clean(c.type), [clean(c.size), clean(c.price)].filter(Boolean).join('  ·  ')]),
      say: dot(`Choose from ${joinTypes(conf.map((c) => clean(c.type)))}${r ? `, ${r}` : ''}`),
    });
  }

  if (p.amenities.length) {
    const a = p.amenities.slice(0, 6);
    out.push({
      key: 'life', title: 'Amenities', shot: isVilla ? 'street' : 'deck', light: 1.15, base: 4.4,
      kicker: 'Amenities', head: p.amenities.length > 6 ? `${p.amenities.length} amenities` : 'Made for every day',
      chips: a,
      say: dot(`With ${join(a.slice(0, 4).map(lowerFirst))}`),
    });
  }

  for (const ph of p.photos.filter((x) => x.inFilm).slice(0, 8)) {
    out.push({
      key: 'photo-' + ph.id, title: 'Photo', photo: ph.id, light: 1.2, base: 3.2,
      kicker: '', head: clean(ph.caption), say: clean(ph.caption) ? dot(clean(ph.caption)) : '',
    });
  }

  if (clean(p.priceFrom) || clean(p.possession) || clean(p.offer)) {
    const price = clean(p.priceFrom);
    out.push({
      key: 'price', title: 'Price', shot: 'street', light: 1.5, base: 3.8,
      kicker: price ? 'Starting from' : stage,
      head: price || (clean(p.possession) ? `Possession ${clean(p.possession)}` : clean(p.offer)),
      sub: [price && clean(p.possession) ? `Possession ${clean(p.possession)}` : '', clean(p.offer)].filter(Boolean).join('  ·  '),
      say: [price ? `Starting from ${price}.` : '', clean(p.possession) ? `Possession by ${clean(p.possession)}.` : '', dot(clean(p.offer))].filter(Boolean).join(' '),
    });
  }

  out.push({
    key: 'end', title: 'Contact', shot: 'hero', light: 2, base: 5,
    kicker: stage, head: name, sub: place,
    say: clean(p.phone) ? 'Call now to book your site visit.' : clean(p.website) ? `Visit ${clean(p.website)} to know more.` : '',
  });
  return out;
}

const LIGHT = { day: 0.1, golden: 1, dusk: 2 };

// Scenes after the user's own edits. `durations` holds measured narration lengths.
export function plan(p, { format = p.film.format, durations = {} } = {}) {
  const { w, h } = FORMATS[format] || FORMATS['9:16'];
  const scenes = [];
  let t = 0;
  for (const s of autoScenes(p)) {
    const o = p.film.scenes?.[s.key] || {};
    if (o.on === false) continue;
    const scene = { ...s };
    if (o.head != null && o.head !== '') scene.head = o.head;
    if (o.say != null) scene.say = o.say;
    if (p.film.light !== 'arc') scene.light = LIGHT[p.film.light] ?? s.light;
    const voiced = p.film.voice === 'own' ? !!durations[s.key] : p.film.voice !== 'none' && clean(scene.say);
    const est = durations[s.key] ?? (voiced ? spoken(scene.say).split(/\s+/).length / 2.1 : 0);
    scene.dur = Math.round(Math.max(s.base, est ? est + 1.1 : 0) * 30) / 30;
    scene.start = t;
    t += scene.dur;
    scenes.push(scene);
  }
  return { w, h, fps: 30, scenes, total: t };
}

// Text as a voice should read it.
export function spoken(s) {
  return clean(s)
    .replace(/(?:₹|Rs\.?|INR)\s*([\d.,]+)\s*(crores?|cr|lakhs?|lacs?|l|k)?\b\.?/gi, (_, n, u = '') => {
      const k = u.toLowerCase();
      const word = /^c/.test(k) ? ' crore' : /^l/.test(k) ? ' lakh' : k === 'k' ? ' thousand' : '';
      return `${n.replace(/[.,]$/, '')}${word} rupees${/[.,]$/.test(n) || /\.$/.test(_) ? '.' : ''}`;
    })
    .replace(/\*/g, '')
    .replace(/\bsq\.?\s*ft\b/gi, 'square feet')
    .replace(/(\d)\s*m(?:trs?|tr|eters?)?\b\.?/gi, '$1 metres')
    .replace(/\bsq\.?\s*m\b\.?/gi, 'square metres')
    .replace(/\bBHK\b/gi, 'B H K')
    .replace(/(\d)\s*mins?\b\.?/gi, '$1 minutes')
    .replace(/(\d)\s*kms?\b\.?/gi, '$1 kilometres')
    .replace(/\b24\s*[x×\/]\s*7\b/gi, '24 7')
    .replace(/\bG\s*\+\s*(\d+)/gi, 'ground plus $1')
    .replace(/&/g, ' and ')
    .replace(/\s\+\s/g, ' plus ')
    .replace(/\s*[·|]\s*/g, ', ')
    .replace(/\s+/g, ' ');
}
