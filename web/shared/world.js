// Everything around the building: sky, sun, ground, city, trees, camera moves.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { makeBuilding, rng, uniforms, foliage, NOISE } from './building.js';

const C = (h) => new THREE.Color(h);
// 0 morning, 1 golden hour, 2 dusk
const LIGHTS = [
  { elev: 44, az: 42, sun: C('#fff2df'), power: 3.3, top: C('#3d7cc0'), mid: C('#8fbfe4'), hor: C('#dfeaf0'), hemi: 0.42, lit: 0, exp: 0.96, cloud: C('#ffffff'), env: 0.62 },
  { elev: 13, az: 62, sun: C('#ffb268'), power: 3.6, top: C('#54759f'), mid: C('#b3b4bd'), hor: C('#ffd6a0'), hemi: 0.34, lit: 0.28, exp: 1.02, cloud: C('#ffdcb8'), env: 0.6 },
  { elev: -2, az: 72, sun: C('#8ea3da'), power: 0.55, top: C('#16254f'), mid: C('#55608f'), hor: C('#f29a63'), hemi: 0.3, lit: 1, exp: 1.45, cloud: C('#8d6f88'), env: 0.55 },
];
const mix = (a, b, k) => a + (b - a) * k;
function lightAt(t) {
  const x = Math.max(0, Math.min(2, t)), i = Math.min(1, Math.floor(x)), k = x - i, A = LIGHTS[i], Z = LIGHTS[i + 1], o = {};
  for (const key in A) o[key] = A[key].isColor ? A[key].clone().lerp(Z[key], k) : mix(A[key], Z[key], k);
  return o;
}

const SKY_FRAG = `
  varying vec3 vDir; uniform vec3 top, mid, hor, sunCol, cloudCol, sunDir; uniform float dusk;
  float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
  float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }
  float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<5;i++){ s+=a*vn(p); p=p*2.03+17.; a*=.5; } return s; }
  void main(){
    vec3 d = normalize(vDir); float y = max(d.y, 0.0);
    vec3 c = mix(hor, mid, smoothstep(0.0, 0.22, y)); c = mix(c, top, smoothstep(0.12, 0.75, y));
    float s = max(dot(d, sunDir), 0.0);
    c += sunCol * (pow(s, 6.0) * 0.16 + pow(s, 90.0) * 0.5) * (1.0 - 0.6*dusk);
    vec2 uv = d.xz / (y + 0.22);
    float cl = fbm(uv * 1.1 + 4.0); float wisps = fbm(uv * vec2(0.5, 2.6) + 9.0);
    float m = smoothstep(0.5, 0.82, cl * 0.6 + wisps * 0.45) * smoothstep(0.02, 0.2, y);
    c = mix(c, cloudCol * mix(0.92, 1.12, pow(s, 3.0)), m * 0.62);
    if (d.y < 0.0) c = mix(hor * 0.75, hor * 0.4, min(1.0, -d.y * 4.0));
    gl_FragColor = vec4(c, 1.0);
  }`;

export class World {
  constructor({ pixelRatio = 1, quality = 'high' } = {}) {
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(pixelRatio);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.NeutralToneMapping;
    this.quality = quality;
    this.canvas = r.domElement;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.5, 4200);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(quality === 'high' ? 4096 : 2048, quality === 'high' ? 4096 : 2048);
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.12;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x5c5a4c, 0.4);
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
      uniforms: { top: { value: C('#fff') }, mid: { value: C('#fff') }, hor: { value: C('#fff') }, sunCol: { value: C('#fff') }, cloudCol: { value: C('#fff') }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, dusk: { value: 0 } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: SKY_FRAG,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 40, 24), this.skyMat);
    this.sky.renderOrder = -10; this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    this.scene.fog = new THREE.Fog(0xffffff, 380, 3000);
    this.pmrem = new THREE.PMREMGenerator(r);
    this.envs = new Map();
    this.target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, this.target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (quality === 'high') {
      this.ao = new GTAOPass(this.scene, this.camera, 4, 4);
      this.ao.updateGtaoMaterial({ radius: 2.2, distanceExponent: 1.4, thickness: 1.5, scale: 1.1, samples: 12 });
      this.ao.blendIntensity = 0.85;
      this.composer.addPass(this.ao);
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.2, 0.5, 1);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.size = [0, 0];
  }

  build(p) {
    const key = JSON.stringify([p.type, p.building]);
    if (key === this.key) return false;
    this.key = key;
    if (this.model) {
      this.scene.remove(this.model.group, this.site);
      for (const g of [this.model.group, this.site]) g.traverse((o) => { o.geometry?.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); });
    }
    this.model = makeBuilding(p);
    this.L = this.model.layout;
    this.site = this.makeSite(p);
    this.scene.add(this.model.group, this.site);
    this.lightKey = null;
    const R = Math.max(this.L.siteW, this.L.siteD, this.L.H) * 0.78 + 25, cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -R; cam.right = cam.top = R; cam.near = 1; cam.far = R * 6;
    cam.updateProjectionMatrix();
    this.shadowR = R;
    return true;
  }

  makeSite(p) {
    const L = this.L, g = new THREE.Group(), R = rng(41), b = p.building;
    const add = (geo, mat, x, y, z, { cast = false, rx = 0, ry = 0 } = {}) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z); m.rotation.set(rx, ry, 0); m.receiveShadow = true; m.castShadow = cast; g.add(m); return m;
    };
    const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, ...o });
    const flat = (w, d, m, x, y, z) => add(new THREE.PlaneGeometry(w, d), m, x, y, z, { rx: -Math.PI / 2 });
    const setting = b.setting;
    const groundCol = { city: '#8b8c84', suburb: '#7c8459', hills: '#6f7d4b', water: '#86876f' }[setting];
    // Ground that varies: broad patches, finer grass, and paving joints where asked for.
    const textured = (c, kind) => {
      const m = mat(c);
      m.onBeforeCompile = (s) => {
        s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n varying vec3 vGW;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vGW = (modelMatrix * vec4(position,1.0)).xyz;');
        s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\n varying vec3 vGW;' + NOISE)
          .replace('#include <color_fragment>', kind === 'pave' ? `#include <color_fragment>
            vec2 q = vGW.xz / vec2(1.2, 0.6); q.x += 0.5 * mod(floor(q.y), 2.0); vec2 f = fract(q);
            float far = smoothstep(150.0, 30.0, distance(vGW, cameraPosition));
            float joint = 1.0 - smoothstep(0.0, 0.05, f.x) * smoothstep(0.0, 0.09, f.y);
            diffuseColor.rgb *= (0.9 + 0.2 * nh(vec3(floor(q), 1.0)) * far) * (1.0 - 0.28 * joint * far) * (0.92 + 0.16 * n3(vGW * 0.15));`
          : `#include <color_fragment>
            float broad = n3(vGW * 0.011) * 0.6 + n3(vGW * 0.04) * 0.4, fine = n3(vGW * 0.5) * 0.5 + n3(vGW * 3.0) * 0.5;
            diffuseColor.rgb *= mix(0.62, 1.3, broad) * mix(0.84, 1.16, fine);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.35, 0.22), ${kind === 'wild' ? '0.45 * smoothstep(0.55, 0.8, n3(vGW * 0.017 + 7.0))' : '0.0'});`);
      };
      return m;
    };
    add(new THREE.CircleGeometry(2600, 64), textured(groundCol, setting === 'city' ? 'plain' : 'wild'), 0, -0.12, 0, { rx: -Math.PI / 2 });

    const W = L.siteW, D = L.siteD, roadZ = D / 2 + 13;
    flat(W, D, textured('#6f8a44', 'lawn'), 0, 0, 0);
    const pave = textured('#b9b2a4', 'pave'), asphalt = mat('#3f4244', { roughness: 0.82 }), kerb = mat('#c9c6bd'), paint = mat('#e7e4da');
    flat(2400, 13, asphalt, 0, 0.02, roadZ);
    for (let x = -600; x < 600; x += 9) flat(4, 0.22, paint, x, 0.05, roadZ);
    for (const s of [-1, 1]) { flat(2400, 4, pave, 0, 0.06, roadZ + s * 8.8); add(new THREE.BoxGeometry(2400, 0.2, 0.3), kerb, 0, 0.08, roadZ + s * 6.7); }

    const trees = [], palms = [], cars = [];
    const clear = (x, z, m = 0) => Math.abs(x) > W / 2 + m || Math.abs(z) > D / 2 + m;

    if (L.villas) {
      flat(W - 6, 7, asphalt, 0, 0.03, D / 2 - 4);
      for (const t of L.towers) { flat(W - 6, 6, asphalt, 0, 0.025, t.z + 15.2); trees.push([t.x + 7.6, t.z + 10.2, 4.6 + R() * 1.6]); }
      for (let i = 0; i < W / 9; i++) trees.push([-W / 2 + 4 + i * 9, -D / 2 + 2 + R() * 2, 6 + R() * 2]);
    } else {
      // Drive, forecourt and garden in front of the podium
      const fz = L.podium ? L.podium.z + L.podium.d / 2 : 8;
      flat(26, D / 2 - fz + 5, pave, 0, 0.03, (fz + D / 2) / 2 + 2);
      flat(W - 8, 7, asphalt, 0, 0.035, fz + 8);
      for (const s of [-1, 1]) {
        flat(7, D - 8, asphalt, s * (W / 2 - 7), 0.034, 0);
        for (let i = 0; i < D / 11; i++) trees.push([s * (W / 2 - 1.8), -D / 2 + 5 + i * 11 + R(), 6.5 + R() * 2.5]);
      }
      for (let x = 17; x < W / 2 - 6; x += 7.5) for (const s of [-1, 1]) { trees.push([s * (x + R()), D / 2 - 3.2, 6 + R() * 2.5]); if (R() > 0.4) palms.push([s * (x + 2), fz + 3.2, 6 + R() * 2]); }
      // boundary wall and gate
      const wm = mat(b.wall), tm = mat(b.trim, { roughness: 0.6 });
      for (const s of [-1, 1]) {
        const len = W / 2 - 14;
        add(new THREE.BoxGeometry(len, 1.5, 0.35), wm, s * (14 + len / 2), 0.75, D / 2, { cast: true });
        add(new THREE.BoxGeometry(2, 5.2, 2), tm, s * 13.5, 2.6, D / 2, { cast: true });
      }
      add(new THREE.BoxGeometry(31, 0.8, 2.4), wm, 0, 5.5, D / 2, { cast: true });
      if (L.podium) {
        const h = L.podium.h + 0.17, dz = L.podium.z + L.podium.d / 2;
        flat(L.podium.w - 2, L.podium.d - 2, textured('#c9c0ae', 'pave'), 0, h, L.podium.z);
        // Deck garden in front of the towers
        const lawnM = textured('#6c8a44', 'lawn');
        const span = L.podium.w;
        for (const s of [-1, 1]) flat(span * 0.2, 15, lawnM, s * span * 0.36, h + 0.04, dz - 13);
        if (b.pool) {
          const pw = Math.min(30, span * 0.42);
          const wt = new THREE.MeshStandardMaterial({ color: '#2b93a8', roughness: 0.08, metalness: 0.2, emissive: '#0d5a6a', emissiveIntensity: 0.25 });
          wt.onBeforeCompile = (s) => {
            s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n varying vec3 vGW;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vGW = (modelMatrix * vec4(position,1.0)).xyz;');
            s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\n varying vec3 vGW;' + NOISE)
              .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n normal = normalize(normal + 0.22 * vec3(n3(vGW * 1.6) - 0.5, 0.0, n3(vGW * 1.6 + 9.0) - 0.5));')
              .replace('#include <color_fragment>', `#include <color_fragment>
                vec2 cq = vGW.xz + vec2(n3(vGW * 0.9), n3(vGW * 0.9 + 5.0)) * 1.6; float ca = abs(n3(vec3(cq * 0.8, 1.0)) - 0.5);
                diffuseColor.rgb += vec3(0.25, 0.35, 0.33) * smoothstep(0.06, 0.0, ca) * 0.6;`);
          };
          this.poolMat = wt;
          flat(pw + 2, 12, textured('#e0d8c8', 'pave'), 0, h + 0.05, dz - 11);
          flat(pw, 9, wt, 0, h + 0.1, dz - 11);
          for (let i = 0; i < 8; i++) { // loungers
            const x = -pw / 2 + 2 + (i * (pw - 4)) / 7;
            add(new THREE.BoxGeometry(0.75, 0.22, 1.9), mat('#f1ede4'), x, h + 0.4, dz - 18.2, { cast: true });
            add(new THREE.BoxGeometry(0.75, 0.12, 0.8), mat('#f1ede4'), x, h + 0.66, dz - 19, { cast: true, rx: 0.7 });
            if (i % 3 === 1) { add(new THREE.ConeGeometry(1.5, 0.6, 12), mat(p.brand || '#E8552D'), x + 1, h + 2.6, dz - 18.4, { cast: true }); add(new THREE.CylinderGeometry(0.04, 0.04, 2.4), tm, x + 1, h + 1.2, dz - 18.4); }
          }
        } else { this.poolMat = null; flat(span * 0.4, 13, lawnM, 0, h + 0.05, dz - 12); }
        for (let i = 0; i < span / 7; i++) { const x = -span / 2 + 4 + i * 7; if (Math.abs(x) > 17) palms.push([x + R() * 2, dz - 6 - R() * 13, 4.5 + R() * 2, h]); }
      }
    }
    // Street trees and cars
    for (let x = -260; x < 260; x += 11) { if (!L.villas || Math.abs(x) > W * 0.7) trees.push([x + R() * 3, roadZ + 11.2, 6.5 + R() * 3]); if (Math.abs(x) > W / 2 + 4) trees.push([x + R() * 2, roadZ - 11, 6 + R() * 3]); }
    for (let i = 0; i < 14; i++) cars.push([(R() - 0.5) * 420, roadZ + (i % 2 ? 3 : -3), i % 2 ? 0 : Math.PI]);

    // Surroundings
    const blocks = [];
    if (setting !== 'hills') {
      const step = setting === 'city' ? 44 : 34;
      for (let x = -900; x <= 900; x += step) for (let z = -900; z <= 900; z += step) {
        const d = Math.hypot(x, z);
        if (!clear(x, z, 24) || Math.abs(z - roadZ) < 34) continue;
        if (setting === 'water' && z < -D / 2 - 30) continue;
        // Open ground in front, where the cameras stand.
        if (z > 0 && z < roadZ + 260 && Math.abs(x) < W * 0.5 + (z - D / 2) * 0.8) { if (R() > 0.75) trees.push([x, z, 5 + R() * 3]); continue; }
        const r = R();
        if (setting === 'city') {
          if (r < 0.14) { for (let k = 0; k < 4; k++) trees.push([x + R() * 26 - 13, z + R() * 26 - 13, 6 + R() * 4]); continue; }
          // Keep neighbours low near the site so they never hide it.
          const cap = z > 0 ? 10 + Math.max(0, d - 170) * 0.05 : Math.min(L.H * 0.62, 15 + d * 0.05);
          blocks.push([x + R() * 10, z + R() * 10, 18 + R() * 14, 18 + R() * 14, Math.max(7, cap * (0.35 + R() * 0.65))]);
        } else if (r < 0.42) blocks.push([x + R() * 12, z + R() * 12, 10 + R() * 8, 10 + R() * 6, 4 + R() * 6]);
        else if (r < 0.9 && d < 520) for (let k = 0; k < 3; k++) trees.push([x + R() * 30 - 15, z + R() * 30 - 15, 6 + R() * 5]);
      }
    } else {
      for (let i = 0; i < 2400; i++) {
        const a = R() * 6.283, d = 70 + R() * R() * 760, x = Math.cos(a) * (d + W * 0.4), z = Math.sin(a) * (d + D * 0.3);
        if (clear(x, z, 14) && Math.abs(z - roadZ) > 16 && !(z > 0 && Math.abs(x) < W * 0.5 + z * 0.75)) trees.push([x, z, 6 + R() * 6]);
      }
      for (let i = 0; i < 40; i++) { const a = R() * 6.283, d = 190 + R() * 500, x = Math.cos(a) * d, z = Math.sin(a) * d; if (clear(x, z, 40) && Math.abs(z - roadZ) > 34 && !(z > 0 && Math.abs(x) < W * 0.5 + z * 0.75)) blocks.push([x, z, 10 + R() * 6, 10 + R() * 6, 4 + R() * 5]); }
    }
    // Distant ridgeline
    if (setting === 'hills' || setting === 'water' || setting === 'suburb') {
      const geo = new THREE.RingGeometry(620, 2400, 160, 26); geo.rotateX(-Math.PI / 2);
      const a = geo.attributes.position, big = setting === 'hills' ? 1 : 0.4;
      for (let i = 0; i < a.count; i++) {
        const x = a.getX(i), z = a.getZ(i), d = Math.hypot(x, z), th = Math.atan2(z, x);
        const n = 0.55 + 0.45 * Math.sin(th * 3 + 1.3) * Math.sin(th * 5 + d * 0.0016) + 0.22 * Math.sin(th * 13 + d * 0.004) + 0.1 * Math.sin(th * 31 - d * 0.011);
        let y = Math.max(0, n) * 190 * big * Math.min(1, Math.max(0, (d - 640) / 700));
        if (setting === 'water' && z < 0) y *= d > 1500 ? 0.8 : 0;
        a.setY(i, y - 2);
      }
      geo.computeVertexNormals();
      add(geo, mat(setting === 'hills' ? '#5d7044' : '#6c7a5c'), 0, 0, 0);
    }
    if (setting === 'water') {
      this.waterMat = new THREE.MeshStandardMaterial({ color: '#2c5566', roughness: 0.12, metalness: 0.5 });
      const m = flat(3200, 1500, this.waterMat, 0, 0.02, -D / 2 - 34 - 750);
      m.receiveShadow = false;
      add(new THREE.BoxGeometry(3200, 1.2, 5), mat('#b8ad98'), 0, 0.3, -D / 2 - 32);
    }

    // Blocks: one instanced mesh with procedural windows
    if (blocks.length) {
      const m = mat('#ffffff', { roughness: 0.9 });
      m.onBeforeCompile = (s) => {
        s.uniforms.uLit = uniforms.uLit;
        s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n varying vec3 vW; varying vec3 vN2;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n vW = (modelMatrix * instanceMatrix * vec4(position,1.0)).xyz; vN2 = normal;');
        s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
          uniform float uLit; varying vec3 vW; varying vec3 vN2; float bh(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }`)
          .replace('#include <emissivemap_fragment>', `
          if (abs(vN2.y) < 0.5) {
            vec2 q = vec2(abs(vN2.x) > 0.5 ? vW.z : vW.x, vW.y) / vec2(3.6, 3.3); vec2 c = floor(q), f = fract(q);
            float far = smoothstep(700.0, 250.0, length(vW.xz - cameraPosition.xz));
            float w = step(0.2, f.x) * step(f.x, 0.78) * step(0.28, f.y) * step(f.y, 0.78);
            float id = bh(c + floor(vW.xz / 60.0).x);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2,0.24,0.27), w * 0.72 * mix(0.45, 1.0, far));
            totalEmissiveRadiance += vec3(1.0,0.72,0.42) * w * step(id, 0.42) * smoothstep(0.3, 1.0, uLit) * (0.25 + 0.5 * bh(c + 3.0));
          }`);
      };
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), m, blocks.length), M = new THREE.Matrix4();
      const tints = ['#cfc7b8', '#bdb7ab', '#d9d3c7', '#a9a69d', '#c4b5a0', '#b4bcc0'].map(C);
      blocks.forEach(([x, z, w, d, h], i) => { M.makeScale(w, h, d).setPosition(x, h / 2 - 0.1, z); im.setMatrixAt(i, M); im.setColorAt(i, tints[Math.floor(R() * tints.length)]); });
      im.castShadow = im.receiveShadow = true; im.frustumCulled = false;
      g.add(im);
    }
    // Trees
    const leafMat = foliage(), trunk = mat('#5b4a3a');
    const greens = ['#4f6e36', '#5c7a3c', '#6b8744', '#436030', '#7a8f4a'].map(C);
    const blobs = new THREE.InstancedMesh(this.model.leafGeo.clone(), leafMat, trees.length * 6);
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.26, 1, 6), trunk, trees.length);
    const o = new THREE.Object3D();
    trees.forEach(([x, z, h], i) => {
      o.rotation.set(0, 0, 0); o.position.set(x, h * 0.24, z); o.scale.set(h / 7, h * 0.5, h / 7); o.updateMatrix(); trunks.setMatrixAt(i, o.matrix);
      const base = greens[Math.floor(R() * 5)];
      for (let k = 0; k < 6; k++) {
        const s = h * (k === 0 ? 0.6 : 0.3 + R() * 0.2), a = k * 1.26 + R();
        o.position.set(x + (k ? Math.cos(a) * h * 0.2 : 0), h * (k === 0 ? 0.66 : 0.5 + R() * 0.32), z + (k ? Math.sin(a) * h * 0.2 : 0));
        o.rotation.set(R() * 3, R() * 6, R()); o.scale.set(s, s * 0.82, s); o.updateMatrix();
        blobs.setMatrixAt(i * 6 + k, o.matrix); blobs.setColorAt(i * 6 + k, base.clone().offsetHSL(0, 0, (R() - 0.5) * 0.06));
      }
    });
    for (const m of [blobs, trunks]) { m.castShadow = m.receiveShadow = true; m.frustumCulled = false; g.add(m); }
    // Palms: trunk and a fan of bent fronds
    if (palms.length) {
      const fr = new THREE.PlaneGeometry(0.75, 2.6, 2, 6); fr.translate(0, 1.3, 0);
      const pa = fr.attributes.position;
      for (let i = 0; i < pa.count; i++) { const y = pa.getY(i), x = pa.getX(i); pa.setZ(i, -y * y * 0.17 - Math.abs(x) * 0.5); pa.setX(i, x * Math.sin(Math.min(3.0, 0.5 + y)) * 1.1); }
      fr.computeVertexNormals();
      const fronds = new THREE.InstancedMesh(fr, mat('#5d7a3a', { side: THREE.DoubleSide }), palms.length * 11);
      const stems = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.2, 1, 7), mat('#85715a'), palms.length);
      palms.forEach(([x, z, h, y0 = 0], i) => {
        o.rotation.set(0, 0, 0); o.position.set(x, y0 + h / 2, z); o.scale.set(1, h, 1); o.updateMatrix(); stems.setMatrixAt(i, o.matrix);
        for (let k = 0; k < 11; k++) { o.position.set(x, y0 + h, z); o.rotation.set(0.75 + R() * 0.5, (k / 11) * 6.283 + R() * 0.3, 0, 'YXZ'); o.scale.setScalar(0.85 + R() * 0.35); o.updateMatrix(); fronds.setMatrixAt(i * 11 + k, o.matrix); }
      });
      for (const m of [fronds, stems]) { m.castShadow = m.receiveShadow = true; m.frustumCulled = false; g.add(m); }
    }
    // Cars
    const paintCol = ['#d9d9d6', '#2d3338', '#8b1f1c', '#5f6f7c', '#f3f1ec'].map(C);
    const body = new THREE.InstancedMesh(new THREE.BoxGeometry(4.3, 0.75, 1.8), new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.4 }), cars.length);
    const cab = new THREE.InstancedMesh(new THREE.BoxGeometry(2.3, 0.62, 1.6), new THREE.MeshStandardMaterial({ color: '#1d2327', roughness: 0.1, metalness: 0.6 }), cars.length);
    cars.forEach(([x, z, ry], i) => {
      o.scale.setScalar(1); o.rotation.set(0, ry, 0);
      o.position.set(x, 0.72, z); o.updateMatrix(); body.setMatrixAt(i, o.matrix); body.setColorAt(i, paintCol[i % 5]);
      o.position.set(x - 0.15, 1.36, z); o.updateMatrix(); cab.setMatrixAt(i, o.matrix);
    });
    for (const m of [body, cab]) { m.castShadow = true; m.frustumCulled = false; g.add(m); }
    // Lamps along the front
    const lampM = new THREE.MeshBasicMaterial({ color: '#ffcf94' }); this.lampMat = lampM;
    for (let x = -W / 2; x <= W / 2; x += 18) { if (x > 4 && x < 40) continue; add(new THREE.CylinderGeometry(0.07, 0.1, 6), mat('#2e3335'), x, 3, roadZ - 8); add(new THREE.SphereGeometry(0.26, 10, 8), lampM, x, 6.1, roadZ - 8); }

    // Tower crane, seen only while the building rises
    if (!L.villas) {
      const crane = new THREE.Group(), cm = mat('#e0a21b', { roughness: 0.6 });
      const lattice = (len, horizontal) => {
        const G = new THREE.Group();
        for (const a of [-1, 1]) for (const c of [-1, 1]) { const q = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? len : 0.22, horizontal ? 0.18 : len, 0.22), cm); q.position.set(horizontal ? 0 : a * 0.9, horizontal ? a * 0.7 : 0, c * 0.8); q.castShadow = true; G.add(q); }
        for (let k = 0; k < len / 2; k++) for (const c of [-1, 1]) { const q = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.5, 0.12), cm); const s = -len / 2 + 1 + k * 2; q.position.set(horizontal ? s : 0, horizontal ? 0 : s, c * 0.8); q.rotation.z = (k % 2 ? 1 : -1) * 0.85; q.scale.y = horizontal ? 0.8 : 1; G.add(q); }
        return G;
      };
      const mastH = L.H + 16, T = L.towers[0];
      const mast = lattice(mastH, false); mast.position.y = mastH / 2; crane.add(mast);
      const top = new THREE.Group(); top.position.y = mastH;
      const jib = lattice(44, true); jib.position.x = 13; top.add(jib);
      const cw = new THREE.Mesh(new THREE.BoxGeometry(4, 2.4, 2.6), mat('#6f6f6a')); cw.position.set(-8, -1, 0); top.add(cw);
      const rope = new THREE.Mesh(new THREE.BoxGeometry(0.08, 14, 0.08), mat('#333')); rope.position.set(24, -7, 0); top.add(rope);
      const load = new THREE.Mesh(new THREE.BoxGeometry(3, 0.6, 1.4), mat('#8a6b4e')); load.position.set(24, -14, 0); top.add(load);
      crane.add(top); crane.position.set(T.x - T.w / 2 - 6, 0, T.z - 6);
      crane.userData = { top, H: mastH };
      this.crane = crane; g.add(crane);
    } else this.crane = null;
    return g;
  }

  setLight(t) {
    const key = t.toFixed(2);
    if (this.lightKey === key) return;
    this.lightKey = key;
    const l = lightAt(t), el = THREE.MathUtils.degToRad(l.elev), az = THREE.MathUtils.degToRad(l.az);
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    const u = this.skyMat.uniforms;
    u.top.value.copy(l.top); u.mid.value.copy(l.mid); u.hor.value.copy(l.hor); u.sunCol.value.copy(l.sun); u.cloudCol.value.copy(l.cloud); u.sunDir.value.copy(dir);
    u.dusk.value = Math.max(0, t - 1);
    // After sunset the key light becomes high, soft moonlight.
    const key3 = t > 1.6 ? new THREE.Vector3(0.5, 0.8, 0.5).normalize() : new THREE.Vector3(dir.x, Math.max(dir.y, 0.12), dir.z).normalize();
    this.sun.position.copy(key3).multiplyScalar(this.shadowR * 3).add(new THREE.Vector3(0, this.L.H * 0.3, 0));
    this.sun.target.position.set(0, this.L.H * 0.3, 0);
    this.sun.color.copy(l.sun); this.sun.intensity = l.power;
    this.hemi.color.copy(l.mid).lerp(C('#fff'), 0.3); this.hemi.groundColor.copy(C('#6b6350')).multiplyScalar(t > 1.5 ? 0.5 : 1); this.hemi.intensity = l.hemi;
    this.scene.fog.color.copy(l.hor).lerp(l.mid, 0.45);
    this.renderer.toneMappingExposure = l.exp;
    uniforms.uLit.value = l.lit;
    this.model.glow.color.copy(C('#ffc98a')).multiplyScalar(0.35 + l.lit * 2.6);
    this.lampMat.color.copy(C('#ffcf94')).multiplyScalar(0.5 + l.lit * 2.6);
    if (this.poolMat) this.poolMat.emissiveIntensity = 0.2 + l.lit * 1.3;
    this.bloom.strength = 0.08 + l.lit * 0.2;
    if (!this.envs.has(key)) {
      const s = new THREE.Scene(); s.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 20), this.skyMat));
      this.envs.set(key, this.pmrem.fromScene(s, 0, 1, 400).texture);
      if (this.envs.size > 24) { const k = this.envs.keys().next().value; this.envs.get(k).dispose(); this.envs.delete(k); }
    }
    this.scene.environment = this.envs.get(key);
    this.scene.environmentIntensity = l.env;
  }

  setGrowth(g) {
    this.model.setGrowth(g);
    if (this.crane) {
      const gone = Math.max(0, (g - 0.82) / 0.18);
      this.crane.visible = gone < 1;
      this.crane.position.y = -gone * gone * this.crane.userData.H * 1.1;
      this.crane.userData.top.rotation.y = -0.6 + g * 2.2;
    }
  }

  // lift: share of the frame height the picture is raised by, to leave room for text.
  shoot(shot, p, w, h, lift = 0, side = 0) {
    const L = this.L, cam = this.camera, aspect = w / h;
    const D2R = Math.PI / 180, e = p * p * (3 - 2 * p), lin = p;
    const massW = L.villas ? L.siteW * 0.92 : Math.max(...L.towers.map((t) => Math.abs(t.x) + t.w / 2)) * 2;
    const tall = aspect < 1;
    const fit = (W, H, fov, fill) => {
      const fv = Math.tan((fov * D2R) / 2);
      return Math.max(H / 2 / fv, W / 2 / (fv * aspect)) / fill;
    };
    const orbit = (az, el, dist, target, fov) => {
      const a = az * D2R, l = el * D2R;
      cam.fov = fov;
      cam.position.set(target.x + Math.sin(a) * Math.cos(l) * dist, Math.max(1.7, target.y + Math.sin(l) * dist), target.z + Math.cos(a) * Math.cos(l) * dist);
      cam.lookAt(target);
    };
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const H = L.H, T0 = L.towers[Math.floor((L.towers.length - 1) / 2)];
    const wide = massW * (tall ? 0.98 : 1);
    if (shot === 'rise') orbit(mix(36, 20, lin), L.villas ? 20 : mix(2, -1, lin), fit(wide * 1.05, H * 1.15, 30, tall ? 0.86 : 0.74), V(0, H * 0.46, 0), 30);
    else if (shot === 'aerial') orbit(mix(-46, -24, lin), mix(36, 30, e), fit(L.siteW * 0.92, H * 1.5, 32, tall ? 0.95 : 0.86), V(0, H * 0.4, 0), 32);
    else if (shot === 'orbit') orbit(mix(-32, 12, lin), L.villas ? 24 : 8, fit(wide, H * 1.1, 30, tall ? 0.84 : 0.74), V(0, H * 0.47, 0), 30);
    else if (shot === 'hero') orbit(mix(27, 22, lin), L.villas ? 15 : -4, fit(wide * 1.02, H * 1.14, 30, mix(tall ? 0.8 : 0.7, tall ? 0.87 : 0.76, e)), V(0, H * 0.45, 0), 30);
    else if (shot === 'street') {
      const z = L.siteD / 2 + (L.villas ? 12 : 22 + Math.max(0, H - 60) * 0.62);
      cam.fov = tall ? 58 : 46;
      const x0 = L.villas ? 14 : 26;
      cam.position.set(mix(x0 + 5, x0 - 4, lin), 2.4, z);
      cam.lookAt(V(L.villas ? 0 : T0.x * 0.4, Math.min(H * 0.44, L.villas ? 4 : 40 + Math.max(0, H - 90) * 0.4), T0.z));
    } else if (shot === 'close') {
      const span = Math.min(tall ? 38 : 30, H * 0.8), y = Math.max(span * 0.42, H * mix(0.46, 0.66, lin));
      const dist = span / 2 / Math.tan(13 * D2R);
      orbit(T0.rot / D2R + mix(37, 31, lin), -6, dist, V(T0.x, y, T0.z + T0.d * 0.3), 26);
    } else if (shot === 'deck') {
      if (L.podium) {
        const dz = L.podium.z + L.podium.d / 2;
        cam.fov = tall ? 56 : 42;
        cam.position.set(mix(24, 17, lin), L.podium.h + mix(10, 8.2, e), dz + (tall ? 11 : 5));
        cam.lookAt(V(mix(-4, -2, lin), L.podium.h + (tall ? 5 : 2.5), dz - 24));
      } else orbit(mix(20, 30, lin), 24, fit(L.siteW * 0.5, H * 0.6, 34, 1), V(0, H * 0.2, L.siteD * 0.2), 34);
    }
    cam.aspect = aspect;
    // Push the near plane out on far shots: thin layers (paving, lawns) otherwise flicker.
    const away = Math.max(0, Math.abs(cam.position.x) - massW / 2 - 30, cam.position.z - L.siteD / 2 - 30, cam.position.y - H);
    cam.near = Math.max(0.5, Math.min(away * 0.5, 60));
    if (lift || side) cam.setViewOffset(w, h, -Math.round(side * w), Math.round(lift * h), w, h); else cam.clearViewOffset();
    cam.updateProjectionMatrix();
    this.sky.position.copy(cam.position);
  }

  render(w, h) {
    if (this.size[0] !== w || this.size[1] !== h) {
      this.size = [w, h];
      this.renderer.setSize(w, h, false);
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
    this.composer.render(1 / 30);
    return this.canvas;
  }

  dispose() { this.composer.dispose(); this.renderer.dispose(); }
}
