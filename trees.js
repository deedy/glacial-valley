// Procedural trees: recursive branching skeletons swept into tapered tubes,
// plus leaf cards at the twig tips. Four archetypes, each generated once and
// instanced. Geometry is in tree-local meters with the root at the origin.
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
      const r = Math.max(r0*(1-t) + r1*t, 0.012);
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

  function branch(origin, dir, len, rad, level){
    const segs = level === 0 ? 5 : 3;
    const pts = [origin.clone()];
    let d = dir.clone(), p = origin.clone();
    for (let i = 1; i <= segs; i++){
      d = d.clone();
      d.x += (rng()-0.5)*P.wiggle*0.4;
      d.z += (rng()-0.5)*P.wiggle*0.4;
      d.y += P.upBias*(level === 0 ? 1 : 0.3) - P.droop*level*(i/segs)*0.5;
      d.normalize();
      p = p.clone().addScaledVector(d, len/segs);
      pts.push(p.clone());
    }
    addTube(pts, rad, rad*0.35, level === 0 ? 6 : (level === 1 ? 5 : 4));
    if (level < P.levels){
      const kids = P.children[level] + ((rng()*2)|0);
      for (let k = 0; k < kids; k++){
        const t = 0.30 + 0.65*(k + rng()*0.7)/kids;
        const polar = P.polar[level]*(0.75 + rng()*0.5);
        const bd = coneDir(dirAt(pts, t), polar, k*2.39996 + rng()*1.2);
        branch(pointAt(pts, t), bd, len*P.lenRatio*(0.7 + rng()*0.55), Math.max(rad*0.50, 0.013), level+1);
      }
    }
    if (level >= P.leafLevel){
      for (let k = 0; k < P.leavesPerTwig; k++){
        const t = 0.35 + 0.65*(k + rng())/P.leavesPerTwig;
        const c = pointAt(pts, t);
        c.x += (rng()-0.5)*0.24; c.y += (rng()-0.5)*0.20; c.z += (rng()-0.5)*0.24;
        leafCards.push({ c, size: P.leafSize*(0.7 + rng()*0.7),
          h: rng(), b: rng(), s: rng(), ph: rng() });
      }
    }
  }

  const lean = new THREE.Vector3((rng()-0.5)*P.lean, 1, (rng()-0.5)*P.lean).normalize();
  branch(new THREE.Vector3(0, 0, 0), lean, P.height, P.radius, 0);

  // crown centroid → shading normals that wrap the canopy like a soft sphere
  const crown = new THREE.Vector3();
  leafCards.forEach(L => crown.add(L.c));
  crown.divideScalar(Math.max(leafCards.length, 1));

  let maxR = 0.01;
  leafCards.forEach(L => { maxR = Math.max(maxR, L.c.distanceTo(crown)); });

  const leaf = { pos: [], nrm: [], uv: [], cardC: [], sphereN: [], misc: [], occ: [], idx: [] };
  for (const L of leafCards){
    const base = leaf.pos.length/3;
    const n = new THREE.Vector3(rng()*2-1, rng()*2-1, rng()*2-1).normalize();
    const u = orthogonal(n).multiplyScalar(L.size);
    const v = new THREE.Vector3().crossVectors(n, u).normalize().multiplyScalar(L.size);
    const sn = L.c.clone().sub(crown).normalize();
    const occ = L.c.distanceTo(crown)/maxR;   // 0 deep inside crown → 1 outer shell
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

  return { woodGeo, leafGeo, cards: leafCards.length, crownY: crown.y };
}

export const ARCHETYPES = [
  { name: 'birch', seed: 11, bark: [0.60, 0.58, 0.54], bark2: [0.26, 0.24, 0.22],
    P: { height: 5.4, radius: 0.085, lean: 0.10, wiggle: 0.55, upBias: 0.22, droop: 0.10,
         levels: 2, children: [6, 3], polar: [0.80, 0.75], lenRatio: 0.52,
         leafLevel: 2, leavesPerTwig: 8, leafSize: 0.38 } },
  { name: 'alder', seed: 23, bark: [0.34, 0.30, 0.26], bark2: [0.21, 0.18, 0.15],
    P: { height: 4.3, radius: 0.10, lean: 0.22, wiggle: 0.75, upBias: 0.10, droop: 0.22,
         levels: 2, children: [5, 3], polar: [1.05, 0.85], lenRatio: 0.58,
         leafLevel: 2, leavesPerTwig: 9, leafSize: 0.44 } },
  { name: 'willow', seed: 37, bark: [0.40, 0.36, 0.30], bark2: [0.25, 0.22, 0.18],
    P: { height: 3.1, radius: 0.075, lean: 0.35, wiggle: 0.95, upBias: 0.04, droop: 0.34,
         levels: 2, children: [6, 3], polar: [1.12, 0.90], lenRatio: 0.62,
         leafLevel: 1, leavesPerTwig: 8, leafSize: 0.40 } },
  { name: 'shrub', seed: 53, bark: [0.33, 0.29, 0.24], bark2: [0.21, 0.18, 0.14],
    P: { height: 1.35, radius: 0.035, lean: 0.55, wiggle: 1.1, upBias: 0.05, droop: 0.12,
         levels: 1, children: [7], polar: [0.95], lenRatio: 0.60,
         leafLevel: 1, leavesPerTwig: 8, leafSize: 0.33 } },
];
