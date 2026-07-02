// Procedural conifers: a straight central leader with whorls of drooping
// branches swept into tapered tubes, clothed in flat needle-spray "frond" cards
// that radiate along each limb (bottlebrush) and are textured as fishbone
// needle combs in the shader. Four evergreen archetypes, each generated at
// three levels of detail and instanced by distance. Geometry is in tree-local
// meters with the root at the origin.
import * as THREE from 'three';

function mulberry32(seed){
  let a = seed >>> 0;
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0)/4294967296;
  };
}

function orthogonal(v){
  const a = Math.abs(v.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  return new THREE.Vector3().crossVectors(v, a).normalize();
}

// Quality tiers: as detail drops, fronds get fewer but larger (and the needle
// comb in the shader softens with distance), so the crown volume reads the
// same while the triangle count falls by an order of magnitude per tier.
const LODS = [
  { dens: 0.62, aroundMain: 2, aroundSub: 2, levelCap: 1, childMul: 1.0,   // hero, < ~90 m
    whorlMul: 1.0,  perWhorlMul: 1.0,  fLen: 1.35, fWid: 1.55,
    trunkSides: 6, trunkSegs: 8, branchSides: 3, branchSegs: 3, childSegs: 2, childTubes: true,  spire: 9 },
  { dens: 0.34, aroundMain: 2, aroundSub: 1, levelCap: 1, childMul: 0.6,   // mid-ground
    whorlMul: 0.85, perWhorlMul: 0.7,  fLen: 1.8,  fWid: 2.1,
    trunkSides: 5, trunkSegs: 6, branchSides: 3, branchSegs: 2, childSegs: 2, childTubes: false, spire: 6 },
  { dens: 0.20, aroundMain: 1, aroundSub: 1, levelCap: 0, childMul: 0,     // distant silhouette
    whorlMul: 0.7,  perWhorlMul: 0.55, fLen: 2.6,  fWid: 3.1,
    trunkSides: 4, trunkSegs: 5, branchSides: 3, branchSegs: 2, childSegs: 2, childTubes: false, spire: 4,
    noLimbTubes: true },                                                   // fronds hide the limbs out here
];

export function makeTreeGeometry(seed, P, lod = 0){
  const Q = LODS[lod];
  const rng = mulberry32(seed + lod*101);
  const wood = { pos: [], nrm: [], idx: [] };
  const leaf = { pos: [], nrm: [], uv: [], cardC: [], sphereN: [], misc: [], occ: [], idx: [] };

  function addTube(pts, r0, r1, sides){
    const base = wood.pos.length/3;
    const n = pts.length;
    const tangents = [];
    for (let i = 0; i < n; i++){
      const a = pts[Math.min(i+1, n-1)], b = pts[Math.max(i-1, 0)];
      tangents.push(new THREE.Vector3().subVectors(a, b).normalize());
    }
    let N = orthogonal(tangents[0]);
    for (let i = 0; i < n; i++){
      N = N.clone().sub(tangents[i].clone().multiplyScalar(N.dot(tangents[i]))).normalize();
      const B = new THREE.Vector3().crossVectors(tangents[i], N);
      const t = i/(n-1);
      const r = Math.max(r0*(1-t) + r1*t, 0.009);
      for (let s = 0; s < sides; s++){
        const a = s/sides*Math.PI*2;
        const rx = N.x*Math.cos(a) + B.x*Math.sin(a);
        const ry = N.y*Math.cos(a) + B.y*Math.sin(a);
        const rz = N.z*Math.cos(a) + B.z*Math.sin(a);
        wood.pos.push(pts[i].x + rx*r, pts[i].y + ry*r, pts[i].z + rz*r);
        wood.nrm.push(rx, ry, rz);
      }
    }
    for (let i = 0; i < n-1; i++) for (let s = 0; s < sides; s++){
      const a = base + i*sides + s, b = base + i*sides + (s+1)%sides;
      wood.idx.push(a, a+sides, b, b, a+sides, b+sides);
    }
  }

  function pointAt(pts, t){
    const f = t*(pts.length-1), i = Math.min(pts.length-2, f|0), u = f-i;
    return pts[i].clone().lerp(pts[i+1], u);
  }
  function dirAt(pts, t){
    const f = t*(pts.length-1), i = Math.min(pts.length-2, f|0);
    return pts[i+1].clone().sub(pts[i]).normalize();
  }
  function coneDir(axis, polar, azim){
    const N = orthogonal(axis), B = new THREE.Vector3().crossVectors(axis, N);
    return axis.clone().multiplyScalar(Math.cos(polar))
      .add(N.multiplyScalar(Math.cos(azim)*Math.sin(polar)))
      .add(B.multiplyScalar(Math.sin(azim)*Math.sin(polar))).normalize();
  }

  // a flat needle-spray card: base at c, extending `len` along `fl`, `wid` across
  // `fw`, tapering toward the tip. UV.y runs base→tip so the shader draws the comb.
  function addFrond(c, fl, fw, len, wid, occ, sn, rnd){
    const base = leaf.pos.length/3;
    const fn = new THREE.Vector3().crossVectors(fl, fw).normalize();
    for (const [uu, vv] of [[-1,0],[1,0],[1,1],[-1,1]]){
      const wfac = wid*0.5*(1.0 - 0.5*vv);
      const px = c.x + fl.x*vv*len + fw.x*uu*wfac;
      const py = c.y + fl.y*vv*len + fw.y*uu*wfac;
      const pz = c.z + fl.z*vv*len + fw.z*uu*wfac;
      leaf.pos.push(px, py, pz);
      leaf.nrm.push(fn.x, fn.y, fn.z);
      leaf.uv.push(uu*0.5 + 0.5, vv);
      leaf.cardC.push(c.x, c.y, c.z);
      leaf.sphereN.push(sn.x, sn.y, sn.z);
      leaf.misc.push(rnd.h, rnd.b, rnd.s, rnd.ph);
      leaf.occ.push(occ);
    }
    leaf.idx.push(base, base+1, base+2, base, base+2, base+3);
  }

  function clotheBranch(pts, level){
    // total polyline length, to scale frond count
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i-1]);
    const count = Math.max(2, Math.round(P.frondDensity*Q.dens*len));
    const around = level === 0 ? Q.aroundMain : Q.aroundSub;
    for (let k = 0; k <= count; k++){
      const t = 0.04 + 0.98*k/count;            // fronds run to the very tip → no bare sticks
      const c = pointAt(pts, t);
      const tau = dirAt(pts, t);
      const fl = tau.clone(); fl.y -= P.frondDroop; fl.normalize();
      const occ = Math.min(Math.hypot(c.x, c.z)/P.crownR, 1.0);
      const sn = new THREE.Vector3(c.x, P.crownR*0.4, c.z);
      if (sn.lengthSq() < 1e-5) sn.set(0, 1, 0); else sn.normalize();
      const tip = 0.7 + 0.4*(1.0 - t);          // fuller near the limb's base
      for (let r = 0; r < around; r++){
        const roll = (r/Math.max(around,1))*Math.PI*2 + rng()*1.4;
        const fw = orthogonal(fl).applyAxisAngle(fl, roll);
        addFrond(c, fl, fw, P.frondLen*Q.fLen*tip*(0.8 + rng()*0.5), P.frondW*Q.fWid*(0.7 + rng()*0.6),
          occ, sn, { h: rng(), b: rng(), s: rng(), ph: rng() });
      }
    }
  }

  function branch(origin, dir, len, rad, level){
    const segs = level === 0 ? Q.branchSegs : Q.childSegs;
    const pts = [origin.clone()];
    let d = dir.clone(), p = origin.clone();
    for (let i = 1; i <= segs; i++){
      d = d.clone();
      d.x += (rng()-0.5)*P.wiggle*0.20;
      d.z += (rng()-0.5)*P.wiggle*0.20;
      d.y -= P.droop*(0.16 + level*0.10);   // sags more toward the tip and on sub-twigs
      d.normalize();
      p = p.clone().addScaledVector(d, len/segs);
      pts.push(p.clone());
    }
    if (level === 0 ? !Q.noLimbTubes : Q.childTubes) addTube(pts, rad, rad*0.28, level === 0 ? Q.branchSides : 3);
    clotheBranch(pts, level);
    const levels = Math.min(P.levels, Q.levelCap);
    if (level < levels){
      const kids = Math.round((P.children + ((rng()*2)|0))*Q.childMul);
      for (let k = 0; k < kids; k++){
        const t = 0.30 + 0.60*(k + rng()*0.6)/kids;
        const sd = coneDir(dirAt(pts, t), 0.55 + rng()*0.45, k*2.39996 + rng()*1.2);
        sd.y -= P.droop*0.35; sd.normalize();
        branch(pointAt(pts, t), sd, len*0.52*(0.7 + rng()*0.4), Math.max(rad*0.45, 0.010), level+1);
      }
    }
  }

  // ── central leader: a near-straight trunk tapering to a spire ──────────────
  const axis = new THREE.Vector3((rng()-0.5)*P.lean, 1, (rng()-0.5)*P.lean).normalize();
  const trunk = [new THREE.Vector3(0, 0, 0)];
  {
    let p = new THREE.Vector3(0, 0, 0), d = axis.clone();
    const segs = Q.trunkSegs;
    for (let i = 1; i <= segs; i++){
      d = d.clone();
      d.x += (rng()-0.5)*P.wiggle*0.05;
      d.z += (rng()-0.5)*P.wiggle*0.05;
      d.normalize();
      p = p.clone().addScaledVector(d, P.height/segs);
      trunk.push(p.clone());
    }
  }
  addTube(trunk, P.radius, P.radius*0.08, Q.trunkSides);

  // ── whorls of branches, length tapering to a cone silhouette ───────────────
  const whorls = Math.max(3, Math.round(P.whorls*Q.whorlMul));
  for (let w = 0; w < whorls; w++){
    const ty = (w + 0.6)/whorls;                            // height fraction up the leader
    const coneR = P.crownR*Math.pow(1 - ty, P.taper);       // cone radius here
    if (coneR < 0.06) continue;
    const origin = pointAt(trunk, Math.min(ty, 0.985));
    const n = Math.max(2, Math.round(P.perWhorl*Q.perWhorlMul)) + ((rng()*2)|0);
    const az0 = rng()*Math.PI*2;
    for (let b = 0; b < n; b++){
      const az = az0 + b/n*Math.PI*2 + (rng()-0.5)*0.4;
      const droop = P.droop*(0.5 + (1 - ty)*0.8);           // lower limbs sweep down harder
      const dir = new THREE.Vector3(Math.cos(az), -droop, Math.sin(az)).normalize();
      const len = coneR*(0.85 + rng()*0.4);
      branch(origin, dir, len, Math.max(P.radius*0.32*(1 - ty*0.5), 0.010), 0);
    }
  }
  // a compact tuft of short fronds finishing the spire (not a flame)
  for (let k = 0; k < Q.spire; k++){
    const c = pointAt(trunk, 0.86 + rng()*0.10);
    const fl = new THREE.Vector3((rng()-0.5)*0.9, 1, (rng()-0.5)*0.9).normalize();
    const fw = orthogonal(fl).applyAxisAngle(fl, rng()*6.283);
    const sn = new THREE.Vector3(c.x, P.crownR, c.z);
    addFrond(c, fl, fw, P.frondLen*Q.fLen*(0.32 + rng()*0.22), P.frondW*Q.fWid*(0.55 + rng()*0.35),
      0.9, sn.lengthSq() < 1e-5 ? new THREE.Vector3(0,1,0) : sn.normalize(),
      { h: rng(), b: rng(), s: rng(), ph: rng() });
  }

  const top = trunk[trunk.length-1].y;

  const woodGeo = new THREE.BufferGeometry();
  woodGeo.setAttribute('position', new THREE.Float32BufferAttribute(wood.pos, 3));
  woodGeo.setAttribute('normal', new THREE.Float32BufferAttribute(wood.nrm, 3));
  woodGeo.setIndex(wood.idx);

  const leafGeo = new THREE.BufferGeometry();
  leafGeo.setAttribute('position', new THREE.Float32BufferAttribute(leaf.pos, 3));
  leafGeo.setAttribute('normal', new THREE.Float32BufferAttribute(leaf.nrm, 3));
  leafGeo.setAttribute('uv', new THREE.Float32BufferAttribute(leaf.uv, 2));
  leafGeo.setAttribute('aCardC', new THREE.Float32BufferAttribute(leaf.cardC, 3));
  leafGeo.setAttribute('aSphereN', new THREE.Float32BufferAttribute(leaf.sphereN, 3));
  leafGeo.setAttribute('aLeaf', new THREE.Float32BufferAttribute(leaf.misc, 4));
  leafGeo.setAttribute('aOcc', new THREE.Float32BufferAttribute(leaf.occ, 1));
  leafGeo.setIndex(leaf.idx);

  return { woodGeo, leafGeo, cards: leaf.idx.length/6, crownY: top };
}

// Evergreen conifers — sorted spruce/fir up high, pine mid-slope, saplings low.
// `tint` is a per-species needle colour cast (blue spruce, warm pine …).
export const ARCHETYPES = [
  { name: 'spruce', seed: 11, bark: [0.26, 0.20, 0.16], bark2: [0.14, 0.11, 0.085],
    tint: [0.88, 1.02, 1.20],
    P: { height: 7.4, radius: 0.135, lean: 0.04, wiggle: 0.55,
         whorls: 15, perWhorl: 6, crownR: 1.95, taper: 0.95, droop: 0.6,
         levels: 1, children: 2, frondDensity: 7.0, frondLen: 0.6, frondW: 0.34, frondDroop: 0.5 } },
  { name: 'fir', seed: 23, bark: [0.30, 0.24, 0.18], bark2: [0.17, 0.13, 0.10],
    tint: [1.00, 1.05, 1.00],
    P: { height: 6.6, radius: 0.115, lean: 0.03, wiggle: 0.45,
         whorls: 14, perWhorl: 7, crownR: 1.5, taper: 1.1, droop: 0.32,
         levels: 1, children: 2, frondDensity: 7.5, frondLen: 0.52, frondW: 0.30, frondDroop: 0.28 } },
  { name: 'pine', seed: 37, bark: [0.34, 0.25, 0.17], bark2: [0.20, 0.14, 0.10],
    tint: [1.16, 1.08, 0.74],
    P: { height: 8.6, radius: 0.145, lean: 0.07, wiggle: 0.7,
         whorls: 11, perWhorl: 7, crownR: 2.3, taper: 1.25, droop: 0.18,
         levels: 2, children: 3, frondDensity: 7.0, frondLen: 0.80, frondW: 0.34, frondDroop: 0.16 } },
  { name: 'sapling', seed: 53, bark: [0.27, 0.21, 0.16], bark2: [0.16, 0.12, 0.09],
    tint: [1.10, 1.14, 0.86],
    P: { height: 1.95, radius: 0.05, lean: 0.10, wiggle: 0.8,
         whorls: 8, perWhorl: 5, crownR: 0.72, taper: 1.0, droop: 0.34,
         levels: 1, children: 1, frondDensity: 7.0, frondLen: 0.4, frondW: 0.24, frondDroop: 0.34 } },
];
