// Procedural conifers: a straight central leader with whorls of drooping
// branches swept into tapered tubes, plus needle-spray cards along the twigs.
// Four evergreen archetypes, each generated once and instanced. Geometry is in
// tree-local meters with the root at the origin.
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

export function makeTreeGeometry(seed, P){
  const rng = mulberry32(seed);
  const wood = { pos: [], nrm: [], idx: [] };
  const leafCards = [];

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
      const r = Math.max(r0*(1-t) + r1*t, 0.010);
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

  // a branch (and its side twigs) draped with needle sprays
  function branch(origin, dir, len, rad, level){
    const segs = level === 0 ? 4 : 3;
    const pts = [origin.clone()];
    let d = dir.clone(), p = origin.clone();
    for (let i = 1; i <= segs; i++){
      d = d.clone();
      d.x += (rng()-0.5)*P.wiggle*0.20;
      d.z += (rng()-0.5)*P.wiggle*0.20;
      d.y -= P.droop*(0.18 + level*0.10);   // sags more toward the tip and on sub-twigs
      d.normalize();
      p = p.clone().addScaledVector(d, len/segs);
      pts.push(p.clone());
    }
    addTube(pts, rad, rad*0.30, level === 0 ? 4 : 3);

    // needle sprays packed along the limb
    const ncards = Math.max(2, Math.round(P.needleDensity*len));
    for (let k = 0; k < ncards; k++){
      const t = 0.12 + 0.86*(k + rng())/ncards;
      const c = pointAt(pts, t);
      c.x += (rng()-0.5)*0.16; c.y += (rng()-0.5)*0.12; c.z += (rng()-0.5)*0.16;
      leafCards.push({ c, size: P.leafSize*(0.7 + rng()*0.6),
        h: rng(), b: rng(), s: rng(), ph: rng() });
    }

    if (level < P.levels){
      const kids = P.children + ((rng()*2)|0);
      for (let k = 0; k < kids; k++){
        const t = 0.25 + 0.65*(k + rng()*0.6)/kids;
        const sd = coneDir(dirAt(pts, t), 0.55 + rng()*0.45, k*2.39996 + rng()*1.2);
        sd.y -= P.droop*0.35; sd.normalize();
        branch(pointAt(pts, t), sd, len*0.52*(0.7 + rng()*0.4), Math.max(rad*0.45, 0.011), level+1);
      }
    }
  }

  // ── central leader: a near-straight trunk tapering to a spire ──────────────
  const axis = new THREE.Vector3((rng()-0.5)*P.lean, 1, (rng()-0.5)*P.lean).normalize();
  const trunk = [new THREE.Vector3(0, 0, 0)];
  {
    let p = new THREE.Vector3(0, 0, 0), d = axis.clone();
    const segs = 8;
    for (let i = 1; i <= segs; i++){
      d = d.clone();
      d.x += (rng()-0.5)*P.wiggle*0.05;
      d.z += (rng()-0.5)*P.wiggle*0.05;
      d.normalize();
      p = p.clone().addScaledVector(d, P.height/segs);
      trunk.push(p.clone());
    }
  }
  addTube(trunk, P.radius, P.radius*0.10, 7);

  // ── whorls of branches, length tapering to a cone silhouette ───────────────
  for (let w = 0; w < P.whorls; w++){
    const ty = (w + 0.6)/P.whorls;                          // height fraction up the leader
    const coneR = P.crownR*Math.pow(1 - ty, P.taper);       // cone radius here
    if (coneR < 0.06) continue;
    const origin = pointAt(trunk, Math.min(ty, 0.985));
    const n = P.perWhorl + ((rng()*2)|0);
    const az0 = rng()*Math.PI*2;
    for (let b = 0; b < n; b++){
      const az = az0 + b/n*Math.PI*2 + (rng()-0.5)*0.4;
      const droop = P.droop*(0.5 + (1 - ty)*0.8);           // lower limbs sweep down harder
      const dir = new THREE.Vector3(Math.cos(az), -droop, Math.sin(az)).normalize();
      const len = coneR*(0.85 + rng()*0.4);
      branch(origin, dir, len, Math.max(P.radius*0.42*(1 - ty*0.5), 0.013), 0);
    }
  }
  // a tuft of needles crowning the spire
  for (let k = 0; k < 10; k++){
    const c = pointAt(trunk, 0.93 + rng()*0.06);
    c.x += (rng()-0.5)*0.18; c.y += rng()*0.22; c.z += (rng()-0.5)*0.18;
    leafCards.push({ c, size: P.leafSize*(0.6 + rng()*0.5),
      h: rng(), b: rng(), s: rng(), ph: rng() });
  }

  // shading frame: needles shade as if draping a cone — normals point outward
  // from the trunk axis with a downward bias; occlusion grows toward the core.
  const top = trunk[trunk.length-1].y;
  let maxR = 0.01;
  leafCards.forEach(L => { maxR = Math.max(maxR, Math.hypot(L.c.x, L.c.z)); });

  const leaf = { pos: [], nrm: [], uv: [], cardC: [], sphereN: [], misc: [], occ: [], idx: [] };
  for (const L of leafCards){
    const base = leaf.pos.length/3;
    // card stands roughly vertical, face pointing outward from the trunk → a
    // tall drooping spray rather than a flat broadleaf blob
    const outward = new THREE.Vector3(L.c.x, 0, L.c.z);
    if (outward.lengthSq() < 1e-4) outward.set(rng()*2-1, 0, rng()*2-1);
    const n = outward.normalize();
    n.x += (rng()-0.5)*0.5; n.z += (rng()-0.5)*0.5; n.y += (rng()-0.5)*0.3; n.normalize();
    const u = new THREE.Vector3().crossVectors(n, new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(L.size*0.62);
    const v = new THREE.Vector3().crossVectors(n, u).normalize().multiplyScalar(L.size*1.45);
    const sn = new THREE.Vector3(L.c.x, maxR*0.35, L.c.z).normalize();   // outward + slight up
    const occ = Math.min(Math.hypot(L.c.x, L.c.z)/maxR, 1.0);           // 0 at core → 1 at tips
    for (const [a, b] of [[-1,-1],[1,-1],[1,1],[-1,1]]){
      leaf.pos.push(L.c.x + u.x*a + v.x*b, L.c.y + u.y*a + v.y*b, L.c.z + u.z*a + v.z*b);
      leaf.nrm.push(n.x, n.y, n.z);
      leaf.uv.push(a*0.5 + 0.5, b*0.5 + 0.5);
      leaf.cardC.push(L.c.x, L.c.y, L.c.z);
      leaf.sphereN.push(sn.x, sn.y, sn.z);
      leaf.misc.push(L.h, L.b, L.s, L.ph);
      leaf.occ.push(occ);
    }
    leaf.idx.push(base, base+1, base+2, base, base+2, base+3);
  }

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

  return { woodGeo, leafGeo, cards: leafCards.length, crownY: top };
}

// Evergreen conifers — sorted spruce/fir up high, pine mid-slope, saplings low.
export const ARCHETYPES = [
  { name: 'spruce', seed: 11, bark: [0.30, 0.24, 0.19], bark2: [0.17, 0.13, 0.10],
    P: { height: 7.2, radius: 0.135, lean: 0.05, wiggle: 0.6,
         whorls: 14, perWhorl: 6, crownR: 1.95, taper: 0.92, droop: 0.55,
         levels: 1, children: 2, needleDensity: 4.2, leafSize: 0.34 } },
  { name: 'fir', seed: 23, bark: [0.34, 0.28, 0.22], bark2: [0.19, 0.15, 0.12],
    P: { height: 6.4, radius: 0.115, lean: 0.04, wiggle: 0.5,
         whorls: 13, perWhorl: 7, crownR: 1.55, taper: 1.05, droop: 0.28,
         levels: 1, children: 2, needleDensity: 4.6, leafSize: 0.30 } },
  { name: 'pine', seed: 37, bark: [0.40, 0.30, 0.21], bark2: [0.24, 0.17, 0.12],
    P: { height: 8.3, radius: 0.145, lean: 0.08, wiggle: 0.7,
         whorls: 9, perWhorl: 6, crownR: 2.25, taper: 1.5, droop: 0.16,
         levels: 2, children: 3, needleDensity: 3.4, leafSize: 0.36 } },
  { name: 'sapling', seed: 53, bark: [0.31, 0.25, 0.19], bark2: [0.18, 0.14, 0.11],
    P: { height: 1.9, radius: 0.05, lean: 0.10, wiggle: 0.8,
         whorls: 7, perWhorl: 5, crownR: 0.72, taper: 0.95, droop: 0.30,
         levels: 1, children: 1, needleDensity: 4.0, leafSize: 0.26 } },
];
