import { TYPES, STAGES, STYLES, SETTINGS, FORMATS, THEMES, LIGHTS, MUSIC, FILM_STYLES, AMENITIES, EDITABLE, missing } from './shared/model.js';
import { autoScenes } from './shared/story.js';
import { loadFonts, FACES } from './shared/film.js';
import { Reel } from './shared/reelfilm.js';
import { Film } from './shared/film.js';
import { beats, shotsNeeded, SHOTS } from './shared/reel.js';

// ---- small helpers -----------------------------------------------------------
function h(tag, props, ...kids) {
  const [name, ...cls] = tag.split('.');
  const el = document.createElement(name);
  if (cls.length) el.className = cls.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list') el[k] = v;
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat(Infinity).filter((x) => x != null && x !== false));
  return el;
}
const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');

async function api(url, opts = {}) {
  let r;
  try {
    r = await fetch('/api' + url, opts.body && !(opts.body instanceof Blob)
      ? { ...opts, body: JSON.stringify(opts.body), headers: { 'content-type': 'application/json' } } : opts);
  } catch { throw new Error('Plinth is not running. Start it again with npm start.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `Something went wrong (${r.status}).`), j);
  return j;
}
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 4500); }
const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message); } };
function ask(text, yes) {
  const d = $('#ask');
  $('p', d).textContent = text; $('[value=yes]', d).textContent = yes;
  d.returnValue = 'no'; d.showModal();
  return new Promise((r) => d.addEventListener('close', () => r(d.returnValue === 'yes'), { once: true }));
}
const mark = () => { const d = h('span'); d.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="#c9400f" d="M3 25h26v4H3zM7 19h18v4H7zM11 3h10v14H11z"/></svg>'; return d.firstChild; };
const size = (b) => (b > 1e6 ? (b / 1e6).toFixed(b > 1e7 ? 0 : 1) + ' MB' : Math.round(b / 1e3) + ' KB');
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

let status = { voices: [] }, P = null, film = null, stop = () => {};

// ---- projects ------------------------------------------------------------------
async function home() {
  document.title = 'Plinth';
  const list = await api('/projects');
  const create = guard(async () => { const p = await api('/projects', { method: 'POST', body: {} }); location.hash = p.id; });
  const problems = [!status.browser && 'Google Chrome, Edge, Brave or Chromium', !status.ffmpeg && 'ffmpeg'].filter(Boolean);
  app.replaceChildren(h('div.home', {},
    h('header', {}, h('div.logo', {}, mark(), 'Plinth'), list.length ? h('button.btn.solid', { onclick: create }, 'New project') : null),
    h('h1', {}, 'Show the building before it is built.'),
    h('p.lede', {}, 'Enter a project’s details and get a narrated film, views of the building and ready-to-post posters.'),
    problems.length ? h('div.warn', {}, `Films and photos need ${problems.join(' and ')}. Install what is missing, then restart Plinth.`) : null,
    h('div.grid', {},
      list.map((p) => {
        const pic = p.outputs.find((o) => o.kind === 'photo')?.thumb || p.outputs[0]?.thumb;
        const ph = h('div.pic');
        if (pic) ph.append(h('img', { src: `/files/${p.id}/out/${pic}`, alt: '', loading: 'lazy' }));
        else ph.innerHTML = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 56h52M14 56V20h16v36M36 56V8h14v48M18 26h8M18 34h8M18 42h8M40 16h6M40 24h6M40 32h6M40 40h6"/></svg>';
        const n = p.outputs.length;
        return h('a.card', { href: '#' + p.id }, ph, h('div.txt', {}, h('b', {}, p.name || 'Untitled project'), h('span', {}, [[p.locality, p.city].filter(Boolean).join(', '), n ? `${n} made` : 'Nothing made yet'].filter(Boolean).join(' · '))));
      }),
      h('button.card.new', { onclick: create }, h('i', {}, '+'), list.length ? 'New project' : 'Start your first project'))));
}

// ---- studio ---------------------------------------------------------------------
async function studio(id) {
  P = await api('/projects/' + id);
  // Projects from before reels existed.
  P.footage ||= {}; P.film = { style: 'reel', gold: '#FFD21F', viewNote: '', lookNote: '', ...P.film, reel: P.film.reel || {}, scenes: P.film.scenes || {} };
  let footOpen = false, tab = 'project', dirty = false, saving = null, saveT, redrawT, playing = false, time = 2.4, last = 0, raf = 0, alive = true, jobT, sceneNow = -1, jobs = [];

  const stateEl = h('span.state', {}, 'Saved'), nameEl = h('span.pname');
  const pane = h('div.pane'), strip = h('div.strip', { role: 'slider', tabIndex: 0, 'aria-label': 'Film position' }), head = h('u');
  const clockEl = h('time'), playBtn = h('button.play', { onclick: () => setPlay(!playing) }, 'Play');
  const canvas = h('canvas'), wait = h('div.wait', {}, 'Setting up the model'), view = h('div.view', {}, wait, canvas);
  const jobsEl = h('div.jobs'), wallEl = h('div');
  const seg = h('div.seg', { role: 'group', 'aria-label': 'Film shape' });
  const film_btn = h('button.btn.solid', { onclick: () => make('film') }, 'Make film');

  app.replaceChildren(h('div.studio', {},
    h('div.bar', {}, h('a.logo', { href: '#', 'aria-label': 'All projects' }, mark(), 'Plinth'), nameEl, stateEl, h('span.grow'),
      h('button.btn', { onclick: () => make('photos') }, 'Make photos'), h('button.btn', { onclick: () => make('posters') }, 'Make posters'), film_btn),
    h('div.side', {}, h('div.tabs', { role: 'tablist' }), pane),
    h('div.stage', {}, view,
      h('div.time', {}, strip, h('div.ctl', {}, playBtn, clockEl, h('span', {}, 'Preview is silent'), seg)),
      h('div.made', {}, h('h2', {}, 'Made so far'), jobsEl, wallEl))));

  // -- saving
  const fields = () => ({ ...Object.fromEntries(EDITABLE.map((k) => [k, P[k]])), photos: P.photos.map(({ id, caption, inFilm }) => ({ id, caption, inFilm })) });
  async function flush() {
    clearTimeout(saveT);
    if (saving) await saving;
    if (!dirty) return;
    dirty = false;
    saving = api('/projects/' + id, { method: 'PUT', body: fields() }).then((r) => { P.outputs = r.outputs; say('Saved'); }, (e) => { dirty = true; say('Not saved', true); throw e; }).finally(() => (saving = null));
    await saving;
  }
  function say(t, bad) { stateEl.textContent = t; stateEl.classList.toggle('bad', !!bad); }
  function touch() {
    dirty = true; say('Saving');
    clearTimeout(saveT); saveT = setTimeout(() => flush().catch((e) => toast(e.message)), 600);
    clearTimeout(redrawT); redrawT = setTimeout(() => refresh().catch((e) => toast(e.message)), 160);
    nameEl.textContent = P.name || 'Untitled project';
  }
  // Server-owned parts (photos, logo, track, outputs) after an upload or a render.
  function adopt(r) {
    const mine = new Map(P.photos.map((x) => [x.id, x]));
    P.photos = r.photos.map((x) => mine.get(x.id) || x);
    for (const k of ['logo', 'track', 'outputs']) P[k] = r[k];
    P.footage = r.footage || {};
    if (r.film.music === 'upload' && r.track && !P.trackSeen) P.film.music = 'upload';
    if (!P.photos.some((x) => x.id === P.posterPhoto)) P.posterPhoto = '';
  }

  // -- preview
  // The two styles draw differently, so switching style swaps the renderer.
  function makeFilm() {
    const Want = P.film.style === 'model' ? Film : Reel;
    if (film && film.constructor === Want) return;
    const world = film?.world;
    film = new Want(canvas, { quality: 'low', world });
  }
  async function refresh() {
    if (!film) return;
    makeFilm();
    await film.load(P);
    if (!alive) return;
    film.setPlan();
    time = Math.min(time, film.plan.total - 0.05);
    sceneNow = -2; fitCanvas(); drawStrip(); paint();
  }
  function dims() {
    const { w, h: hh } = FORMATS[P.film.format];
    const box = view.getBoundingClientRect(), aw = Math.max(120, box.width - 44), ah = Math.max(120, box.height - 44);
    const s = Math.min(aw / w, ah / hh, 1), d = Math.min(devicePixelRatio || 1, 1.5);
    return { css: [w * s, hh * s], px: [Math.round(w * Math.min(1, s * d)), Math.round(hh * Math.min(1, s * d))] };
  }
  function fitCanvas() { const { css } = dims(); canvas.style.width = css[0] + 'px'; canvas.style.height = css[1] + 'px'; }
  function paint() {
    if (!film?.plan) return;
    if (film.prep) film.prep(time).then(() => alive && !playing && film?.frameOf && film.plan?.reel && film.frameOf(film.sceneAt(time).cut, 0) && film.draw(time, ...dims().px));
    const i = film.plan.scenes.length ? film.draw(time, ...dims().px) : -1;
    if (i !== sceneNow) { sceneNow = i; [...strip.querySelectorAll('i')].forEach((el, k) => el.classList.toggle('on', k === i)); }
    head.style.left = `${(time / film.plan.total) * 100}%`;
    clockEl.textContent = `${clock(time)} / ${clock(film.plan.total)}`;
    strip.setAttribute('aria-valuemin', 0); strip.setAttribute('aria-valuemax', Math.round(film.plan.total)); strip.setAttribute('aria-valuenow', Math.round(time));
    strip.setAttribute('aria-valuetext', `${clock(time)}, ${film.plan.scenes[i]?.title || ''}`);
  }
  function drawStrip() {
    strip.replaceChildren(...film.plan.scenes.map((s) => h('i', { style: { flex: `${s.dur} 1 0` }, title: s.title }, s.title)), head);
    seg.replaceChildren(...Object.entries(FORMATS).map(([k, f]) => h('button', { 'aria-pressed': String(P.film.format === k), title: f.hint, onclick: () => { P.film.format = k; touch(); if (tab === 'film') renderTab(); } }, f.label)));
  }
  function setPlay(on) {
    playing = on; playBtn.textContent = on ? 'Pause' : 'Play';
    cancelAnimationFrame(raf);
    if (!on) return;
    if (time >= film.plan.total - 0.1) time = 0;
    last = performance.now();
    const tick = (now) => {
      if (!alive || !playing) return;
      time += Math.min(0.1, (now - last) / 1000); last = now;
      if (time >= film.plan.total) { time = film.plan.total - 0.01; paint(); setPlay(false); return; }
      paint(); raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  function seekTo(key) {
    const s = film?.plan?.scenes.find((x) => x.key === key);
    if (s) { time = s.start + s.dur * 0.72; setPlay(false); paint(); }
  }
  const scrub = (e) => { const b = strip.getBoundingClientRect(); time = Math.max(0, Math.min(0.999, (e.clientX - b.left) / b.width)) * film.plan.total; paint(); };
  strip.addEventListener('pointerdown', (e) => { if (!film?.plan) return; strip.setPointerCapture(e.pointerId); scrub(e); strip.onpointermove = scrub; });
  strip.addEventListener('pointerup', () => (strip.onpointermove = null));
  strip.addEventListener('keydown', (e) => {
    const d = { ArrowRight: 0.5, ArrowLeft: -0.5 }[e.key];
    if (d) { e.preventDefault(); time = Math.max(0, Math.min(film.plan.total - 0.05, time + d)); paint(); }
    if (e.key === ' ') { e.preventDefault(); setPlay(!playing); }
  });

  // -- form pieces. `o` is the object holding the value, `k` its key.
  const cell = (label, control, w = '', extra = '') => h(`label.cell${w ? '.w' + w : ''}${extra}`, {}, h('span', {}, label), control);
  const text = (label, k, w, ph = '', o = P, attrs = {}) => {
    const c = cell(label, h('input', { type: 'text', value: o[k] ?? '', placeholder: ph, oninput: (e) => { o[k] = e.target.value; c.classList.remove('bad'); touch(); }, ...attrs }), w);
    c.dataset.field = k;
    return c;
  };
  const select = (label, o, k, opts, w, after) => cell(label, h('select', { onchange: (e) => { o[k] = e.target.value; touch(); after?.(); } }, Object.entries(opts).map(([v, l]) => h('option', { value: v, selected: o[k] === v }, l))), w);
  const range = (label, o, k, min, max, w) => {
    const out = h('output', {}, String(o[k]));
    return cell(label, h('div.rng', {}, h('input', { type: 'range', min, max, value: o[k], oninput: (e) => { o[k] = +e.target.value; out.textContent = o[k]; touch(); } }), out), w);
  };
  const color = (label, o, k, w) => { const t = h('span', {}, o[k]); return cell(label, h('div.col', {}, h('input', { type: 'color', value: o[k], oninput: (e) => { o[k] = e.target.value; t.textContent = o[k]; touch(); } }), t), w); };
  const check = (label, o, k, w) => h(`label.cell.check${w ? '.w' + w : ''}`, {}, h('input', { type: 'checkbox', checked: !!o[k], onchange: (e) => { o[k] = e.target.checked; touch(); } }), label);
  const pick = (o, k, opts, n, render = (l) => l, after) => {
    const box = h(`div.pick.n${n}`, { role: 'group' });
    const fill = () => box.replaceChildren(...Object.entries(opts).map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(o[k] === v), onclick: () => { o[k] = v; touch(); fill(); after?.(); } }, render(l, v))));
    fill();
    return box;
  };
  const block = (...c) => h('div.block', {}, c);
  const rows = (list, cols, add, cls) => {
    const box = h('div.rows');
    const fill = (focus) => {
      box.replaceChildren(...list.map((r, i) => h(`div.row.${cls}`, {}, cols.map(([k, ph]) => h('input', { type: 'text', value: r[k] || '', placeholder: ph, 'aria-label': ph, oninput: (e) => { r[k] = e.target.value; touch(); } })),
        h('button.x', { type: 'button', 'aria-label': 'Remove row', onclick: () => { list.splice(i, 1); touch(); fill(); } }, '×'))),
      h('button.add', { type: 'button', onclick: () => { list.push({}); fill(true); } }, '+ ' + add));
      if (focus) $(`.row:nth-last-child(2) input`, box)?.focus();
    };
    fill();
    return box;
  };
  const files = (accept, multiple, onpick) => { const i = h('input', { type: 'file', accept, multiple, style: { display: 'none' }, onchange: () => { onpick([...i.files]); i.value = ''; } }); return i; };
  async function upload(kind, list) {
    let failed = 0;
    for (const f of list) {
      say(`Adding ${f.name}`);
      try { adopt(await api(`/projects/${id}/${kind}?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f })); } catch (e) { failed++; toast(e.message); }
    }
    say(failed ? `${failed} not added` : 'Saved', failed);
    await refresh(); renderTab();
  }

  const panes = {
    project: () => [
      h('h2', {}, 'The project'),
      block(text('Project name', 'name', 6, 'What buyers will call it'), text('Developer', 'developer', 3, 'Company name'), select('Type', P, 'type', TYPES, 3, () => { if (P.type === 'villas') { P.building.floors = Math.min(4, P.building.floors); P.building.towers = Math.max(6, P.building.towers); } else { P.building.towers = Math.min(6, P.building.towers); if (P.building.floors < 5) P.building.floors = 14; } }),
        text('One line about it', 'tagline', 6, 'Optional'), select('Stage', P, 'stage', STAGES, 3), text('Possession', 'possession', 3, 'e.g. December 2029'),
        text('Land', 'land', 3, 'e.g. 4 acres'), text('Number of homes', 'units', 3, 'e.g. 240'), text('RERA number', 'rera', 6, 'As registered')),
      P.rera ? null : h('p.note', {}, 'In India, RERA rules generally require the registration number in a project’s ads, and bar advertising before it is registered.'),
      h('h2', {}, 'Location'),
      block(text('Locality', 'locality', 3, 'e.g. Baner'), text('City', 'city', 3, 'e.g. Pune'), text('Site address', 'address', 6, 'Optional')),
      h('h2', {}, 'What is nearby'),
      rows(P.connectivity, [['place', 'Place'], ['time', 'Time or distance']], 'Add a place', 'c2'),
      h('h2', {}, 'Contact'),
      block(text('Phone', 'phone', 3), text('Website', 'website', 3), text('Email', 'email', 6)),
      h('h2', {}, 'Brand'),
      block(color('Brand colour', P, 'brand', 2), h('div.cell.w4', {}, h('span', {}, 'Logo'), logoRow())),
    ],
    homes: () => [
      h('h2', {}, P.type === 'commercial' ? 'Spaces' : 'Homes'),
      rows(P.configs, [['type', 'Type, e.g. 2 BHK'], ['size', 'Size, e.g. 780 sq ft'], ['price', 'Price']], 'Add a type', 'c3'),
      h('p.note', {}, 'The film shows the first four.'),
      h('h2', {}, 'Price'),
      block(text('Starting from', 'priceFrom', 3, 'e.g. ₹1.18 Cr*'), text('Offer', 'offer', 3, 'Optional')),
      h('h2', {}, 'Amenities'), amenityChips(),
      h('p.note', {}, 'The film shows the first six you pick, in the order you pick them.'),
    ],
    building: () => {
      const v = P.type === 'villas', b = P.building;
      return [
        h('h2', {}, 'Shape'),
        block(range(v ? 'Villas shown' : P.type === 'commercial' ? 'Blocks' : 'Towers', b, 'towers', 1, v ? 12 : 6, 3), range('Floors', b, 'floors', 1, v ? 4 : 60, 3),
          ...(v ? [] : [check('Podium and garden deck', b, 'podium', 3), check('Swimming pool', b, 'pool', 3)])),
        h('h2', {}, 'Facade'), pick(b, 'style', STYLES, 4),
        h('div', { style: { height: '10px' } }), block(color('Walls', b, 'wall', 3), color('Trim', b, 'trim', 3)),
        h('h2', {}, 'Surroundings'), pick(b, 'setting', SETTINGS, 4),
        h('p.note', {}, 'The model is an impression built from these settings, not your architect’s drawing. Every view of it is marked as an artist’s impression. If you have real renders, add them under Photos.'),
      ];
    },
    photos: () => {
      const input = files('image/*,.heic,.heif', true, (l) => upload('photos', l));
      const drop = h('button.drop', { type: 'button', onclick: () => input.click(),
        ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); }, ondragleave: () => drop.classList.remove('over'),
        ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); upload('photos', [...e.dataTransfer.files]); } },
      h('b', {}, 'Add photos or renders'), h('span', {}, 'Drop them here or choose files. JPG, PNG, WebP or HEIC.'));
      const move = (i, d) => { const [x] = P.photos.splice(i, 1); P.photos.splice(i + d, 0, x); touch(); renderTab(); };
      return [
        h('h2', {}, 'Your photos'), input, drop,
        h('div.shots', {}, P.photos.map((ph, i) => h('div.shot', {}, h('img', { src: `/files/${id}/media/${ph.file}`, alt: ph.caption || 'Project photo', loading: 'lazy' }),
          h('div', {}, h('input', { type: 'text', value: ph.caption, placeholder: 'Caption, shown and spoken', 'aria-label': 'Caption', oninput: (e) => { ph.caption = e.target.value; touch(); }, onfocus: () => seekTo('photo-' + ph.id) }),
            h('div.ops', {}, h('label', {}, h('input', { type: 'checkbox', checked: ph.inFilm, onchange: (e) => { ph.inFilm = e.target.checked; touch(); } }), 'In the film'),
              i > 0 ? h('button.link', { onclick: () => move(i, -1), 'aria-label': 'Move earlier' }, 'Earlier') : null,
              h('button.link', { onclick: guard(async () => { if (!(await ask('Remove this photo from the project?', 'Remove photo'))) return; await flush(); adopt(await api(`/projects/${id}/photos/${ph.id}`, { method: 'DELETE' })); await refresh(); renderTab(); }) }, 'Remove')))))),
        P.photos.length ? h('p.note', {}, 'The film uses up to eight, in this order.') : null,
        P.photos.length ? [h('h2', {}, 'Poster picture'), block(select('Launch posters show', P, 'posterPhoto', { '': 'The 3D model', ...Object.fromEntries(P.photos.map((x, i) => [x.id, x.caption || `Photo ${i + 1}`])) }, 6))] : null,
        h('h2', {}, 'Photos of the building'),
        h('p.note', { style: { margin: '0 0 12px' } }, 'No photos yet? Plinth can photograph the 3D model from six angles, by day, at golden hour and at dusk.'),
        h('button.btn', { onclick: () => make('photos') }, 'Make photos'),
        status.photoreal ? null : h('p.note', {}, 'To turn these into photoreal images, add an OpenAI key to the .env file. The README explains how.'),
      ];
    },
    film: () => {
      const voices = { none: 'No voice', ...Object.fromEntries(status.voices.map((v) => [v.id, v.label])) }, reel = P.film.style === 'reel';
      if (!(P.film.voice in voices)) P.film.voice = status.voices[0]?.id || 'none';
      const music = { ...MUSIC }; if (!P.track) delete music.upload;
      if (!(P.film.music in music)) P.film.music = 'warm';
      const track = files('audio/*', false, (l) => upload('track', l));
      return [
        h('h2', {}, 'Style'), pick(P.film, 'style', FILM_STYLES, 2, (l, v) => [l, h('small', {}, v === 'reel' ? 'Photographs, quick cuts, timed captions' : 'The model, rising floor by floor')], () => renderTab()),
        reel ? footagePart() : null,
        h('h2', {}, 'Shape'), pick(P.film, 'format', FORMATS, 3, (f) => [f.label, h('small', {}, f.hint)]),
        reel ? [h('h2', {}, 'Captions'), block(color('Highlight colour', P.film, 'gold', 6))] : null,
        reel ? null : h('h2', {}, 'Lettering'), reel ? null : pick(P.film, 'theme', THEMES, 3, (l, v) => h('span', { style: { fontFamily: FACES[v].family, fontWeight: FACES[v].weight, fontStretch: FACES[v].stretch, fontSize: v === 'bold' ? '21px' : '17px' } }, l)),
        reel ? null : h('h2', {}, 'Light'), reel ? null : pick(P.film, 'light', LIGHTS, 4),
        h('h2', {}, 'Sound'), block(select('Voice', P.film, 'voice', voices, 3), select('Music', P.film, 'music', music, 3)),
        track, h('button.link', { onclick: () => track.click() }, P.track ? 'Replace your track' : 'Use your own track'),
        P.film.voice === 'Lekha' ? h('p.note', {}, 'Lekha reads Hindi. The lines below are drafted in English, so rewrite what is spoken in Hindi.') : null,
        h('h2', {}, 'Script'),
        h('p.note', { style: { margin: '0 0 12px' } }, reel ? 'Drafted from your details. The first box is what is spoken. The second is what appears: *gold*, ~handwritten~, (small). A | starts a new card.' : 'Drafted from your details. Change any line, or switch a scene off to shorten the film.'),
        reel ? reelScript() : script(),
      ];
    },
  };
  const TABS = { project: ['Project', 'open', 'intro'], homes: ['Homes', 'homes', 'home0'], building: ['Building', 'scale', 'intro'], photos: ['Photos', null], film: ['Film', null] };

  function logoRow() {
    const input = files('image/png,image/jpeg,image/webp', false, (l) => upload('logo', l));
    return h('div.col', {}, input, h('div.logo-row', {}, P.logo ? h('img', { src: `/files/${id}/media/${P.logo}`, alt: 'Logo' }) : null,
      h('button.link', { type: 'button', onclick: () => input.click() }, P.logo ? 'Replace' : 'Add a logo'),
      P.logo ? h('button.link', { type: 'button', onclick: guard(async () => { adopt(await api(`/projects/${id}/logo`, { method: 'DELETE' })); await refresh(); renderTab(); }) }, 'Remove') : null));
  }
  function amenityChips() {
    const box = h('div.chips'), own = h('input', { type: 'text', placeholder: 'Add your own and press Enter', 'aria-label': 'Add your own amenity' });
    const fill = () => box.replaceChildren(...[...AMENITIES, ...P.amenities.filter((a) => !AMENITIES.includes(a))].map((a) => h('button', { type: 'button', 'aria-pressed': String(P.amenities.includes(a)), onclick: () => { P.amenities = P.amenities.includes(a) ? P.amenities.filter((x) => x !== a) : [...P.amenities, a]; touch(); fill(); } }, a)));
    own.addEventListener('keydown', (e) => { if (e.key !== 'Enter') return; const v = own.value.trim(); if (v && !P.amenities.includes(v)) P.amenities = [...P.amenities, v]; own.value = ''; touch(); fill(); });
    fill();
    return [box, h('div.rows', { style: { marginTop: '10px' } }, h('div.row', {}, own))];
  }
  function script() {
    const box = h('div.script');
    const fill = () => box.replaceChildren(...autoScenes(P).map((s) => {
      const o = (P.film.scenes[s.key] ||= {}), on = o.on !== false, edited = (o.head != null && o.head !== '') || o.say != null;
      const say_ = h('textarea', { value: o.say ?? s.say, placeholder: 'Nothing spoken', rows: 2, 'aria-label': 'Spoken', oninput: (e) => { o.say = e.target.value; touch(); }, onfocus: () => seekTo(s.key) });
      return h(`div.beat${on ? '' : '.off'}`, {},
        h('div.top', {}, h('label', {}, h('input', { type: 'checkbox', checked: on, onchange: (e) => { o.on = e.target.checked; touch(); fill(); } }), s.title),
          edited ? h('button.link', { onclick: () => { delete o.head; delete o.say; touch(); fill(); } }, 'Use the draft') : null),
        on ? h('div.f', {}, h('input', { type: 'text', value: o.head ?? '', placeholder: s.head || (s.stats ? 'Headline (optional)' : 'No headline'), 'aria-label': 'Headline', oninput: (e) => { o.head = e.target.value; touch(); }, onfocus: () => seekTo(s.key) }), say_) : null);
    }));
    fill();
    return box;
  }
  function footagePart() {
    const need = shotsNeeded(P), missing_ = need.filter((k) => !P.footage[k]), extra = Object.keys(P.footage).filter((k) => !need.includes(k));
    const tile = (k) => {
      const f = P.footage[k], input = files('image/*,video/*,.heic,.mov', false, (l) => upload('footage/' + k, l));
      return h('div.shot', {}, f ? h('img', { src: `/files/${id}/media/${f.thumb || f.file}`, alt: SHOTS[k]?.label || k, loading: 'lazy' }) : h('div.none', {}, 'Not made'),
        h('div', {}, h('div.ttl', {}, SHOTS[k]?.label || k, f && !f.made ? h('small', {}, f.clip ? 'Your clip' : 'Your picture') : null), h('div.ops', {}, input,
          status.footage ? h('button.link', { onclick: () => make('footage', { keys: [k], again: true }) }, f ? 'Make again' : 'Make') : null,
          h('button.link', { onclick: () => input.click() }, 'Use my own'),
          f ? h('button.link', { onclick: guard(async () => { if (!(await ask(`Remove the ${(SHOTS[k]?.label || k).toLowerCase()} picture?`, 'Remove'))) return; await flush(); adopt(await api(`/projects/${id}/footage/${k}`, { method: 'DELETE' })); await refresh(); renderTab(); }) }, 'Remove') : null)));
    };
    return [h('h2', {}, 'Footage'),
      block(text('What the homes look out on', 'viewNote', 6, 'e.g. mangroves and a creek', P.film), text('Interior style', 'lookNote', 6, 'e.g. light oak, white walls, grey stone', P.film)),
      h('p.note', { style: { margin: '10px 0 12px' } }, missing_.length ? `${missing_.length} of ${need.length} pictures still to make. Allow a minute or two for each; they are made on this Mac.` : 'Every picture this reel needs is ready.'),
      missing_.length && status.footage ? h('button.btn', { onclick: () => make('footage') }, 'Make footage') : null,
      status.footage ? null : h('p.note', {}, 'The photoreal model is not installed. Run npm run setup-ai, or add your own pictures and clips.'),
      h('details.foot', { open: footOpen, ontoggle: (e) => (footOpen = e.target.open) }, h('summary', {}, 'Shots'), h('div.shots', {}, [...need, ...extra].map(tile))),
      h('p.note', {}, 'Generated pictures are artist’s impressions and are labelled so in the reel. Check that they do not promise something the project will not have.')];
  }
  function reelScript() {
    const box = h('div.script');
    const fill = () => box.replaceChildren(...beats(P).map((b) => {
      const o = (P.film.reel[b.key] ||= {});
      return h(`div.beat${b.on ? '' : '.off'}`, {},
        h('div.top', {}, h('label', {}, h('input', { type: 'checkbox', checked: b.on, onchange: (e) => { o.on = e.target.checked; touch(); fill(); } }), b.title),
          o.say != null || o.cap != null ? h('button.link', { onclick: () => { delete o.say; delete o.cap; touch(); fill(); } }, 'Use the draft') : null),
        b.on ? h('div.f', {}, h('textarea', { value: b.say, rows: 2, 'aria-label': 'Spoken', placeholder: 'Nothing spoken', oninput: (e) => { o.say = e.target.value; touch(); }, onfocus: () => seekTo(b.key) }),
          b.key === 'end' ? null : h('textarea.cap', { value: b.cap, rows: 2, 'aria-label': 'On screen', placeholder: 'No caption', oninput: (e) => { o.cap = e.target.value; touch(); }, onfocus: () => seekTo(b.key) })) : null);
    }));
    fill();
    return box;
  }
  function renderTab() {
    const top = pane.scrollTop;
    $('.tabs').replaceChildren(...Object.entries(TABS).map(([k, [l]]) => h('button', { role: 'tab', 'aria-selected': String(tab === k), onclick: () => { tab = k; renderTab(); pane.scrollTop = 0; const go = TABS[k][P.film.style === 'reel' ? 2 : 1]; if (go) seekTo(go); } }, l)));
    pane.replaceChildren(...panes[tab]().flat(Infinity).filter(Boolean));
    pane.scrollTop = top;
    nameEl.textContent = P.name || 'Untitled project';
  }
  pane.addEventListener('focusin', (e) => {
    const f = e.target.closest('.cell')?.dataset.field;
    const key = P.film.style === 'reel' ? { locality: 'intro', city: 'intro', land: 'land', priceFrom: 'price', offer: 'offer', possession: 'poss', phone: 'end', website: 'end', rera: 'end', name: 'intro', developer: 'intro', tagline: 'hook' }[f] : { locality: 'place', city: 'place', land: 'scale', units: 'scale', priceFrom: 'price', offer: 'price', possession: 'price', phone: 'end', website: 'end', email: 'end', rera: 'end', name: 'open', developer: 'open', tagline: 'open' }[f];
    if (key && !playing) seekTo(key);
  });

  // -- making things
  const KIND = { film: 'Film', photos: 'Photos', posters: 'Posters', footage: 'Footage' };
  const make = guard(async (kind, extra = {}) => {
    const gaps = missing(P);
    if (gaps.length) {
      tab = 'project'; renderTab();
      gaps.forEach((g) => $(`[data-field=${g.field}]`, pane)?.classList.add('bad'));
      $(`[data-field=${gaps[0].field}] input`, pane)?.focus();
      throw new Error(`Add the ${gaps.map((g) => g.label).join(' and ')} first.`);
    }
    await flush();
    await api(`/projects/${id}/jobs`, { method: 'POST', body: { kind, format: P.film.format, ...extra } });
    setPlay(false);
    poll(true);
    $('.made').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  });
  const seen = new Set();
  async function poll(now) {
    clearTimeout(jobT);
    if (!alive) return;
    try {
      const next = await api('/jobs?project=' + id);
      const finished = next.filter((j) => j.status === 'done' && !seen.has(j.id));
      const fresh = jobs.length || now;
      finished.forEach((j) => seen.add(j.id));
      jobs = next;
      if (jobs.some((j) => j.status === 'running' && ['footage', 'film'].includes(j.kind)) || finished.some((j) => j.kind === 'footage')) {
        const n = Object.keys(P.footage).length, sig = JSON.stringify(P.footage); adopt(await api('/projects/' + id));
        if (sig !== JSON.stringify(P.footage)) { await refresh(); if (tab === 'film' && !pane.contains(document.activeElement)) renderTab(); }
      }
      if (finished.length && fresh) { adopt(await api('/projects/' + id)); drawWall(); toast(`${finished.map((j) => KIND[j.kind]).join(' and ')} ready`); }
      drawJobs();
    } catch { /* server restarting; try again */ }
    const busy = jobs.some((j) => ['queued', 'running'].includes(j.status));
    if (busy) jobT = setTimeout(poll, 900);
  }
  const hidden = new Set();
  function drawJobs() {
    jobsEl.replaceChildren(...jobs.filter((j) => ['queued', 'running', 'failed'].includes(j.status) && !hidden.has(j.id)).map((j) => h(`div.job${j.status === 'failed' ? '.bad' : ''}`, {},
      h('div', {}, h('b', {}, KIND[j.kind]), '  ', j.status === 'failed' ? `could not be made. ${j.error}` : `${j.step}${j.progress ? `, ${Math.round(j.progress * 100)}%` : ''}`),
      j.status === 'failed' ? h('button', { onclick: () => { hidden.add(j.id); drawJobs(); } }, 'Dismiss') : h('button', { onclick: guard(async () => { await api(`/jobs/${j.id}/cancel`, { method: 'POST' }); poll(); }) }, 'Cancel'),
      j.status === 'failed' ? null : h('progress', { max: 1, value: j.progress || 0 }))));
  }
  function look(o) {
    const src = `/files/${id}/out/${o.file}`;
    const d = h('dialog.look', { onclick: (e) => { if (e.target === d) d.close(); }, onclose: () => d.remove() }, o.kind === 'film' ? h('video', { src, controls: true, autoplay: true, playsInline: true }) : h('img', { src, alt: o.label }));
    document.body.append(d); d.showModal();
  }
  function drawWall() {
    const groups = [['film', 'Films'], ['poster', 'Posters'], ['photo', 'Photos']];
    if (!P.outputs.length) { wallEl.replaceChildren(h('p.sub', {}, 'Your films, photos and posters will collect here, ready to download.')); return; }
    wallEl.replaceChildren(...groups.flatMap(([k, title]) => {
      const list = P.outputs.filter((o) => o.kind === k);
      if (!list.length) return [];
      return [h('h3', {}, title), h('div.wall', {}, list.map((o) => {
        const src = `/files/${id}/out/${o.thumb || o.file}`;
        return h('div.piece', {},
          h('button.im', { onclick: () => look(o), 'aria-label': `Open ${o.label}`, style: { aspectRatio: `${o.w}/${o.h}` } }, o.thumb ? h('img', { src, alt: o.label, loading: 'lazy' }) : null, k === 'film' ? h('span.ply', {}, `Play, ${clock(o.seconds)}`) : null),
          h('div.cap', { style: { maxWidth: Math.max(200, (230 * o.w) / o.h) + 'px', flexWrap: 'wrap' } }, h('b', {}, o.label), h('a', { href: `/files/${id}/out/${o.file}?dl=1`, title: size(o.bytes) }, 'Download'),
            h('button', { onclick: guard(async () => { if (!(await ask(`Delete “${o.label}”? This cannot be undone.`, 'Delete'))) return; adopt(await api(`/projects/${id}/outputs/${o.id}`, { method: 'DELETE' })); drawWall(); }) }, 'Delete'),
            k === 'photo' ? h('button', { onclick: guard(async () => { await flush(); adopt(await api(`/projects/${id}/outputs/${o.id}/use`, { method: 'POST' })); await refresh(); renderTab(); toast('Added to the film'); }) }, 'Use in film') : null,
            k === 'photo' && status.photoreal && !o.photoreal ? h('button', { onclick: guard(async (e) => {
              if (!(await ask('This sends the image to OpenAI, which charges your account for it. Continue?', 'Send image'))) return;
              e.target.disabled = true; e.target.textContent = 'Working';
              try { await api(`/projects/${id}/outputs/${o.id}/photoreal`, { method: 'POST' }); adopt(await api('/projects/' + id)); } finally { drawWall(); }
            }) }, 'Make photoreal') : null));
      }))];
    }));
  }

  const onResize = () => { fitCanvas(); paint(); };
  const onLeave = (e) => { if (dirty) { e.preventDefault(); flush().catch(() => {}); } };
  addEventListener('resize', onResize); addEventListener('beforeunload', onLeave);
  stop = () => {
    alive = false; cancelAnimationFrame(raf); clearTimeout(jobT); clearTimeout(redrawT);
    removeEventListener('resize', onResize); removeEventListener('beforeunload', onLeave);
    film?.world.dispose(); film = null;
    return flush().catch(() => {});
  };

  renderTab(); drawWall(); poll();
  document.title = `${P.name || 'Untitled project'} · Plinth`;
  try {
    await loadFonts();
    if (!alive) return;
    makeFilm();
    await refresh();
    wait.remove();
  } catch (e) {
    console.error(e);
    wait.textContent = 'The preview needs WebGL, which this browser has turned off. You can still make films and photos.';
    canvas.remove();
  }
}

// ---- routing ---------------------------------------------------------------------
async function route() {
  await stop(); stop = () => {};
  const id = location.hash.slice(1);
  try { await (/^[a-f0-9]{12}$/.test(id) ? studio(id) : home()); }
  catch (e) { app.replaceChildren(h('div.home', {}, h('header', {}, h('a.logo', { href: '#' }, mark(), 'Plinth')), h('h1', {}, e.message), h('p.lede', {}, h('a', { href: '#', onclick: () => { if (!location.hash) route(); } }, 'See all projects')))); }
}
addEventListener('hashchange', route);
status = await api('/status').catch(() => status);
route();
