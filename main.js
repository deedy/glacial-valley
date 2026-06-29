import * as THREE from 'three';
import * as SH from './shaders.js?v=9';
import { makeTreeGeometry, ARCHETYPES } from './trees.js?v=7';

// ── Config ───────────────────────────────────────────────────────────────────
const WATER_Y      = 0.0;
const WORLD_HALF   = 4500;          // terrain half extent (m)
const TERRAIN_SEG  = 620;           // graded grid segments
const COARSE_RES   = 1024;          // 9 km heightfield/shadow map
const FINE_RES     = 1024;          // 1.5 km heightfield/shadow map
const FINE_HALF    = 760;
const GRASS_COUNT  = 85000;
const PEBBLE_COUNT = 9000;
const BOULDER_COUNT= 80;
const FLOWER_COUNT = 700;
const DEW_COUNT    = 1300;
const MOTE_COUNT   = 2600;
const INSECT_COUNT = 60;
const MIST_COUNT   = 36;
const PLUME_COUNT  = 8;

const SUN_EL = 8.0 * Math.PI/180;
const SUN_AZ = 10.0 * Math.PI/180;
const SUN_DIR = new THREE.Vector3(
  Math.cos(SUN_EL)*Math.cos(SUN_AZ), Math.sin(SUN_EL), Math.cos(SUN_EL)*Math.sin(SUN_AZ)
).normalize();
const SUN_MORN = SUN_DIR.clone();          // shadow-bake direction: morning
const SUN_EVE = new THREE.Vector3(         // shadow-bake direction: evening (sun sets down-valley west)
  Math.cos(SUN_EL)*Math.cos(Math.PI - SUN_AZ), Math.sin(SUN_EL), Math.cos(SUN_EL)*Math.sin(Math.PI - SUN_AZ)
).normalize();
const WIND = new THREE.Vector2(-1.0, -0.18).normalize();

// ── Tiny utils ───────────────────────────────────────────────────────────────
const clamp = (x,a,b)=> x<a?a:(x>b?b:x);
const lerp = (a,b,t)=> a+(b-a)*t;
function sstep(a,b,x){ const t = clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); }
function mulberry32(seed){ let a = seed>>>0; return function(){ a|=0; a = a+0x6D2B79F5|0; let t = Math.imul(a^a>>>15, 1|a); t = t+Math.imul(t^t>>>7, 61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

const loadMsg = document.getElementById('loadmsg');
const loadBar = document.getElementById('loadbar');
function tick(msg, frac){
  loadMsg.textContent = msg;
  loadBar.style.width = (frac*100).toFixed(0) + '%';
  return new Promise(r => setTimeout(r, 0));
}

// ── CPU value noise with analytic derivatives (for erosion-weighted fBm) ────
let ND_n=0, ND_dx=0, ND_dz=0;
function h2(ix, iz){
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ 0x9E3779B9;
  h = Math.imul(h ^ (h>>>13), 1274126177);
  h ^= h>>>16;
  return (h>>>0) * (1/4294967296);
}
function vnoised(x, z){
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x-ix, fz = z-iz;
  const ux = fx*fx*fx*(fx*(fx*6-15)+10);
  const uz = fz*fz*fz*(fz*(fz*6-15)+10);
  const dux = 30*fx*fx*(fx*(fx-2)+1);
  const duz = 30*fz*fz*(fz*(fz-2)+1);
  const a = h2(ix,iz), b = h2(ix+1,iz), c = h2(ix,iz+1), d = h2(ix+1,iz+1);
  const k1 = b-a, k2 = c-a, k4 = a-b-c+d;
  ND_n  = a + k1*ux + k2*uz + k4*ux*uz;
  ND_dx = (k1 + k4*uz)*dux;
  ND_dz = (k2 + k4*ux)*duz;
}
function fbmE(x, z, oct){
  let a=0, w=0.5, f=1, dx=0, dz=0;
  for (let i=0;i<oct;i++){
    vnoised(x*f + i*13.7, z*f + i*7.3);
    dx += ND_dx*w*f; dz += ND_dz*w*f;
    a += w*(ND_n*2-1)/(1 + 0.7*(dx*dx + dz*dz));
    w *= 0.5; f *= 2.02;
  }
  return a;
}
function ridged(x, z, oct){
  let a=0, w=0.5, f=1, prev=1, dx=0, dz=0;
  for (let i=0;i<oct;i++){
    vnoised(x*f + i*5.2, z*f + i*11.8);
    const n = ND_n*2-1;
    dx += ND_dx*w*f; dz += ND_dz*w*f;
    let r = 1 - Math.abs(n); r = r*r;
    a += r*w*prev/(1 + 0.35*(dx*dx + dz*dz));
    prev = r;
    w *= 0.5; f *= 2.07;
  }
  return a;
}

// ── Terrain height function ──────────────────────────────────────────────────
function meanderC(x){ return 40*Math.sin(x*0.0042+1.3) + 15*Math.sin(x*0.0126+0.4) + 6*Math.sin(x*0.031); }
function halfWidth(x){ return 62 + 24*Math.sin(x*0.006+2.0) + 8*Math.sin(x*0.017); }

function terrainH(x, z, lod){
  const m = meanderC(x);
  const dz = z - m, ad = Math.abs(dz);
  const hw = halfWidth(x);
  const tBed = sstep(hw*0.8, hw*1.3, ad);
  let bed = 0, plain = 0;
  if (tBed < 0.999){
    const q = ad/hw;
    const cross = Math.max(0, 1 - q*q);
    const bars = fbmE(x*0.0062, dz*0.030, lod ? 3 : 4);
    bed = -1.7*Math.pow(cross, 0.7) + bars*1.9 + 0.55;
    bed = Math.min(bed, 0.75);
  }
  if (tBed > 0.001){
    plain = 0.9 + 5.5*sstep(hw, hw+230, ad)
          + 1.8*fbmE(x*0.013, z*0.013, lod ? 3 : 4)
          + (lod ? 0 : 0.5*fbmE(x*0.10, z*0.10, 3));
    plain = Math.max(plain, 0.35);
  }
  let h = bed*(1-tBed) + plain*tBed;

  // tiny rivulets feeding the river on the camera bank
  if (!lod && x > -90 && x < 110 && dz > hw*0.6 && z < 200){
    const axis = sstep(m + hw*0.55, m + hw*0.85, z) * (1 - sstep(168, 195, z));
    if (axis > 0.001){
      let mk = 0;
      const d1 = Math.abs(x - (-28 + 6*Math.sin(z*0.085+1.0)));
      mk = Math.max(mk, Math.exp(-d1*d1/1.1));
      const d2 = Math.abs(x - (58 + 5*Math.sin(z*0.07+0.3)));
      mk = Math.max(mk, Math.exp(-d2*d2/0.9));
      h = lerp(h, Math.min(h, -0.18), clamp(mk*1.4, 0, 1)*axis);
    }
  }

  // valley walls & ridged peaks
  const tw = sstep(hw+130, 1700, ad);
  const tp = sstep(500, 2900, ad);
  if (tw > 0.001){
    vnoised(x*0.00031+9.7, z*0.00031+3.1); const w1 = ND_n;
    vnoised(x*0.00027+1.2, z*0.00027+7.7); const w2 = ND_n;
    const wx = x + (w1-0.5)*1400, wz = z + (w2-0.5)*1400;
    const ridge = ridged(wx*0.00055, wz*0.00055, lod ? 5 : 6);
    const ridge2 = ridged(wx*0.0011, wz*0.0011, lod ? 3 : 4);
    h += Math.pow(tw, 1.5)*640*(0.55 + 0.9*ridge2);
    h += Math.pow(Math.max(ridge*1.45, 0), 1.4)*2150*tp;
    h += ridged(wx*0.0021, wz*0.0021, lod ? 3 : 4)*340*Math.max(tp, tw*0.5);
    h += fbmE(x*0.0035, z*0.0035, 4)*160*tw;
  }
  return h;
}

// ── Camera anchor ────────────────────────────────────────────────────────────
const CAM = new THREE.Vector3(0, 0, 134);
CAM.y = terrainH(CAM.x, CAM.z, 0) + 1.45;

// ── Heightfield grids + shadow baking ────────────────────────────────────────
function makeGrid(res, cx, cz, half, lod){
  const h = new Float32Array(res*res);
  const step = (2*half)/(res-1);
  return { h, res, cx, cz, half, step,
    fill: async function(progress0, progress1, label){
      for (let j=0;j<res;j++){
        const z = cz - half + j*step;
        for (let i=0;i<res;i++){
          h[j*res+i] = terrainH(cx - half + i*step, z, lod);
        }
        if ((j & 63) === 0) await tick(label, lerp(progress0, progress1, j/res));
      }
    },
    sample: function(x, z){
      const fx = clamp((x - (cx-half))/step, 0, res-1.001);
      const fz = clamp((z - (cz-half))/step, 0, res-1.001);
      const ix = Math.floor(fx), iz = Math.floor(fz);
      const tx = fx-ix, tz = fz-iz;
      const i0 = iz*res+ix;
      return lerp(lerp(h[i0], h[i0+1], tx), lerp(h[i0+res], h[i0+res+1], tx), tz);
    }
  };
}

function bakeShadows(grid, sunDir){
  const { h, res, step } = grid;
  const vis = new Float32Array(res*res).fill(1);
  const horiz = Math.hypot(sunDir.x, sunDir.z);
  const dirx = sunDir.x/horiz, dirz = sunDir.z/horiz;
  const tanEl = sunDir.y/horiz;
  const maxD = grid.half*2;
  for (let j=0;j<res;j++){
    for (let i=0;i<res;i++){
      const px = i, pz = j;
      const h0 = h[j*res+i] + 0.6;
      let v = 1, d = 4, stp = Math.max(step*0.8, 3);
      for (let k=0;k<44;k++){
        d += stp; stp *= 1.10;
        if (d > maxD) break;
        const sx = px + dirx*d/step, sz = pz + dirz*d/step;
        if (sx < 0 || sz < 0 || sx >= res-1 || sz >= res-1) break;
        const ix = sx|0, iz = sz|0, tx = sx-ix, tz = sz-iz;
        const i0 = iz*res+ix;
        const ht = lerp(lerp(h[i0], h[i0+1], tx), lerp(h[i0+res], h[i0+res+1], tx), tz);
        const ray = h0 + tanEl*d;
        v = Math.min(v, clamp(0.5 + (ray-ht)/(d*0.035), 0, 1));
        if (v <= 0) break;
      }
      vis[j*res+i] = v;
    }
  }
  return vis;
}

function gridTexture(grid, visM, visE){
  const { res, h } = grid;
  const data = new Float32Array(res*res*4);
  for (let i=0;i<res*res;i++){
    data[i*4] = h[i]; data[i*4+1] = visM[i]; data[i*4+2] = visE[i]; data[i*4+3] = 1;
  }
  const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat, THREE.FloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

// ── Main init ────────────────────────────────────────────────────────────────
async function init(){
  await tick('reading the bedrock…', 0.01);

  const coarse = makeGrid(COARSE_RES, 0, 0, WORLD_HALF, 1);
  await coarse.fill(0.02, 0.20, 'uplifting mountains…');
  const fine = makeGrid(FINE_RES, 0, 60, FINE_HALF, 0);
  await fine.fill(0.20, 0.34, 'braiding the river…');

  // ── place boulders, stamp them into the fine field so they shadow fog/water
  const rng = mulberry32(1337);
  const boulders = [];
  let guard = 0;
  while (boulders.length < BOULDER_COUNT && guard++ < 6000){
    const ang = rng()*Math.PI*2;
    const r = 8 + Math.pow(rng(), 1.6)*360;
    const x = CAM.x + Math.cos(ang)*r;
    const z = CAM.z + Math.sin(ang)*r*0.7 - 30;
    if (Math.abs(x) > FINE_HALF-40 || Math.abs(z-60) > FINE_HALF-40) continue;
    const y = fine.sample(x, z);
    if (y < -0.6 || y > 9) continue;
    const s = 0.35 + Math.pow(rng(), 2.2)*3.0;
    if (r < 25 && s > 1.6) continue;
    boulders.push({ x, z, y, s, yaw: rng()*Math.PI*2, seed: rng()*100, flat: 0.55+rng()*0.5 });
  }
  for (const b of boulders){
    if (b.s < 0.7) continue;
    const rad = b.s*0.95, r2 = rad*rad;
    const i0 = Math.max(0, Math.floor((b.x - rad - (fine.cx-fine.half))/fine.step));
    const i1 = Math.min(fine.res-1, Math.ceil((b.x + rad - (fine.cx-fine.half))/fine.step));
    const j0 = Math.max(0, Math.floor((b.z - rad - (fine.cz-fine.half))/fine.step));
    const j1 = Math.min(fine.res-1, Math.ceil((b.z + rad - (fine.cz-fine.half))/fine.step));
    for (let j=j0;j<=j1;j++) for (let i=i0;i<=i1;i++){
      const px = fine.cx - fine.half + i*fine.step;
      const pz = fine.cz - fine.half + j*fine.step;
      const d2 = (px-b.x)*(px-b.x) + (pz-b.z)*(pz-b.z);
      if (d2 < r2){
        const bump = b.y + Math.sqrt(1 - d2/r2)*b.s*0.8;
        const idx = j*fine.res+i;
        if (bump > fine.h[idx]) fine.h[idx] = bump;
      }
    }
  }

  // ── a lush island in the river, stamped before the shadow bake so it casts ──
  // shadows and the water rings it. HEAD/crossD/ISL are reused by the bridge.
  const HEAD = { x: Math.cos(-0.28), z: Math.sin(-0.28) };       // camera's down-river look
  let crossD = 42;                                               // distance to the near waterline
  for (let d = 8; d < 170; d += 1.5){
    const x = CAM.x + HEAD.x*d, z = CAM.z + HEAD.z*d;
    if (Math.abs(x) > FINE_HALF-90 || Math.abs(z-60) > FINE_HALF-90) break;
    if (fine.sample(x, z) < WATER_Y - 0.05){ crossD = d; break; }
  }
  const ISL = { x: CAM.x + HEAD.x*(crossD+33), z: CAM.z + HEAD.z*(crossD+33), R: 9.5, H: 2.7 };
  {
    const Rout = ISL.R*1.65;
    const i0 = Math.max(0, Math.floor((ISL.x - Rout - (fine.cx-fine.half))/fine.step));
    const i1 = Math.min(fine.res-1, Math.ceil((ISL.x + Rout - (fine.cx-fine.half))/fine.step));
    const j0 = Math.max(0, Math.floor((ISL.z - Rout - (fine.cz-fine.half))/fine.step));
    const j1 = Math.min(fine.res-1, Math.ceil((ISL.z + Rout - (fine.cz-fine.half))/fine.step));
    for (let j=j0;j<=j1;j++) for (let i=i0;i<=i1;i++){
      const px = fine.cx - fine.half + i*fine.step;
      const pz = fine.cz - fine.half + j*fine.step;
      const dx = px - ISL.x, dz = pz - ISL.z;
      const d = Math.hypot(dx, dz);
      const ang = Math.atan2(dz, dx);
      const Reff = ISL.R*(0.82 + 0.26*Math.sin(ang*3.0 + Math.sin(ang*2.0 + 1.0)));   // organic outline
      const idx = j*fine.res+i;
      if (d < Reff){
        vnoised(px*0.18+3, pz*0.18+3);
        const dome = ISL.H*(1.0 - sstep(0.45, 1.0, d/Reff)) + (ND_n-0.5)*0.5;          // flat-topped mound
        const h = WATER_Y + Math.max(dome, 0.15);
        if (h > fine.h[idx]) fine.h[idx] = h;
      } else if (d < Rout){
        const u = (d - Reff)/(Rout - Reff);
        const moat = WATER_Y - 0.15 - 1.0*Math.min(u, 1.0);                            // water rings the island
        if (moat < fine.h[idx]) fine.h[idx] = moat;
      }
    }
    // a few mossy boulders perched on the island (rendered with the boulder batch)
    const ib = mulberry32(7);
    for (let k=0;k<5;k++){
      const a = ib()*Math.PI*2, rr = ISL.R*(0.15 + ib()*0.5);
      const x = ISL.x + Math.cos(a)*rr, z = ISL.z + Math.sin(a)*rr;
      boulders.push({ x, z, y: fine.sample(x, z), s: 0.4 + ib()*1.1,
        yaw: ib()*Math.PI*2, seed: ib()*100, flat: 0.6 + ib()*0.4 });
    }
  }

  await tick('tracing morning light…', 0.36);
  const coarseVisM = bakeShadows(coarse, SUN_MORN);
  await tick('tracing morning light…', 0.44);
  const fineVisM = bakeShadows(fine, SUN_MORN);
  await tick('tracing evening light…', 0.52);
  const coarseVisE = bakeShadows(coarse, SUN_EVE);
  await tick('tracing evening light…', 0.58);
  const fineVisE = bakeShadows(fine, SUN_EVE);
  await tick('settling sediment…', 0.62);

  const texCoarse = gridTexture(coarse, coarseVisM, coarseVisE);
  const texFine = gridTexture(fine, fineVisM, fineVisE);

  // ── renderer / scene ──────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, innerWidth/innerHeight, 0.25, 16000);
  camera.position.copy(CAM);

  // shared uniforms (same value objects across all materials)
  const U = {
    uTime:        { value: 0 },
    uSunDir:      { value: SUN_DIR },
    uSunColor:    { value: new THREE.Vector3(1.0, 0.52, 0.27).multiplyScalar(10.5) },
    uSkyZenith:   { value: new THREE.Vector3(0.21, 0.36, 0.65) },
    uHorizonCold: { value: new THREE.Vector3(0.46, 0.55, 0.72) },
    uHorizonWarm: { value: new THREE.Vector3(1.16, 0.55, 0.22) },
    uGroundBounce:{ value: new THREE.Vector3(0.10, 0.085, 0.07) },
    uMapCoarse:   { value: texCoarse },
    uMapFine:     { value: texFine },
    uRegCoarse:   { value: new THREE.Vector3(coarse.cx, coarse.cz, coarse.half) },
    uRegFine:     { value: new THREE.Vector3(fine.cx, fine.cz, fine.half) },
    uWaterY:      { value: WATER_Y },
    uWindDir:     { value: WIND },
    uVisW:        { value: new THREE.Vector2(1, 0) },
    uSeasonT:     { value: 0 },
    uGreen:       { value: 0 },
    uAutumn:      { value: 0 },
    uBloom:       { value: 0.35 },
    uSnowUp:      { value: 0 },
    uLush:        { value: 0 },
  };
  const withU = (extra) => Object.assign({}, U, extra);
  const COMMON = SH.COMMON;

  // ── sky ───────────────────────────────────────────────────────────────────
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(12000, 48, 24),
    new THREE.ShaderMaterial({ uniforms: withU({}), vertexShader: SH.skyVert,
      fragmentShader: SH.skyFrag(COMMON), side: THREE.BackSide, depthWrite: false })
  );
  scene.add(sky);

  // ── terrain: graded grid, dense near camera ───────────────────────────────
  await tick('carving the valley…', 0.66);
  const grade = (u) => WORLD_HALF * u * (0.045 + 0.955*Math.pow(Math.abs(u), 4));
  {
    const N = TERRAIN_SEG, V = N+1;
    const pos = new Float32Array(V*V*3);
    const xs = new Float32Array(V), zs = new Float32Array(V);
    for (let i=0;i<V;i++){ xs[i] = CAM.x + grade(i/N*2-1); zs[i] = CAM.z + grade(i/N*2-1); }
    let k = 0;
    for (let j=0;j<V;j++){
      const z = zs[j];
      for (let i=0;i<V;i++){
        pos[k++] = xs[i]; pos[k++] = terrainH(xs[i], z, Math.abs(xs[i]-CAM.x) + Math.abs(z-CAM.z) > 900 ? 1 : 0); pos[k++] = z;
      }
      if ((j & 31) === 0) await tick('carving the valley…', lerp(0.66, 0.82, j/V));
    }
    const idx = new Uint32Array(N*N*6);
    let q = 0;
    for (let j=0;j<N;j++) for (let i=0;i<N;i++){
      const a = j*V+i, b = a+1, c = a+V, d = c+1;
      idx[q++]=a; idx[q++]=c; idx[q++]=b; idx[q++]=b; idx[q++]=c; idx[q++]=d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();

    // track line: a short walk across the silt bar in front of the camera
    let trackZ = CAM.z - 8;
    for (let z = CAM.z; z > CAM.z - 60; z -= 1){
      const y = fine.sample(CAM.x + 14, z);
      if (y > 0.08 && y < 0.55){ trackZ = z; break; }
    }
    const terrainMat = new THREE.ShaderMaterial({
      uniforms: withU({
        uTrackA: { value: new THREE.Vector2(CAM.x - 6, trackZ + 2) },
        uTrackB: { value: new THREE.Vector2(CAM.x + 42, trackZ - 5) },
      }),
      vertexShader: SH.terrainVert, fragmentShader: SH.terrainFrag(COMMON),
    });
    const terrain = new THREE.Mesh(geo, terrainMat);
    terrain.frustumCulled = false;
    scene.add(terrain);
  }

  // ── water: meander-following strip ────────────────────────────────────────
  await tick('filling the river…', 0.84);
  const refrRT = new THREE.WebGLRenderTarget((innerWidth*0.75)|0, (innerHeight*0.75)|0, {
    type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const waterMat = new THREE.ShaderMaterial({
    uniforms: withU({
      tRefr: { value: refrRT.texture },
      uResolution: { value: new THREE.Vector2(innerWidth*renderer.getPixelRatio(), innerHeight*renderer.getPixelRatio()) },
    }),
    vertexShader: SH.waterVert, fragmentShader: SH.waterFrag(COMMON),
  });
  let water;
  {
    const NX = 900, NZ = 36, V = (NX+1)*(NZ+1);
    const pos = new Float32Array(V*3);
    let k = 0;
    for (let i=0;i<=NX;i++){
      const x = CAM.x + grade(i/NX*2-1);
      const m = meanderC(x);
      for (let j=0;j<=NZ;j++){
        pos[k++] = x; pos[k++] = WATER_Y; pos[k++] = m + (j/NZ*2-1)*170;
      }
    }
    const idx = new Uint32Array(NX*NZ*6);
    let q = 0;
    for (let i=0;i<NX;i++) for (let j=0;j<NZ;j++){
      const a = i*(NZ+1)+j, b = a+1, c = a+NZ+1, d = c+1;
      idx[q++]=a; idx[q++]=b; idx[q++]=c; idx[q++]=b; idx[q++]=d; idx[q++]=c;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    water = new THREE.Mesh(geo, waterMat);
    water.frustumCulled = false;
    scene.add(water);
  }

  // ── instanced helpers ─────────────────────────────────────────────────────
  function instanced(baseGeo, count, mat){
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = baseGeo.index;
    geo.attributes = baseGeo.attributes;
    geo.instanceCount = count;
    const offsets = new Float32Array(count*3);
    const params = new Float32Array(count*4);
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    geo.setAttribute('aParam', new THREE.InstancedBufferAttribute(params, 4));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    return { mesh, offsets, params };
  }
  const slopeAt = (x,z) => {
    const e = 2.5;
    const dx = (fine.sample(x+e,z) - fine.sample(x-e,z))/(2*e);
    const dz = (fine.sample(x,z+e) - fine.sample(x,z-e))/(2*e);
    return Math.hypot(dx, dz);
  };

  // grass blades
  await tick('sowing grass…', 0.88);
  {
    const bladeGeo = new THREE.BufferGeometry();
    const segs = 3, w0 = 0.045;
    const bp = [], bn = [], bi = [];
    for (let s=0;s<=segs;s++){
      const t = s/segs, w = w0*(1-t*0.85);
      bp.push(-w, t, 0,  w, t, 0);
      bn.push(0,0,1, 0,0,1);
    }
    for (let s=0;s<segs;s++){
      const a = s*2;
      bi.push(a, a+1, a+2, a+1, a+3, a+2);
    }
    bladeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bp), 3));
    bladeGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(bn), 3));
    bladeGeo.setIndex(bi);
    const mat = new THREE.ShaderMaterial({
      uniforms: withU({}), vertexShader: SH.grassVert(COMMON), fragmentShader: SH.grassFrag(COMMON),
      side: THREE.DoubleSide });
    const { mesh, offsets, params } = instanced(bladeGeo, GRASS_COUNT, mat);
    const grng = mulberry32(99);
    let n = 0, tries = 0;
    while (n < GRASS_COUNT && tries++ < GRASS_COUNT*10){
      const ang = grng()*Math.PI*2;
      const r = 1.2 + Math.pow(grng(), 2.1)*95;
      const x = CAM.x + Math.cos(ang)*r;
      const z = CAM.z + Math.sin(ang)*r;
      const y = fine.sample(x, z);
      if (y < WATER_Y+0.32 || y > WATER_Y+30) continue;
      if (slopeAt(x, z) > 0.45) continue;
      vnoised(x*0.045+7, z*0.045+7);
      if (ND_n < 0.40) continue;
      offsets[n*3]=x; offsets[n*3+1]=y-0.01; offsets[n*3+2]=z;
      params[n*4]   = 0.14 + grng()*0.32;
      params[n*4+1] = grng()*Math.PI*2;
      params[n*4+2] = grng()*20;
      params[n*4+3] = grng();
      n++;
    }
    mesh.geometry.instanceCount = n;
    scene.add(mesh);
    mesh.userData.noRefr = true;

    // dew droplets sitting on blade tips
    const dewPos = new Float32Array(DEW_COUNT*3);
    const dewSeed = new Float32Array(DEW_COUNT);
    for (let i=0;i<DEW_COUNT;i++){
      const j = (grng()*n)|0;
      dewPos[i*3]   = offsets[j*3] + (grng()-0.5)*0.05;
      dewPos[i*3+1] = offsets[j*3+1] + params[j*4]*(0.7+grng()*0.3);
      dewPos[i*3+2] = offsets[j*3+2] + (grng()-0.5)*0.05;
      dewSeed[i] = grng();
    }
    const dewGeo = new THREE.BufferGeometry();
    dewGeo.setAttribute('position', new THREE.BufferAttribute(dewPos, 3));
    dewGeo.setAttribute('aSeed', new THREE.BufferAttribute(dewSeed, 1));
    const dew = new THREE.Points(dewGeo, new THREE.ShaderMaterial({
      uniforms: withU({}), vertexShader: SH.dewVert(COMMON), fragmentShader: SH.dewFrag(COMMON),
      transparent: true, depthWrite: false }));
    dew.frustumCulled = false; dew.renderOrder = 3; dew.userData.noRefr = true;
    scene.add(dew);
  }

  // pebbles (shore + underwater)
  {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const mat = new THREE.ShaderMaterial({
      uniforms: withU({}), vertexShader: SH.rockVert(COMMON, false), fragmentShader: SH.rockFrag(COMMON) });
    const { mesh, offsets, params } = instanced(geo, PEBBLE_COUNT, mat);
    const prng = mulberry32(555);
    let n = 0, tries = 0;
    while (n < PEBBLE_COUNT && tries++ < PEBBLE_COUNT*10){
      const ang = prng()*Math.PI*2;
      const r = 1.5 + Math.pow(prng(), 1.9)*70;
      const x = CAM.x + Math.cos(ang)*r;
      const z = CAM.z + Math.sin(ang)*r;
      const y = fine.sample(x, z);
      if (y < WATER_Y-0.7 || y > WATER_Y+1.6) continue;
      if (slopeAt(x, z) > 0.5) continue;
      const s = 0.02 + Math.pow(prng(), 2.5)*0.10;
      offsets[n*3]=x; offsets[n*3+1]=y + s*0.25; offsets[n*3+2]=z;
      params[n*4]=s; params[n*4+1]=prng()*Math.PI*2; params[n*4+2]=prng()*100; params[n*4+3]=0.45+prng()*0.35;
      n++;
    }
    mesh.geometry.instanceCount = n;
    scene.add(mesh);
  }

  // boulders
  {
    const geo = new THREE.IcosahedronGeometry(1, 3);
    const mat = new THREE.ShaderMaterial({
      uniforms: withU({}), vertexShader: SH.rockVert(COMMON, true), fragmentShader: SH.rockFrag(COMMON) });
    const { mesh, offsets, params } = instanced(geo, boulders.length, mat);
    boulders.forEach((b, i) => {
      offsets[i*3]=b.x; offsets[i*3+1]=b.y + b.s*0.12; offsets[i*3+2]=b.z;
      params[i*4]=b.s; params[i*4+1]=b.yaw; params[i*4+2]=b.seed; params[i*4+3]=b.flat;
    });
    scene.add(mesh);
  }

  // wildflowers
  {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI/2).translate(0, 1.0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: withU({}), vertexShader: SH.flowerVert(COMMON), fragmentShader: SH.flowerFrag(COMMON),
      side: THREE.DoubleSide });
    const { mesh, offsets, params } = instanced(geo, FLOWER_COUNT, mat);
    const frng = mulberry32(2024);
    let n = 0, tries = 0;
    while (n < FLOWER_COUNT && tries++ < FLOWER_COUNT*12){
      const ang = frng()*Math.PI*2;
      const r = 3 + Math.pow(frng(), 1.5)*42;
      const x = CAM.x + Math.cos(ang)*r;
      const z = CAM.z + Math.sin(ang)*r;
      const y = fine.sample(x, z);
      if (y < WATER_Y+0.34 || y > WATER_Y+20) continue;
      if (slopeAt(x, z) > 0.4) continue;
      vnoised(x*0.2+3, z*0.2+3);
      if (ND_n < 0.55) continue;
      offsets[n*3]=x; offsets[n*3+1]=y; offsets[n*3+2]=z;
      params[n*4]=0.05+frng()*0.06; params[n*4+1]=frng()*Math.PI*2; params[n*4+2]=frng()*20; params[n*4+3]=frng();
      n++;
    }
    mesh.geometry.instanceCount = n;
    mesh.userData.noRefr = true;
    scene.add(mesh);
  }

  // ice shelves along shaded shorelines
  {
    const base = new THREE.CircleGeometry(1, 9).rotateX(-Math.PI/2);
    const posAttr = base.getAttribute('position');
    const irng = mulberry32(31415);
    for (let i=0;i<posAttr.count;i++){
      const px = posAttr.getX(i), pz = posAttr.getZ(i);
      const rr = Math.hypot(px, pz);
      if (rr > 0.5){ const j = 0.7 + irng()*0.5; posAttr.setX(i, px*j); posAttr.setZ(i, pz*j); }
    }
    base.computeVertexNormals();
    const mat = new THREE.ShaderMaterial({
      uniforms: withU({}), vertexShader: SH.iceVert(COMMON), fragmentShader: SH.iceFrag(COMMON),
      transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const MAX_ICE = 260;
    const { mesh, offsets, params } = instanced(base, MAX_ICE, mat);
    let n = 0;
    for (let x = CAM.x - 350; x < CAM.x + 700 && n < MAX_ICE; x += 6){
      const m = meanderC(x);
      for (const side of [-1, 1]){
        // walk outward to find the waterline
        for (let d = 10; d < 130; d += 2.5){
          const z = m + side*d;
          const y = fine.sample(x, z);
          if (y > WATER_Y - 0.02){
            if (y < WATER_Y + 0.45){
              const visHere = (() => {
                const fx = clamp((x-(fine.cx-fine.half))/fine.step, 0, fine.res-1.01);
                const fz = clamp((z-(fine.cz-fine.half))/fine.step, 0, fine.res-1.01);
                return fineVisM[(fz|0)*fine.res + (fx|0)];
              })();
              if (visHere < 0.45 && irng() < 0.55 && n < MAX_ICE){
                offsets[n*3]=x + (irng()-0.5)*3;
                offsets[n*3+1]=WATER_Y + 0.025;
                offsets[n*3+2]=z + (irng()-0.5)*3;
                params[n*4]=0.7+irng()*2.4; params[n*4+1]=irng()*Math.PI*2;
                params[n*4+2]=irng()*40; params[n*4+3]=(irng()-0.5)*0.06;
                n++;
              }
            }
            break;
          }
        }
      }
    }
    mesh.geometry.instanceCount = n;
    mesh.renderOrder = 1;
    mesh.userData.noRefr = true;
    scene.add(mesh);
  }

  // driftwood
  {
    const mat = new THREE.ShaderMaterial({
      uniforms: withU({}), vertexShader: SH.woodVert, fragmentShader: SH.woodFrag(COMMON) });
    const logs = [
      { x: CAM.x+9, z: CAM.z-15, len: 3.4, r: 0.10, rotY: 0.5, rotZ: 0.06 },
      { x: CAM.x-18, z: CAM.z-9, len: 2.2, r: 0.07, rotY: 2.2, rotZ: -0.04 },
      { x: CAM.x+26, z: CAM.z-22, len: 4.5, r: 0.13, rotY: 1.1, rotZ: 0.05 },
    ];
    for (const L of logs){
      const y = fine.sample(L.x, L.z);
      const g = new THREE.CylinderGeometry(L.r*0.7, L.r, L.len, 7, 1);
      const mesh = new THREE.Mesh(g, mat);
      mesh.position.set(L.x, y + L.r*0.6, L.z);
      mesh.rotation.set(Math.PI/2 + L.rotZ, L.rotY, 0);
      scene.add(mesh);
    }
  }

  // ── mist & snow plumes ────────────────────────────────────────────────────
  await tick('breathing mist…', 0.94);
  function mistField(count, place, gain, wrapX0, wrapSpan){
    const base = new THREE.PlaneGeometry(2, 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index; geo.attributes = base.attributes;
    geo.instanceCount = count;
    const centers = new Float32Array(count*3);
    const params = new Float32Array(count*4);
    for (let i=0;i<count;i++) place(i, centers, params);
    geo.setAttribute('aCenter', new THREE.InstancedBufferAttribute(centers, 3));
    geo.setAttribute('aParam', new THREE.InstancedBufferAttribute(params, 4));
    const mat = new THREE.ShaderMaterial({
      uniforms: withU({ uMistGain: { value: gain }, uWrapX: { value: new THREE.Vector2(wrapX0, wrapSpan) } }),
      vertexShader: SH.mistVert(COMMON), fragmentShader: SH.mistFrag(COMMON),
      transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.userData.noRefr = true;
    return mesh;
  }
  const mrng = mulberry32(777);
  scene.add(mistField(MIST_COUNT, (i, c, p) => {
    const x = CAM.x - 200 + Math.pow(mrng(), 0.7)*1900;
    const m = meanderC(x);
    c[i*3]=x; c[i*3+1]=2.0+mrng()*9.0; c[i*3+2]=m+(mrng()-0.5)*150;
    p[i*4]=50+mrng()*130; p[i*4+1]=8+mrng()*18; p[i*4+2]=mrng()*10; p[i*4+3]=1.2+mrng()*2.2;
  }, 0.10, CAM.x-260, 2100));
  // wind-blown snow plumes along high ridges
  {
    const peaks = [];
    for (let t=0; t<4000 && peaks.length < PLUME_COUNT; t++){
      const x = (mrng()*2-1)*3200;
      const z = (mrng()*2-1)*3800;
      const y = coarse.sample(x, z);
      if (y > 1450 && (peaks.length===0 || peaks.every(p => Math.hypot(p.x-x, p.z-z) > 500))) peaks.push({x, z, y});
    }
    scene.add(mistField(peaks.length, (i, c, p) => {
      const pk = peaks[i];
      c[i*3]=pk.x; c[i*3+1]=pk.y+25+mrng()*30; c[i*3+2]=pk.z;
      p[i*4]=90+mrng()*120; p[i*4+1]=14+mrng()*18; p[i*4+2]=mrng()*10; p[i*4+3]=1.0+mrng()*1.5;
    }, 0.30, -3600, 7200));
  }

  // ── drifting motes (pollen low / snow crystals) & insects ────────────────
  const moteCenterU = { value: new THREE.Vector3(CAM.x, 4.5, CAM.z - 25) };
  {
    const prng = mulberry32(424242);
    const pos = new Float32Array(MOTE_COUNT*3);
    const seed = new Float32Array(MOTE_COUNT);
    for (let i=0;i<MOTE_COUNT;i++){
      pos[i*3]   = CAM.x + (prng()*2-1)*60;
      pos[i*3+1] = WATER_Y + 0.3 + prng()*8;
      pos[i*3+2] = CAM.z + (prng()*2-1)*60 - 25;
      seed[i] = prng();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const motes = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: withU({ uMoteCenter: moteCenterU }),
      vertexShader: SH.moteVert(COMMON), fragmentShader: SH.moteFrag(COMMON),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    motes.frustumCulled = false; motes.renderOrder = 3; motes.userData.noRefr = true;
    scene.add(motes);

    const ipos = new Float32Array(INSECT_COUNT*3);
    const iseed = new Float32Array(INSECT_COUNT);
    let n = 0, tries = 0;
    while (n < INSECT_COUNT && tries++ < 2400){
      const x = CAM.x + (prng()*2-1)*42;
      const z = CAM.z + (prng()*2-1)*42 - 12;
      const y = fine.sample(x, z);
      if (y > WATER_Y+0.8 || y < WATER_Y-1.2) continue;
      ipos[n*3]=x; ipos[n*3+1]=WATER_Y+0.25+prng()*1.1; ipos[n*3+2]=z;
      iseed[n]=prng(); n++;
    }
    const igeo = new THREE.BufferGeometry();
    igeo.setAttribute('position', new THREE.BufferAttribute(ipos.slice(0, n*3), 3));
    igeo.setAttribute('aSeed', new THREE.BufferAttribute(iseed.slice(0, n), 1));
    const insects = new THREE.Points(igeo, new THREE.ShaderMaterial({
      uniforms: withU({}), vertexShader: SH.insectVert(COMMON), fragmentShader: SH.insectFrag(COMMON),
      transparent: true, depthWrite: false }));
    insects.frustumCulled = false; insects.renderOrder = 3; insects.userData.noRefr = true;
    scene.add(insects);
  }

  // ── birds circling over the valley ────────────────────────────────────────
  {
    const brng = mulberry32(606);
    const geo = new THREE.PlaneGeometry(1, 0.34).rotateX(-Math.PI/2);
    const mat = new THREE.ShaderMaterial({
      uniforms: withU({}), vertexShader: SH.birdVert(COMMON), fragmentShader: SH.birdFrag(COMMON),
      side: THREE.DoubleSide });
    const { mesh, offsets, params } = instanced(geo, 10, mat);
    for (let i = 0; i < 10; i++){
      const cx = CAM.x - 80 + brng()*520;
      const cz = meanderC(cx) + (brng()-0.5)*240;
      const cy = Math.max(coarse.sample(cx, cz) + 40, 45) + brng()*90;
      offsets[i*3]=cx; offsets[i*3+1]=cy; offsets[i*3+2]=cz;
      params[i*4]   = 25 + brng()*60;                            // orbit radius
      params[i*4+1] = (brng() < 0.5 ? -1 : 1)*(0.06 + brng()*0.10);
      params[i*4+2] = brng()*Math.PI*2;
      params[i*4+3] = 0.7 + brng()*0.5;                          // wingspan
    }
    mesh.userData.noRefr = true;
    scene.add(mesh);
  }

  // ── fish-rise rings on calm pools ─────────────────────────────────────────
  {
    const rrng = mulberry32(909);
    const spots = [];
    for (let i = 0; i < 6000 && spots.length < 12; i++){
      const x = CAM.x - 80 + rrng()*260;
      const z = meanderC(x) + (rrng()*2 - 1)*halfWidth(x)*0.8;
      if (fine.sample(x, z) < WATER_Y - 0.5 && slopeAt(x, z) < 0.15) spots.push({ x, z });
    }
    if (spots.length){
      const geo = new THREE.PlaneGeometry(1, 1);
      const mat = new THREE.ShaderMaterial({
        uniforms: withU({}), vertexShader: SH.ringVert(COMMON), fragmentShader: SH.ringFrag(COMMON),
        transparent: true, depthWrite: false });
      const { mesh, offsets, params } = instanced(geo, spots.length, mat);
      spots.forEach((s, i) => {
        offsets[i*3]=s.x; offsets[i*3+1]=WATER_Y + 0.015; offsets[i*3+2]=s.z;
        params[i*4]=2.2 + rrng()*1.8; params[i*4+1]=rrng()*10; params[i*4+2]=0.10 + rrng()*0.08; params[i*4+3]=0;
      });
      mesh.renderOrder = 2;
      mesh.userData.noRefr = true;
      scene.add(mesh);
    }
  }

  // ── splash droplets where the river is lively ─────────────────────────────
  {
    const srng = mulberry32(8088);
    const anchors = [];
    for (let x = CAM.x - 120; x < CAM.x + 220 && anchors.length < 420; x += 1.6){
      const m = meanderC(x);
      for (const side of [-1, 1]){
        for (let d = 6; d < 140; d += 1.8){
          const z = m + side*d;
          const y = fine.sample(x, z);
          if (y > WATER_Y - 0.05){
            if (y < WATER_Y + 0.06){
              const rapid = clamp(slopeAt(x, z)*2.0, 0, 1);
              if (srng() < 0.20 + rapid*0.55){
                anchors.push({ x: x + (srng()-0.5), z: z + (srng()-0.5),
                  rate: 0.5 + srng()*0.9, h: 0.05 + rapid*0.22 + srng()*0.06, spread: 0.15 + srng()*0.4 });
              }
            }
            break;
          }
        }
      }
    }
    for (const b of boulders){
      if (b.y > WATER_Y - 0.6 && b.y < WATER_Y + 0.1 && anchors.length < 500){
        for (let k = 0; k < 6; k++){
          const a = srng()*Math.PI*2;
          anchors.push({ x: b.x + Math.cos(a)*b.s*1.1, z: b.z + Math.sin(a)*b.s*1.1,
            rate: 0.7 + srng()*0.9, h: 0.10 + srng()*0.18, spread: 0.2 + srng()*0.4 });
        }
      }
    }
    if (anchors.length){
      const pos = new Float32Array(anchors.length*3);
      const par = new Float32Array(anchors.length*4);
      anchors.forEach((s, i) => {
        pos[i*3]=s.x; pos[i*3+1]=WATER_Y + 0.03; pos[i*3+2]=s.z;
        par[i*4]=srng()*100; par[i*4+1]=s.rate; par[i*4+2]=s.h; par[i*4+3]=s.spread;
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aParam', new THREE.BufferAttribute(par, 4));
      const splashes = new THREE.Points(geo, new THREE.ShaderMaterial({
        uniforms: withU({}), vertexShader: SH.splashVert(COMMON), fragmentShader: SH.splashFrag(COMMON),
        transparent: true, depthWrite: false }));
      splashes.frustumCulled = false; splashes.renderOrder = 3; splashes.userData.noRefr = true;
      scene.add(splashes);
    }
  }

  // ── trees: branching archetypes, moisture-sorted, grown per season ───────
  await tick('seeding forests…', 0.97);
  {
    const trng = mulberry32(4242);
    const arch = ARCHETYPES.map(A => ({ ...makeTreeGeometry(A.seed, A.P), A, list: [] }));
    const [SPRUCE, FIR, PINE, SAPLING] = [0, 1, 2, 3];

    let placed = 0, tries = 0;
    while (placed < 1300 && tries++ < 60000){
      const x = (trng()*2 - 1)*690;
      const z = 60 + (trng()*2 - 1)*690;
      if (Math.hypot(x - CAM.x, z - CAM.z) < 13) continue;
      const y = fine.sample(x, z);
      if (y < WATER_Y + 0.55 || y > WATER_Y + 58) continue;
      if (slopeAt(x, z) > 0.42) continue;
      vnoised(x*0.012 + 5, z*0.012 + 5);
      if (ND_n < 0.45) continue;   // groves with meadow gaps
      const k = y < 2.5 ? (trng() < 0.6 ? PINE : FIR)               // valley floor
              : y > 14 ? (trng() < 0.6 ? SPRUCE : FIR)              // subalpine slopes
              : (trng() < 0.5 ? PINE : SPRUCE);                     // mid elevation
      arch[k].list.push({ x, y, z, s: 0.7 + Math.pow(trng(), 1.4)*0.75,
        yaw: trng()*Math.PI*2, seed: trng()*100, dly: trng() });
      placed++;
    }
    // sapling understory, looser and closer to the water
    tries = 0;
    while (arch[SAPLING].list.length < 900 && tries++ < 50000){
      const x = (trng()*2 - 1)*690;
      const z = 60 + (trng()*2 - 1)*690;
      if (Math.hypot(x - CAM.x, z - CAM.z) < 6) continue;
      const y = fine.sample(x, z);
      if (y < WATER_Y + 0.4 || y > WATER_Y + 35) continue;
      if (slopeAt(x, z) > 0.45) continue;
      vnoised(x*0.02 + 9, z*0.02 + 9);
      if (ND_n < 0.40) continue;
      arch[SAPLING].list.push({ x, y, z, s: 0.6 + trng()*0.9,
        yaw: trng()*Math.PI*2, seed: trng()*100, dly: trng() });
    }

    for (const a of arch){
      if (!a.list.length) continue;
      const woodMat = new THREE.ShaderMaterial({
        uniforms: withU({
          uBarkA: { value: new THREE.Vector3(...a.A.bark) },
          uBarkB: { value: new THREE.Vector3(...a.A.bark2) },
        }),
        vertexShader: SH.treeWoodVert(COMMON), fragmentShader: SH.treeWoodFrag(COMMON) });
      const leafMat = new THREE.ShaderMaterial({
        uniforms: withU({}), vertexShader: SH.treeLeafVert(COMMON),
        fragmentShader: SH.treeLeafFrag(COMMON), side: THREE.DoubleSide });
      for (const [geo, mat] of [[a.woodGeo, woodMat], [a.leafGeo, leafMat]]){
        const { mesh, offsets, params } = instanced(geo, a.list.length, mat);
        a.list.forEach((tr, i) => {
          offsets[i*3]=tr.x; offsets[i*3+1]=tr.y - 0.04; offsets[i*3+2]=tr.z;
          params[i*4]=tr.s; params[i*4+1]=tr.yaw; params[i*4+2]=tr.seed; params[i*4+3]=tr.dly;
        });
        mesh.userData.noRefr = true;
        scene.add(mesh);
      }
    }

    // evergreen conifers: no autumn leaf-fall — needles persist through winter
  }

  // ── the lush island: dense grass, ferns and flowers, all forced vivid green ─
  await tick('greening the island…', 0.985);
  {
    const irng = mulberry32(20240628);
    // scatter `count` instances over the island disc, calling place(i,x,y,z)
    function scatter(count, tries, yMin, place){
      let n = 0, t = 0;
      while (n < count && t++ < tries){
        const a = irng()*Math.PI*2, rr = Math.pow(irng(), 0.7)*ISL.R*1.04;
        const x = ISL.x + Math.cos(a)*rr, z = ISL.z + Math.sin(a)*rr;
        const y = fine.sample(x, z);
        if (y < WATER_Y + yMin) continue;
        if (slopeAt(x, z) > 0.9) continue;
        place(n, x, y, z); n++;
      }
      return n;
    }

    // tall lush grass
    {
      const segs = 3, w0 = 0.05, bp = [], bn = [], bi = [];
      for (let s=0;s<=segs;s++){ const t=s/segs, w=w0*(1-t*0.85); bp.push(-w,t,0, w,t,0); bn.push(0,0,1, 0,0,1); }
      for (let s=0;s<segs;s++){ const a=s*2; bi.push(a,a+1,a+2, a+1,a+3,a+2); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bp), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(bn), 3));
      g.setIndex(bi);
      const mat = new THREE.ShaderMaterial({ uniforms: withU({ uLush: { value: 1 } }),
        vertexShader: SH.grassVert(COMMON), fragmentShader: SH.grassFrag(COMMON), side: THREE.DoubleSide });
      const { mesh, offsets, params } = instanced(g, 16000, mat);
      const n = scatter(16000, 200000, 0.16, (i,x,y,z) => {
        offsets[i*3]=x; offsets[i*3+1]=y-0.01; offsets[i*3+2]=z;
        params[i*4]=0.22+irng()*0.42; params[i*4+1]=irng()*Math.PI*2; params[i*4+2]=irng()*20; params[i*4+3]=irng();
      });
      mesh.geometry.instanceCount = n; mesh.userData.noRefr = true; scene.add(mesh);
    }
    // arching ferns
    {
      const g = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
      const mat = new THREE.ShaderMaterial({ uniforms: withU({ uLush: { value: 1 } }),
        vertexShader: SH.fernVert(COMMON), fragmentShader: SH.fernFrag(COMMON), side: THREE.DoubleSide });
      const { mesh, offsets, params } = instanced(g, 1000, mat);
      const n = scatter(1000, 40000, 0.2, (i,x,y,z) => {
        offsets[i*3]=x; offsets[i*3+1]=y; offsets[i*3+2]=z;
        params[i*4]=1.0+irng()*1.2; params[i*4+1]=irng()*Math.PI*2; params[i*4+2]=irng()*20; params[i*4+3]=0.35+irng()*0.65;
      });
      mesh.geometry.instanceCount = n; mesh.userData.noRefr = true; scene.add(mesh);
    }
    // wildflowers for colour
    {
      const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI/2).translate(0, 1.0, 0);
      const mat = new THREE.ShaderMaterial({ uniforms: withU({}),
        vertexShader: SH.flowerVert(COMMON), fragmentShader: SH.flowerFrag(COMMON), side: THREE.DoubleSide });
      const { mesh, offsets, params } = instanced(g, 500, mat);
      const n = scatter(500, 20000, 0.22, (i,x,y,z) => {
        offsets[i*3]=x; offsets[i*3+1]=y; offsets[i*3+2]=z;
        params[i*4]=0.06+irng()*0.07; params[i*4+1]=irng()*Math.PI*2; params[i*4+2]=irng()*20; params[i*4+3]=irng();
      });
      mesh.geometry.instanceCount = n; mesh.userData.noRefr = true; scene.add(mesh);
    }
  }

  // ── the rickety plank bridge: shore → out across the water → onto the island ─
  await tick('lashing the bridge…', 0.99);
  {
    const bpos = [], bnrm = [], bwood = [], bidx = [];
    const V = THREE.Vector3;
    // an oriented box: centre c, with three half-extent vectors hx,hy,hz
    function addBox(c, hx, hy, hz, seed, kind){
      const faces = [[hx,hy,hz],[hx.clone().negate(),hz,hy],[hy,hz,hx],
                     [hy.clone().negate(),hx,hz],[hz,hx,hy],[hz.clone().negate(),hy,hx]];
      for (const [nv,uv,vv] of faces){
        const nn = nv.clone().normalize();
        const base = bpos.length/3;
        for (const [su,sv] of [[-1,-1],[1,-1],[1,1],[-1,1]]){
          const p = c.clone().add(nv).addScaledVector(uv, su).addScaledVector(vv, sv);
          bpos.push(p.x,p.y,p.z); bnrm.push(nn.x,nn.y,nn.z); bwood.push(seed, kind);
        }
        bidx.push(base,base+1,base+2, base,base+2,base+3);
      }
    }

    const brng = mulberry32(8888);
    const head = new THREE.Vector2(HEAD.x, HEAD.z).normalize();
    const perp = new THREE.Vector2(-head.y, head.x);
    const dShore = crossD - 3;                       // anchored on the near bank
    const dEnd   = crossD + 33 - ISL.R*0.5;          // lands just onto the island
    const span   = Math.max(dEnd - dShore, 12);
    const HALFW  = 1.05;                             // deck half-width
    const ptAt = (d, lat) => {
      const x = CAM.x + head.x*d + perp.x*lat;
      const z = CAM.z + head.y*d + perp.y*lat;
      return { x, z };
    };
    const shoreP = ptAt(dShore, 0);
    const shoreY = fine.sample(shoreP.x, shoreP.z);
    const endP = ptAt(dEnd, 0);
    const endY = fine.sample(endP.x, endP.z);
    const deckAt = (u) => {
      const d = dShore + span*u;
      const lat = 0.45*Math.sin(u*7.0 + 1.3) + 0.25*Math.sin(u*3.0);   // rickety lateral wander
      const p = ptAt(d, lat);
      const ground = fine.sample(p.x, p.z);
      const arc = lerp(shoreY + 0.35, endY + 0.25, u) - 0.55*Math.sin(Math.PI*u);  // gentle sag
      const y = Math.max(arc, WATER_Y + 0.75, ground + 0.06);
      return { x: p.x, y, z: p.z };
    };

    // deck centreline samples → tangents
    const NSEG = Math.max(18, Math.round(span/0.55));
    const path = [];
    for (let s=0;s<=NSEG;s++) path.push(deckAt(s/NSEG));
    const tangentAt = (s) => {
      const a = path[Math.max(0,s-1)], b = path[Math.min(NSEG,s+1)];
      return new V(b.x-a.x, b.y-a.y, b.z-a.z).normalize();
    };

    // two side stringer beams running the length
    for (const side of [-1, 1]){
      for (let s=0;s<NSEG;s++){
        const a = path[s], b = path[s+1];
        const fwd = new V(b.x-a.x, b.y-a.y, b.z-a.z);
        const segLen = fwd.length(); fwd.normalize();
        const right = new V().crossVectors(new V(0,1,0), fwd).normalize();
        const up = new V().crossVectors(fwd, right).normalize();
        const cx = (a.x+b.x)/2 + right.x*side*HALFW;
        const cy = (a.y+b.y)/2 - 0.12 + right.y*side*HALFW;
        const cz = (a.z+b.z)/2 + right.z*side*HALFW;
        addBox(new V(cx,cy,cz), fwd.clone().multiplyScalar(segLen*0.5),
          up.clone().multiplyScalar(0.085), right.clone().multiplyScalar(0.05), brng()*9.0, 0);
      }
    }

    // cross planks, some tilted, a few missing → rickety
    const NPLANK = Math.round(span/0.42);
    for (let k=0;k<NPLANK;k++){
      if (brng() < 0.07) continue;                  // a missing plank
      const u = (k+0.5)/NPLANK;
      const s = Math.min(NSEG, Math.round(u*NSEG));
      const c = deckAt(u);
      const fwd = tangentAt(s);
      let right = new V().crossVectors(new V(0,1,0), fwd).normalize();
      let up = new V().crossVectors(fwd, right).normalize();
      const roll = (brng()-0.5)*0.18, tip = (brng()-0.5)*0.12;       // each plank sits crooked
      up.applyAxisAngle(fwd, roll).normalize();
      right.applyAxisAngle(fwd, roll).normalize();
      const fwd2 = fwd.clone().applyAxisAngle(right, tip).normalize();
      const cy = c.y + (brng()-0.5)*0.04;
      addBox(new V(c.x, cy, c.z),
        right.clone().multiplyScalar(HALFW + 0.12),
        up.clone().multiplyScalar(0.035),
        fwd2.clone().multiplyScalar(0.17*(0.8 + brng()*0.4)), brng()*9.0, 0);
    }

    // posts + rope handrails at intervals
    const railPts = { '-1': [], '1': [] };
    const POSTS = Math.max(3, Math.round(span/3.4));
    for (let pI=0; pI<=POSTS; pI++){
      const u = pI/POSTS;
      const s = Math.min(NSEG, Math.round(u*NSEG));
      const c = deckAt(u);
      const fwd = tangentAt(s);
      const right = new V().crossVectors(new V(0,1,0), fwd).normalize();
      for (const side of [-1, 1]){
        const ex = c.x + right.x*side*HALFW, ez = c.z + right.z*side*HALFW;
        const bed = fine.sample(ex, ez);
        const top = c.y + 0.92 + brng()*0.22;       // uneven post heights
        const bot = Math.min(bed - 0.3, c.y - 0.2);
        const lean = new V((brng()-0.5)*0.12, 1, (brng()-0.5)*0.12).normalize();  // posts lean
        const mid = new V((ex+ex)/2 + lean.x*0.1, (top+bot)/2, (ez+ez)/2 + lean.z*0.1);
        addBox(mid, new V(0.06,0,0), lean.clone().multiplyScalar((top-bot)/2), new V(0,0,0.06), brng()*9.0, 1);
        railPts[side].push(new V(ex, top, ez));
      }
    }
    // rope rails sag between post tops
    for (const side of [-1, 1]){
      const pts = railPts[side];
      for (let i=0;i<pts.length-1;i++){
        const a = pts[i], b = pts[i+1];
        const SUB = 5;
        let prev = a.clone();
        for (let q=1;q<=SUB;q++){
          const tt = q/SUB;
          const sag = Math.sin(Math.PI*tt)*0.28;     // catenary droop
          const cur = a.clone().lerp(b, tt); cur.y -= sag;
          const mid = prev.clone().lerp(cur, 0.5);
          const dir = cur.clone().sub(prev); const L = dir.length(); dir.normalize();
          const right = new V().crossVectors(new V(0,1,0), dir).normalize();
          const up = new V().crossVectors(dir, right).normalize();
          addBox(mid, dir.clone().multiplyScalar(L*0.5),
            up.clone().multiplyScalar(0.028), right.clone().multiplyScalar(0.028), brng()*9.0, 2);
          prev = cur;
        }
      }
    }

    const bgeo = new THREE.BufferGeometry();
    bgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bpos), 3));
    bgeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(bnrm), 3));
    bgeo.setAttribute('aWood', new THREE.BufferAttribute(new Float32Array(bwood), 2));
    bgeo.setIndex(bidx);
    const bmat = new THREE.ShaderMaterial({ uniforms: withU({}),
      vertexShader: SH.bridgeVert, fragmentShader: SH.bridgeFrag(COMMON), side: THREE.DoubleSide });
    const bridge = new THREE.Mesh(bgeo, bmat);
    bridge.frustumCulled = false;
    scene.add(bridge);
  }

  // ── post pipeline ─────────────────────────────────────────────────────────
  const sceneRT = new THREE.WebGLRenderTarget(innerWidth, innerHeight, {
    type: THREE.HalfFloatType, samples: 4 });
  const postScene = new THREE.Scene();
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const postMat = new THREE.ShaderMaterial({
    uniforms: { tScene: { value: sceneRT.texture }, uExposure: { value: 1.1 }, uT: { value: 0 } },
    vertexShader: SH.postVert, fragmentShader: SH.postFrag, depthTest: false, depthWrite: false });
  postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat));

  // ── controls: free mouse-look, no click needed ────────────────────────────
  // Cursor position maps to view direction: screen left↔right sweeps ~320° of
  // yaw around the start view, top↔bottom pitches. Smoothed in the frame loop.
  const qs = new URLSearchParams(location.search);
  const yaw0 = qs.has('yaw') ? parseFloat(qs.get('yaw')) : -0.28;  // down-river toward the sun
  const pitch0 = qs.has('pitch') ? parseFloat(qs.get('pitch')) : -0.045;
  let yaw = yaw0, pitch = pitch0;
  let targetYaw = yaw, targetPitch = pitch;
  let yawBase = yaw0;            // grows while the cursor rests near a screen edge → full 360°
  let mouseNX = 0, mouseNY = 0;
  addEventListener('mousemove', e => {
    mouseNX = e.clientX/Math.max(innerWidth, 1) - 0.5;
    mouseNY = e.clientY/Math.max(innerHeight, 1) - 0.5;
  });

  // ── player: walk the heightfield, gravity, jump ───────────────────────────
  const EYE = 1.62;
  const player = { x: CAM.x, z: CAM.z, y: CAM.y + 0.2, vy: 0, grounded: false };
  function groundAt(x, z){
    if (Math.abs(x - fine.cx) < fine.half - 3 && Math.abs(z - fine.cz) < fine.half - 3) return fine.sample(x, z);
    return coarse.sample(x, z);
  }
  const keys = Object.create(null);
  addEventListener('keydown', e => {
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    keys[e.code] = true;
    if (e.code === 'Space' && player.grounded){ player.vy = 7.4; player.grounded = false; }
  });
  addEventListener('keyup', e => { keys[e.code] = false; });

  // ── timelapse: one sun arc = two seasons; full cycle = two days ───────────
  // day 1: winter sunrise → spring → summer · night 1: summer stars
  // day 2: summer → autumn (leaves fall) → winter · night 2: winter stars
  const CYCLE = qs.has('cycle') ? parseFloat(qs.get('cycle')) : 110;
  let seasonClock = qs.has('tt') ? parseFloat(qs.get('tt')) : CYCLE*0.026; // start at sunrise, like the original scene
  let timeOn = !qs.has('freeze');
  addEventListener('keydown', e => { if (e.code === 'KeyP') timeOn = !timeOn; });
  let exposureBase = 1.15;
  const _c = new THREE.Vector3();
  function lerpSet(out, ax, ay, az, bx, by, bz, t){
    out.set(ax + (bx - ax)*t, ay + (by - ay)*t, az + (bz - az)*t);
  }
  function updateDayNight(sc){
    const T = ((sc/CYCLE) % 1 + 1) % 1;
    const half = T < 0.5 ? 0 : 1;
    const local = (T*2) % 1;
    let p, el, az;
    if (local < 0.8){ p = local/0.8; el = -4 + 60*Math.sin(Math.PI*p); az = 10 + 160*p; }
    else { p = (local - 0.8)/0.2; el = -4 - 16*Math.sin(Math.PI*p); az = 170 + 200*p; }
    const season = half*2 + (local < 0.8 ? Math.min(p*2, 2) : 2);

    const er = el*Math.PI/180, ar = az*Math.PI/180;
    SUN_DIR.set(Math.cos(er)*Math.cos(ar), Math.sin(er), Math.cos(er)*Math.sin(ar));

    const sinEl = Math.sin(er);
    const elN = clamp(el/60, 0, 1);
    const dayF = sstep(-0.05, 0.06, sinEl);

    // blend morning/evening shadow bakes; high sun ≈ unshadowed
    const lowSun = (1 - sstep(20, 45, el)) * dayF;
    U.uVisW.value.set(lowSun*(1 - sstep(70, 110, az)), lowSun*sstep(70, 110, az));

    // light palettes: warm at the horizons, neutral at noon, starlit at night
    lerpSet(_c, 1.0, 0.40, 0.16, 1.0, 0.93, 0.82, sstep(0.06, 0.5, elN));
    U.uSunColor.value.copy(_c).multiplyScalar(10.5*dayF*(0.55 + 0.42*elN));
    lerpSet(_c, 0.21, 0.36, 0.65, 0.30, 0.49, 0.85, elN);
    lerpSet(U.uSkyZenith.value, 0.010, 0.014, 0.030, _c.x, _c.y, _c.z, dayF);
    lerpSet(_c, 0.46, 0.55, 0.72, 0.58, 0.68, 0.82, elN);
    lerpSet(U.uHorizonCold.value, 0.014, 0.018, 0.040, _c.x, _c.y, _c.z, dayF);
    lerpSet(_c, 1.16, 0.55, 0.22, 0.92, 0.88, 0.86, sstep(0.2, 0.6, elN));
    lerpSet(U.uHorizonWarm.value, 0.030, 0.020, 0.030, _c.x, _c.y, _c.z, dayF);
    U.uGroundBounce.value.set(0.10, 0.085, 0.07).multiplyScalar(0.12 + 0.88*dayF*(0.4 + 0.6*elN));

    // season curves
    U.uSeasonT.value = season;
    U.uGreen.value  = sstep(0.35, 1.35, season)*(1 - sstep(2.45, 3.05, season));
    U.uAutumn.value = sstep(2.35, 2.95, season)*(1 - sstep(3.55, 3.95, season));
    U.uBloom.value  = 0.35 + 1.15*sstep(0.8, 1.5, season)*(1 - sstep(2.1, 2.7, season));
    U.uSnowUp.value = 560*sstep(0.5, 1.6, season)*(1 - sstep(2.5, 3.5, season));

    exposureBase = (1.15 - 0.24*elN*dayF) + 2.1*(1 - dayF);   // eyes adapt: stop down at noon, open at night
  }

  window.__dbg = { player, keys, camera, view: () => ({ yaw, pitch }), season: () => U.uSeasonT.value };

  addEventListener('resize', () => {
    camera.aspect = innerWidth/innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    const pr = renderer.getPixelRatio();
    sceneRT.setSize(innerWidth*pr, innerHeight*pr);
    refrRT.setSize((innerWidth*pr*0.75)|0, (innerHeight*pr*0.75)|0);
    waterMat.uniforms.uResolution.value.set(innerWidth*pr, innerHeight*pr);
  });
  // size RTs to drawing-buffer pixels
  {
    const pr = renderer.getPixelRatio();
    sceneRT.setSize(innerWidth*pr, innerHeight*pr);
    refrRT.setSize((innerWidth*pr*0.75)|0, (innerHeight*pr*0.75)|0);
    waterMat.uniforms.uResolution.value.set(innerWidth*pr, innerHeight*pr);
  }

  await tick('first light…', 1.0);

  // ── frame loop ────────────────────────────────────────────────────────────
  const fwd = new THREE.Vector3();
  let exposure = 1.1;
  const t0 = performance.now();
  let hidden = [];
  function setRefrPass(on){
    if (on){
      hidden = [];
      scene.traverse(o => {
        if (o.userData && o.userData.noRefr && o.visible){ o.visible = false; hidden.push(o); }
      });
      water.visible = false;
    } else {
      for (const o of hidden) o.visible = true;
      water.visible = true;
    }
  }

  let frames = 0, fpsT = performance.now();
  const fpsProbe = qs.has('fps');
  let lastT = performance.now();
  let bobPhase = 0, bobAmp = 0;
  renderer.setAnimationLoop(() => {
    if (fpsProbe && ++frames % 120 === 0){
      const now2 = performance.now();
      console.log('FPS', (120000/(now2 - fpsT)).toFixed(1));
      fpsT = now2;
    }
    const now = performance.now();
    const t = (now - t0)/1000;
    const dt = Math.min((now - lastT)/1000, 0.05);
    lastT = now;
    U.uTime.value = t;
    postMat.uniforms.uT.value = t;
    if (timeOn) seasonClock += dt;
    updateDayNight(seasonClock);

    // ease the view toward where the mouse points; cursor held near the left or
    // right screen edge keeps rotating, so you can spin a full 360°
    const edge = Math.max(0, Math.abs(mouseNX) - 0.38)/0.12;
    yawBase += Math.sign(mouseNX)*Math.min(edge*edge, 1)*2.8*dt;
    targetYaw = yawBase + mouseNX*3.6;
    targetPitch = clamp(pitch0 - mouseNY*2.4, -1.40, 1.40);
    yaw   += (targetYaw - yaw)*Math.min(dt*8, 1);
    pitch += (targetPitch - pitch)*Math.min(dt*8, 1);

    // walk: WASD / arrows, shift to sprint, slower wading in the river
    let mx = 0, mz = 0;
    if (keys.KeyW || keys.ArrowUp)   { mx += Math.cos(yaw); mz += Math.sin(yaw); }
    if (keys.KeyS || keys.ArrowDown) { mx -= Math.cos(yaw); mz -= Math.sin(yaw); }
    if (keys.KeyD || keys.ArrowRight){ mx -= Math.sin(yaw); mz += Math.cos(yaw); }
    if (keys.KeyA || keys.ArrowLeft) { mx += Math.sin(yaw); mz -= Math.cos(yaw); }
    const ml = Math.hypot(mx, mz);
    let speed = 0;
    if (ml > 0){
      speed = (keys.ShiftLeft || keys.ShiftRight) ? 8.0 : 3.6;
      if (groundAt(player.x, player.z) < WATER_Y - 0.05) speed *= 0.45;
      player.x += mx/ml*speed*dt;
      player.z += mz/ml*speed*dt;
    }

    // gravity, landing, downhill ground-stick
    player.vy -= 22*dt;
    player.y += player.vy*dt;
    const floor = groundAt(player.x, player.z) + EYE;
    if (player.y <= floor){
      player.y = floor; player.vy = 0; player.grounded = true;
    } else if (player.grounded && player.vy <= 0 && player.y - floor < 0.7){
      player.y = floor; player.vy = 0;
    } else {
      player.grounded = false;
    }

    // head bob while walking + idle breathing
    const moving = ml > 0 && player.grounded;
    bobAmp += ((moving ? 0.045 : 0) - bobAmp)*Math.min(dt*8, 1);
    bobPhase += speed*dt*2.2;
    const bobY = Math.sin(bobPhase)*bobAmp + Math.sin(t*0.45)*0.012;

    camera.position.set(player.x, player.y + bobY, player.z);
    fwd.set(Math.cos(yaw)*Math.cos(pitch), Math.sin(pitch), Math.sin(yaw)*Math.cos(pitch));
    camera.lookAt(camera.position.x + fwd.x, camera.position.y + fwd.y, camera.position.z + fwd.z);
    moteCenterU.value.set(player.x, Math.max(player.y, 3.0), player.z);

    // adaptive exposure: stop down toward the sun, open up at night
    const facing = Math.max(fwd.dot(SUN_DIR), 0);
    const target = exposureBase / (1 + 2.2*Math.pow(facing, 3));
    exposure += (target - exposure) * 0.04;
    postMat.uniforms.uExposure.value = exposure;

    // pass 1: refraction source (no water, no overlay transparents)
    setRefrPass(true);
    renderer.setRenderTarget(refrRT);
    renderer.render(scene, camera);
    setRefrPass(false);

    // pass 2: full scene, linear HDR
    renderer.setRenderTarget(sceneRT);
    renderer.render(scene, camera);

    // pass 3: tonemap to screen
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCam);
  });

  const load = document.getElementById('load');
  load.style.opacity = '0';
  setTimeout(() => load.remove(), 1400);
}

init().catch(e => {
  document.getElementById('err').textContent += 'init: ' + e.message + '\n' + (e.stack || '');
});
