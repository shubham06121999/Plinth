import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { blankProject, EDITABLE } from '../web/shared/model.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true });

export const newId = () => crypto.randomBytes(6).toString('hex');
const okId = (id) => /^[a-f0-9]{12}$/.test(id);
export const dirOf = (id) => {
  if (!okId(id)) throw Object.assign(new Error('Project not found'), { status: 404 });
  return path.join(DATA, id);
};
const fileOf = (id) => path.join(dirOf(id), 'project.json');

export function get(id) {
  const f = fileOf(id);
  if (!fs.existsSync(f)) throw Object.assign(new Error('Project not found'), { status: 404 });
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

export function save(p) {
  p.updatedAt = new Date().toISOString();
  const f = fileOf(p.id);
  fs.writeFileSync(f + '.tmp', JSON.stringify(p, null, 2));
  fs.renameSync(f + '.tmp', f);
  return p;
}

export function create(fields = {}) {
  const p = { ...blankProject(), id: newId(), createdAt: new Date().toISOString() };
  fs.mkdirSync(path.join(dirOf(p.id), 'media'), { recursive: true });
  fs.mkdirSync(path.join(dirOf(p.id), 'out'), { recursive: true });
  return save(apply(p, fields));
}

// The browser only ever owns the fields in EDITABLE. Photos and outputs are the
// server's, so an autosave can never wipe a film that finished a second earlier.
export function apply(p, fields) {
  for (const k of EDITABLE) if (k in fields) p[k] = fields[k];
  if (Array.isArray(fields.photos)) {
    const byId = new Map(p.photos.map((x) => [x.id, x]));
    const next = [];
    for (const f of fields.photos) {
      const own = byId.get(f.id);
      if (!own) continue;
      own.caption = String(f.caption || '').slice(0, 120);
      own.inFilm = !!f.inFilm;
      next.push(own);
      byId.delete(f.id);
    }
    p.photos = [...next, ...byId.values()];
  }
  p.footage ||= {};
  return p;
}

export function update(id, fn) {
  const p = get(id);
  fn(p);
  return save(p);
}

export function list() {
  return fs.readdirSync(DATA).filter((d) => okId(d) && fs.existsSync(fileOf(d)))
    .map(get).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export const remove = (id) => { get(id); fs.rmSync(dirOf(id), { recursive: true }); };
