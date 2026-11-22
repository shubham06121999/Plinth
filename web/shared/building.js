// A parametric building: project settings in, three.js group out. Units are metres.
// Every floor is made of instances, so the same model can be "built" floor by floor on camera.
import * as THREE from 'three';

export const FLOOR = 3.25;

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Shared by every material that glows after dark.
export const uniforms = { uLit: { value: 0 }, uTime: { value: 0 } };

function glassMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x8ea3ad, roughness: 0.06, metalness: 0.82, envMapIntensity: 1.3 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uLit = uniforms.uLit;
    s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>
      attribute float aRand; varying float vRand; varying vec2 vPane;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vRand = aRand; vPane = uv;`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
      uniform float uLit; varying float vRand; varying vec2 vPane;`)
      .replace('#include <color_fragment>', `
      // curtains: some panes have pale drapes to one or both sides
      float cw = fract(vRand * 7.31) * 0.34;
      float drape = fract(vRand * 3.7) > 0.45 ? step(vPane.x, cw) + step(1.0 - cw * fract(vRand * 11.0), vPane.x) : 0.0;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.6, 0.56), clamp(drape, 0.0, 1.0) * 0.55);`)
      .replace('#include <emissivemap_fragment>', `
      float on = smoothstep(0.02, 0.1, uLit - vRand * 1.5);
      vec3 warm = mix(vec3(1.0, 0.5, 0.18), vec3(1.0, 0.7, 0.4), fract(vRand * 5.0));
      float room = mix(0.35, 1.0, smoothstep(0.0, 1.0, vPane.y)) * (0.7 + 0.5 * exp(-18.0 * pow(length(vPane - vec2(0.5, 0.88)), 2.0)));
      room *= mix(1.0, 0.5, clamp(drape, 0.0, 1.0));
      totalEmissiveRadiance += warm * room * on * (0.75 + 0.7 * fract(vRand * 13.0));`);
  };
  return m;
}

// Foliage: noise in world space breaks the silhouette and gives light and dark leaves.
export const NOISE = `
  float nh(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
  float n3(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
    return mix(mix(mix(nh(i),nh(i+vec3(1,0,0)),f.x),mix(nh(i+vec3(0,1,0)),nh(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(nh(i+vec3(0,0,1)),nh(i+vec3(1,0,1)),f.x),mix(nh(i+vec3(0,1,1)),nh(i+vec3(1,1,1)),f.x),f.y),f.z); }`;
export function foliage() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, envMapIntensity: 0.6 });
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n varying vec3 vLW; varying float vTop;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vLW = (modelMatrix * instanceMatrix * vec4(position,1.0)).xyz; vTop = position.y;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\n varying vec3 vLW; varying float vTop;' + NOISE)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float near = smoothstep(140.0, 20.0, distance(vLW, cameraPosition));
        float n = n3(vLW * 2.2) * 0.6 + n3(vLW * 6.5) * 0.4;
        if (n < 0.36 * near && dot(normalize(vNormal), normalize(vViewPosition)) < 0.62) discard;
        diffuseColor.rgb *= mix(0.45, 1.35, n) * mix(0.62, 1.12, smoothstep(-0.45, 0.4, vTop));`);
  };
  return m;
}

const std = (color, roughness = 0.85, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });

// Collects instances and builds InstancedMeshes that can be hidden above a given floor.
class Batch {
  constructor() { this.sets = new Map(); this.M = new THREE.Matrix4(); this.Q = new THREE.Quaternion(); this.E = new THREE.Euler(); this.P = new THREE.Vector3(); this.S = new THREE.Vector3(); }
  add(name, x, y, z, sx, sy, sz, ry, floor, tower, extra = {}) {
    if (!this.sets.has(name)) this.sets.set(name, []);
    this.E.set(extra.rx || 0, ry, 0, 'YXZ');
    this.M.compose(this.P.set(x, y, z), this.Q.setFromEuler(this.E), this.S.set(sx, sy, sz));
    this.sets.get(name).push({ m: this.M.clone(), floor, tower, rand: extra.rand ?? 0, color: extra.color });
  }
  build(defs) {
    const g = new THREE.Group();
    this.meshes = [];
    for (const [name, list] of this.sets) {
      const { geo, mat, cast = true, receive = true } = defs[name];
      const geometry = geo.clone();
      const mesh = new THREE.InstancedMesh(geometry, mat, list.length);
      const base = new Float32Array(list.length * 16);
      list.forEach((it, i) => { it.m.toArray(base, i * 16); if (it.color) mesh.setColorAt(i, it.color); });
      mesh.instanceMatrix.array.set(base);
      geometry.setAttribute('aRand', new THREE.InstancedBufferAttribute(Float32Array.from(list, (i) => i.rand), 1));
      mesh.castShadow = cast; mesh.receiveShadow = receive; mesh.frustumCulled = false;
      g.add(mesh);
      this.meshes.push({ mesh, base, list });
    }
    return g;
  }
  // g: 0 (bare site) to 1 (complete). Towers top out one after another.
  grow(g, maxFloor, towers) {
    if (this.last === g) return;
    this.last = g;
    for (const { mesh, base, list } of this.meshes) {
      const a = mesh.instanceMatrix.array;
      for (let i = 0; i < list.length; i++) {
        const { floor, tower } = list[i];
        const lag = towers > 1 ? (tower / towers) * 0.16 : 0;
        const p = Math.min(1, Math.max(0, (g - lag) / (1 - 0.16)));
        let k = g >= 1 ? 1 : Math.min(1, Math.max(0, p * (maxFloor + 4) - floor) / 2.4);
        k = 1 - (1 - k) ** 3;
        const o = i * 16;
        if (k === 0) { a.fill(0, o, o + 16); continue; }
        for (let j = 0; j < 16; j++) a[o + j] = base[o + j];
        if (k < 1) a[o + 13] = base[o + 13] + (1 - k) * 5;
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

function frameGeometry() {
  // A 1x1 window surround with a mullion, 0.16 deep.
  const s = new THREE.Shape();
  s.moveTo(-0.5, -0.5); s.lineTo(0.5, -0.5); s.lineTo(0.5, 0.5); s.lineTo(-0.5, 0.5); s.closePath();
  const t = 0.028, hole = (x0, x1) => { const p = new THREE.Path(); p.moveTo(x0, -0.5 + t); p.lineTo(x0, 0.5 - t); p.lineTo(x1, 0.5 - t); p.lineTo(x1, -0.5 + t); p.closePath(); s.holes.push(p); };
  hole(-0.5 + t, -0.012); hole(0.012, 0.5 - t);
  return new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: false });
}

export function layout(p) {
  const b = p.building, villas = p.type === 'villas';
  const n = Math.max(1, Math.min(villas ? 12 : 6, +b.towers || 1));
  const floors = Math.max(1, Math.min(villas ? 4 : 60, +b.floors || 1));
  const towers = [];
  if (villas) {
    const cols = Math.min(4, Math.ceil(n / (n > 4 ? 2 : 1))), px = 19, pz = 24;
    const rows = Math.ceil(n / cols);
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols), c = i % cols, inRow = Math.min(cols, n - r * cols);
      towers.push({ x: (c - (inRow - 1) / 2) * px, z: -r * pz + ((rows - 1) * pz) / 2, w: 11, d: 12, rot: 0, floors });
    }
    const W = cols * px + 14, D = rows * pz + 18;
    return { villas, towers, floors, base: 0.3, siteW: W, siteD: D, H: floors * FLOOR + 3, podium: null };
  }
  const w = p.type === 'commercial' ? 30 : 27, d = p.type === 'commercial' ? 22 : 19;
  const spacing = w + 15;
  for (let i = 0; i < n; i++) {
    const u = i - (n - 1) / 2;
    // A shallow arc opening toward the garden in front.
    towers.push({ x: u * spacing, z: -13 + u * u * (n > 2 ? 3.2 : 0), w, d, rot: n > 1 ? -u * 0.09 : 0, floors: Math.max(1, floors - (n > 2 && i % 2 ? Math.round(floors * 0.06) : 0)) });
  }
  const podH = b.podium ? (floors > 8 ? 7.4 : 4.2) : 0;
  const podium = b.podium ? { w: n * spacing + 10, d: 62, h: podH, z: 2 } : null;
  return { villas, towers, floors, base: podH || 0.4, siteW: n * spacing + 46, siteD: 98, H: podH + floors * FLOOR + 5, podium };
}

export function makeBuilding(p) {
  const b = p.building, L = layout(p), R = rng(7 + L.towers.length * 31 + L.floors);
  const B = new Batch(), group = new THREE.Group();
  const wall = new THREE.Color(b.wall || '#EFEAE0'), trim = new THREE.Color(b.trim || '#5B4636');
  const pale = wall.clone().lerp(new THREE.Color('#ffffff'), 0.45);
  const box = new THREE.BoxGeometry(1, 1, 1), plane = new THREE.PlaneGeometry(1, 1);
  const leaf = new THREE.IcosahedronGeometry(0.5, 3);
  { // Lumpy, with round normals, so it shades as a soft canopy rather than as facets.
    const a = leaf.attributes.position, nn = leaf.attributes.normal, v = new THREE.Vector3();
    for (let i = 0; i < a.count; i++) {
      v.fromBufferAttribute(a, i).normalize();
      const k = 0.43 + 0.07 * Math.sin(v.x * 7 + 1) * Math.sin(v.y * 6 + 2) + 0.05 * Math.sin(v.z * 13 + v.x * 11) + 0.035 * Math.sin(v.y * 23 + v.z * 19);
      nn.setXYZ(i, v.x, v.y, v.z); a.setXYZ(i, v.x * k, v.y * k, v.z * k);
    }
  }
  const defs = {
    wall: { geo: box, mat: std(wall, 0.9) },
    slab: { geo: box, mat: std(pale, 0.8) },
    trim: { geo: box, mat: std(trim, 0.62) },
    metal: { geo: box, mat: std(0x2e3335, 0.4, { metalness: 0.6 }) },
    pane: { geo: plane, mat: glassMaterial(), cast: false },
    frame: { geo: frameGeometry(), mat: std(0x33383a, 0.45, { metalness: 0.5 }), cast: false },
    rail: { geo: box, mat: new THREE.MeshStandardMaterial({ color: 0xbfd3d6, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.3, depthWrite: false }), cast: false, receive: false },
    leaf: { geo: leaf, mat: foliage() },
    glow: { geo: box, mat: new THREE.MeshBasicMaterial({ color: 0xffc98a, toneMapped: true }), cast: false, receive: false },
  };
  const greens = ['#4d6b33', '#5d7c3c', '#6f8a45', '#3f5c30'].map((c) => new THREE.Color(c));

  L.towers.forEach((T, ti) => {
    const cos = Math.cos(T.rot), sin = Math.sin(T.rot);
    const at = (x, z) => [T.x + x * cos + z * sin, T.z - x * sin + z * cos];
    const put = (name, x, y, z, sx, sy, sz, ry, f, extra) => { const [X, Z] = at(x, z); B.add(name, X, y, Z, sx, sy, sz, ry + T.rot, f, ti, extra); };
    const style = p.type === 'commercial' && b.style === 'balcony' ? 'glass' : b.style;

    // Two overlapping blocks give the tower a stepped plan instead of a box.
    const parts = L.villas
      ? [{ x: 0, z: 0, w: T.w, d: T.d }, { x: -2.2, z: 1.4, w: T.w - 4.4, d: T.d }]
      : [{ x: 0, z: 0, w: T.w, d: T.d * 0.72 }, { x: 0, z: 0, w: T.w * 0.5, d: T.d }];
    const inside = (x, z, skip) => parts.some((q, i) => i !== skip && Math.abs(x - q.x) < q.w / 2 - 0.05 && Math.abs(z - q.z) < q.d / 2 - 0.05);
    const bay = 3.6, top = L.base + T.floors * FLOOR;
    const setback = style === 'classic' && T.floors > 10 ? T.floors - 3 : 1e9;

    for (let f = 0; f < T.floors; f++) {
      const y = L.base + f * FLOOR, upper = f >= setback;
      const ground = f === 0 && !L.villas;
      parts.forEach((q, qi) => {
        if (upper && qi === 1) return;
        const sh = upper ? 1.4 : 0, qw = q.w - sh * 2, qd = q.d - sh * 2;
        put('wall', q.x, y + FLOOR / 2, q.z, qw, FLOOR, qd, 0, f);
        const lip = style === 'glass' ? 0.5 : style === 'classic' ? (f % 4 === 0 ? 0.6 : 0.16) : 0.34;
        put(style === 'classic' && f % 4 === 0 ? 'slab' : 'slab', q.x, y + FLOOR - 0.14, q.z, qw + lip, style === 'glass' ? 0.22 : 0.3, qd + lip, 0, f);
        const sides = [
          { len: qw, off: qd / 2, ry: 0 }, { len: qw, off: qd / 2, ry: Math.PI },
          { len: qd, off: qw / 2, ry: Math.PI / 2 }, { len: qd, off: qw / 2, ry: -Math.PI / 2 },
        ];
        sides.forEach((s, si) => {
          const n = Math.max(1, Math.round(s.len / bay)), bw = s.len / n;
          const nx = Math.sin(s.ry), nz = Math.cos(s.ry), ux = Math.cos(s.ry), uz = -Math.sin(s.ry);
          for (let i = 0; i < n; i++) {
            const u = -s.len / 2 + (i + 0.5) * bw;
            const on = (out, du = 0) => [q.x + ux * (u + du) + nx * (s.off + out), q.z + uz * (u + du) + nz * (s.off + out)];
            const [tx, tz] = on(0.3);
            if (inside(tx, tz, qi)) continue;
            const rand = R();
            const front = si < 2;
            let wh = 1.75, sill = 0.85, ww = bw * 0.62, balcony = false;
            if (style === 'glass') { wh = FLOOR - 0.42; sill = 0.1; ww = bw * 0.97; }
            else if (style === 'classic') { wh = 1.95; sill = 0.7; ww = bw * 0.46; balcony = front && n > 3 && (i === 1 || i === n - 2) && f % 2 === 1; }
            else {
              balcony = front ? (qi === 1 || i % 3 !== 1 || n < 4) : (i === 0 || i === n - 1) && n > 2;
              if (balcony) { wh = 2.55; sill = 0.1; ww = bw * 0.9; }
            }
            if (ground) { wh = 2.75; sill = 0.05; ww = bw * 0.94; balcony = false; }
            const [px, pz] = on(0.03), cy = y + sill + wh / 2;
            put('pane', px, cy, pz, ww, wh, 1, s.ry, f, { rand });
            const [fx, fz] = on(0.0);
            put('frame', fx, cy, fz, ww + 0.06, wh + 0.06, 1, s.ry, f);

            if (style === 'glass') {
              const [mx, mz] = on(0.28, -bw / 2);
              put('trim', mx, y + FLOOR / 2, mz, 0.12, FLOOR, 0.5, s.ry, f);
            }
            if (style === 'classic' && !ground) {
              const [cx, cz] = on(0.1);
              put('slab', cx, y + sill - 0.1, cz, ww + 0.5, 0.14, 0.34, s.ry, f);
              if (f % 4 === 3) put('slab', cx, y + sill + wh + 0.14, cz, ww + 0.5, 0.2, 0.3, s.ry, f);
            }
            if (balcony && f > 0) {
              const depth = style === 'classic' ? 1.1 : 1.75 + (style === 'green' ? ((f + i) % 3) * 0.35 : 0);
              const full = bw * (style === 'classic' ? 0.86 : 1.0);
              const [bx, bz] = on(depth / 2);
              put('slab', bx, y - 0.06, bz, full, 0.22, depth, s.ry, f);
              const [gx, gz] = on(depth - 0.05);
              put('rail', gx, y + 0.58, gz, full, 1.0, 0.04, s.ry, f);
              put('metal', gx, y + 1.1, gz, full, 0.06, 0.07, s.ry, f);
              // Timber-toned side screens break the facade into vertical bands.
              if (style !== 'classic' && (i + qi) % 3 === 0) {
                const [sx, sz] = on(depth / 2, -bw / 2 + 0.08);
                put('trim', sx, y + FLOOR / 2 - 0.1, sz, 0.16, FLOOR, depth * 0.92, s.ry, f);
              }
              if (style === 'green') {
                const [hx, hz] = on(depth + 0.1);
                put('wall', hx, y + 0.2, hz, full, 0.5, 0.5, s.ry, f);
                for (let k = 0; k < 3; k++) {
                  const [lx, lz] = on(depth + 0.12, (k - 1) * full * 0.33 + (R() - 0.5) * 0.3), sc = 0.75 + R() * 0.75;
                  put('leaf', lx, y + 0.55 + sc * 0.2, lz, sc * 1.35, sc * 0.95, sc, R() * 6, f, { color: greens[Math.floor(R() * 4)] });
                }
              }
            } else if (style === 'balcony' && !ground && !balcony && i % 2 === 0) {
              const [sx, sz] = on(0.1, bw * 0.42);
              put('trim', sx, y + FLOOR / 2, sz, 0.5, FLOOR, 0.22, s.ry, f);
            }
          }
        });
      });
    }
    // Roof
    const F = T.floors;
    const q = parts[0], sh = setback < 1e9 ? 1.4 : 0;
    parts.forEach((r, i) => {
      if (i === 1 && sh) return;
      const rw = r.w - sh * 2 + 0.4, rd = r.d - sh * 2 + 0.4;
      for (const [x, z, sx, sz] of [[0, rd / 2, rw, 0.25], [0, -rd / 2, rw, 0.25], [rw / 2, 0, 0.25, rd], [-rw / 2, 0, 0.25, rd]]) {
        if (inside(r.x + x, r.z + z, i)) { if (Math.abs(x) + Math.abs(z) > 0 && i === 0) continue; }
        put('slab', r.x + x, top + 0.5, r.z + z, sx, 1.1, sz, 0, F);
      }
    });
    if (L.villas) {
      put('slab', 0, top + 0.35, 0, T.w + 2.4, 0.35, T.d + 2.4, 0, F);
      put('trim', 0, top + 0.12, 0, T.w + 1.9, 0.14, T.d + 1.9, 0, F);
      put('leaf', 4.4, 0.8, 9.5, 2, 1.6, 2, 1, 0, { color: greens[1] });
      put('leaf', -4.6, 0.7, 9.2, 1.7, 1.3, 1.7, 2, 0, { color: greens[2] });
      put('slab', 2.6, 0.16, 10.2, 3.2, 0.12, 8, 0, 0);
      put('trim', -3.4, 1.15, T.d / 2 + 1.55, 1.2, 2.3, 0.12, 0, 0);
      for (const s of [-1, 1]) put('wall', s * 9, 0.6, 1, 0.2, 1.3, 21, 0, 0);
      put('glow', 2.4, FLOOR - 0.5, T.d / 2 + 1.5, 1.6, 0.06, 0.06, 0, 0);
    } else {
      put('wall', 0, top + 2.1, 0, q.w * 0.36, 4.2, q.d * 0.6, 0, F + 1);
      put('slab', 0, top + 4.3, 0, q.w * 0.36 + 1, 0.3, q.d * 0.6 + 1, 0, F + 1);
      if (style !== 'classic') {
        // Crown pergola with a light line under it.
        for (const x of [-1, 1]) for (const z of [-1, 1]) put('trim', x * T.w * 0.2, top + 1.9, z * (T.d / 2 - 0.9), 0.35, 3.8, 0.35, 0, F + 1);
        for (let k = -4; k <= 4; k++) put('trim', (k * T.w * 0.44) / 9, top + 3.9, 0, 0.22, 0.35, T.d, 0, F + 1);
        for (const z of [-1, 1]) { put('trim', 0, top + 3.75, z * (T.d / 2 - 0.9), T.w * 0.46, 0.4, 0.3, 0, F + 1); put('glow', 0, top + 3.5, z * (T.d / 2 - 0.8), T.w * 0.44, 0.07, 0.07, 0, F + 1); }
      } else {
        put('trim', 0, top + 4.7, 0, q.w * 0.3, 0.6, q.d * 0.5, 0, F + 1);
      }
    }
  });

  // Podium, entrance and garden deck
  if (L.podium) {
    const P = L.podium, h = P.h;
    B.add('wall', 0, h / 2, P.z, P.w, h, P.d, 0, -2, 0);
    B.add('slab', 0, h - 0.3, P.z, P.w + 0.9, 0.5, P.d + 0.9, 0, -1, 0);
    const faces = [{ len: P.w, off: P.d / 2, ry: 0 }, { len: P.w, off: P.d / 2, ry: Math.PI }, { len: P.d, off: P.w / 2, ry: Math.PI / 2 }, { len: P.d, off: P.w / 2, ry: -Math.PI / 2 }];
    for (const s of faces) {
      const nx = Math.sin(s.ry), nz = Math.cos(s.ry), ux = Math.cos(s.ry), uz = -Math.sin(s.ry);
      const n = Math.round(s.len / 1.1), bw = s.len / n;
      for (let i = 0; i < n; i++) {
        const u = -s.len / 2 + (i + 0.5) * bw;
        if (s.ry === 0 && Math.abs(u) < 11) continue;
        B.add('trim', ux * u + nx * (s.off + 0.25), h * 0.56, P.z + uz * u + nz * (s.off + 0.25), 0.14, h * 0.72, 0.5, s.ry, -1, 0);
      }
      const m = Math.round(s.len / 4.2), mw = s.len / m;
      for (let i = 0; i < m; i++) {
        const u = -s.len / 2 + (i + 0.5) * mw;
        B.add('pane', ux * u + nx * (s.off + 0.03), h * 0.54, P.z + uz * u + nz * (s.off + 0.03), mw * 0.96, h * 0.7, 1, s.ry, -1, 0, { rand: R() * 0.6 });
      }
    }
    const fz = P.z + P.d / 2;
    B.add('pane', 0, h * 0.42, fz + 0.06, 21, h * 0.8, 1, 0, -1, 0, { rand: 0.05 });
    for (let i = -3; i <= 3; i++) B.add('metal', i * 3.2, h * 0.42, fz + 0.12, 0.14, h * 0.82, 0.14, 0, -1, 0);
    B.add('trim', 0, h * 0.62, fz + 3.4, 25, 0.5, 7.4, 0, 0, 0);
    B.add('glow', 0, h * 0.62 - 0.28, fz + 6.4, 23, 0.05, 0.14, 0, 0, 0);
    for (const x of [-11, 11]) B.add('wall', x, h * 0.3, fz + 6.2, 0.9, h * 0.6, 0.9, 0, -1, 0);
    // Glass edge to the deck
    B.add('rail', 0, h + 0.75, fz - 0.4, P.w - 1, 1.1, 0.05, 0, 0, 0);
    for (const x of [-1, 1]) B.add('rail', x * (P.w / 2 - 0.4), h + 0.75, P.z, 0.05, 1.1, P.d - 1, 0, 0, 0);
    for (let i = 0; i < Math.floor(P.w / 2.1); i++) {
      const x = -P.w / 2 + 1.4 + i * 2.1, sc = 0.9 + R() * 0.6;
      B.add('leaf', x, h + 0.55, fz - 1.6, sc * 1.8, sc * 1.1, sc * 1.2, R() * 6, 0, 0, { color: greens[Math.floor(R() * 4)] });
    }
  }
  const built = B.build(defs);
  group.add(built);
  const maxFloor = L.floors + 1;
  return { group, layout: L, setGrowth: (g) => B.grow(g, maxFloor, L.towers.length), glow: defs.glow.mat, leafGeo: leaf, defs };
}
