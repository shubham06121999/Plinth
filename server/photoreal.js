// Optional. Sends one generated view to OpenAI and asks for a photoreal version of the
// same building. Runs only when the user presses the button and a key is in .env.
import fs from 'node:fs';
import path from 'node:path';
import * as store from './store.js';
import { SETTINGS, STYLES } from '../web/shared/model.js';

export const enabled = () => !!process.env.OPENAI_API_KEY;

export async function make(projectId, outputId) {
  const p = store.get(projectId);
  const src = p.outputs.find((o) => o.id === outputId && o.kind === 'photo');
  if (!src) throw Object.assign(new Error('That image no longer exists'), { status: 404 });
  const b = p.building;
  const dir = path.join(store.dirOf(p.id), 'out');
  const form = new FormData();
  form.set('model', process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1');
  form.set('size', src.w > src.h ? '1536x1024' : '1024x1536');
  form.set('quality', 'high');
  form.set('prompt', `Turn this 3D model view into a photorealistic architectural visualisation. Keep the camera, the number of buildings, the number of floors, the massing, the time of day and the layout exactly as shown. ${STYLES[b.style]} facade, ${SETTINGS[b.setting]} surroundings. Real materials, natural vegetation, believable light. No text, no logos, no watermark.`);
  form.set('image', new Blob([fs.readFileSync(path.join(dir, src.file))], { type: 'image/jpeg' }), 'view.jpg');
  const r = await fetch(process.env.OPENAI_URL || 'https://api.openai.com/v1/images/edits', {
    method: 'POST', headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error('OpenAI said: ' + (j.error?.message || r.status)), { status: 502 });
  const b64 = j.data?.[0]?.b64_json;
  if (!b64) throw Object.assign(new Error('OpenAI sent no image back'), { status: 502 });
  const id = store.newId(), file = src.file.replace(/\.jpg$/, `-photoreal-${id.slice(0, 4)}.png`);
  const buf = Buffer.from(b64, 'base64');
  fs.writeFileSync(path.join(dir, file), buf);
  const rec = { id, kind: 'photo', label: src.label + ', photoreal', file, thumb: file, w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), bytes: buf.length, createdAt: new Date().toISOString(), photoreal: true };
  store.update(p.id, (x) => x.outputs.unshift(rec));
  return rec;
}
