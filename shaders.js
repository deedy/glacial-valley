// ── GLSL library ─────────────────────────────────────────────────────────────
// All materials output LINEAR HDR. Tonemapping (ACES) happens in the post pass.

export const COMMON = /* glsl */`
uniform float uTime;
uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform vec3  uSkyZenith;
uniform vec3  uHorizonCold;
uniform vec3  uHorizonWarm;
uniform vec3  uGroundBounce;
uniform sampler2D uMapCoarse;   // R: terrain height (m), G: baked sun visibility
uniform sampler2D uMapFine;
uniform vec3  uRegCoarse;       // center x, center z, half extent
uniform vec3  uRegFine;
uniform float uWaterY;
uniform vec2  uWindDir;

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  float a = hash12(i);
  float b = hash12(i+vec2(1.0,0.0));
  float c = hash12(i+vec2(0.0,1.0));
  float d = hash12(i+vec2(1.0,1.0));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float fbm(vec2 p){
  float a = 0.0, w = 0.5;
  for (int i = 0; i < 5; i++){ a += w*vnoise(p); p = p*2.03 + vec2(17.3, 9.1); w *= 0.5; }
  return a;
}
float fbm3(vec2 p){
  float a = 0.0, w = 0.5;
  for (int i = 0; i < 3; i++){ a += w*vnoise(p); p = p*2.03 + vec2(17.3, 9.1); w *= 0.5; }
  return a;
}
float vor(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float md = 8.0;
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++){
    vec2 g = vec2(float(x), float(y));
    vec2 r = g + hash22(i+g) - f;
    md = min(md, dot(r, r));
  }
  return sqrt(md);
}
float vorEdge(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float f1 = 8.0, f2 = 8.0;
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++){
    vec2 g = vec2(float(x), float(y));
    vec2 r = g + hash22(i+g) - f;
    float d = dot(r, r);
    if (d < f1){ f2 = f1; f1 = d; } else if (d < f2){ f2 = d; }
  }
  return sqrt(f2) - sqrt(f1);
}
vec2 mapUV(vec3 reg, vec2 xz){ return (xz - reg.xy) / (2.0*reg.z) + 0.5; }
float regionMask(vec2 uv){
  vec2 e = abs(uv - 0.5);
  return 1.0 - smoothstep(0.44, 0.5, max(e.x, e.y));
}
float groundH(vec2 xz){
  vec2 uvf = mapUV(uRegFine, xz);   float mf = regionMask(uvf);
  vec2 uvc = mapUV(uRegCoarse, xz); float mc = regionMask(uvc);
  float hc = texture2D(uMapCoarse, clamp(uvc, 0.0, 1.0)).r;
  float hf = texture2D(uMapFine,   clamp(uvf, 0.0, 1.0)).r;
  return mix(mix(0.0, hc, mc), hf, mf);
}
float sunVis(vec2 xz){
  vec2 uvf = mapUV(uRegFine, xz);   float mf = regionMask(uvf);
  vec2 uvc = mapUV(uRegCoarse, xz); float mc = regionMask(uvc);
  float vc = texture2D(uMapCoarse, clamp(uvc, 0.0, 1.0)).g;
  float vf = texture2D(uMapFine,   clamp(uvf, 0.0, 1.0)).g;
  return mix(mix(1.0, vc, mc), vf*vc, mf);
}
float cloudShadow(vec2 xz){
  float n = fbm(xz*0.00062 + uTime*vec2(0.0046, 0.0013));
  return 0.45 + 0.55*smoothstep(0.30, 0.66, n);
}
float gust(vec2 xz){
  return fbm3(xz*0.05 - uWindDir*uTime*0.85);
}
vec3 skyRadiance(vec3 d){
  float sd = max(dot(d, uSunDir), 0.0);
  float y = d.y;
  float hz = exp(-max(y, 0.0)*6.5);
  float warmside = pow(sd*0.5 + 0.5, 6.0);
  vec3 horizon = mix(uHorizonCold, uHorizonWarm, warmside);
  vec3 col = mix(uSkyZenith, horizon, hz);
  col += uHorizonWarm * (pow(sd, 8.0)*0.12 + pow(sd, 64.0)*0.5);
  float disk = smoothstep(0.99988, 0.99997, sd);
  col += vec3(1.0, 0.60, 0.34) * disk * 160.0;
  col += vec3(1.0, 0.55, 0.30) * pow(sd, 900.0) * 7.0;
  col = mix(col, uHorizonCold*0.65, smoothstep(0.0, -0.10, y));
  if (y > 0.012){
    vec2 cp = d.xz / (y + 0.09);
    float cir = fbm(cp*1.5 + vec2(uTime*0.0025, 0.0));
    cir = pow(smoothstep(0.46, 0.86, cir), 1.5) * smoothstep(0.012, 0.10, y) * exp(-y*2.4);
    col = mix(col, mix(uHorizonCold*1.15, uHorizonWarm*1.35, warmside), cir*0.5);
  }
  return col;
}
vec3 applyAtmo(vec3 col, vec3 wp){
  vec3 dv = wp - cameraPosition;
  float dist = length(dv);
  vec3 vd = dv / max(dist, 0.001);
  float sw = pow(max(dot(vd, uSunDir), 0.0), 6.0);
  float f = 1.0 - exp(-dist*6.5e-5);
  vec3 hazeCol = mix(uHorizonCold*0.9, uHorizonWarm*1.1, sw);
  float ha = max(cameraPosition.y - uWaterY, 0.0);
  float hb = max(wp.y - uWaterY, 0.0);
  float fall = 0.16;
  float ea = exp(-ha*fall), eb = exp(-hb*fall);
  float denom = fall*(hb - ha);
  float avg = (abs(denom) < 1e-3) ? ea : (ea - eb)/denom;
  float mist = 1.0 - exp(-dist*avg*0.0014);
  float svm = sunVis(mix(cameraPosition.xz, wp.xz, 0.6));
  vec3 mistCol = mix(uHorizonCold*0.85, uHorizonWarm*1.35, sw*(0.2 + 0.8*svm));
  col = mix(col, hazeCol, f);
  col = mix(col, mistCol, clamp(mist, 0.0, 1.0)*0.75);
  return col;
}
vec3 litSurface(vec3 albedo, vec3 N, vec3 wp, vec3 vd, float specAmt, float rough, float ao){
  float sv = sunVis(wp.xz) * cloudShadow(wp.xz);
  float ndl = max(dot(N, uSunDir), 0.0);
  vec3 col = albedo * uSunColor * ndl * sv;
  vec3 amb = mix(uGroundBounce, uSkyZenith*1.05, N.y*0.5 + 0.5);
  amb += uHorizonWarm * 0.10 * max(dot(N, normalize(vec3(uSunDir.x, 0.25, uSunDir.z))), 0.0);
  col += albedo * amb * ao;
  if (specAmt > 0.001){
    vec3 h = normalize(uSunDir - vd);
    float ndh = max(dot(N, h), 0.0);
    float p = exp2(9.0*(1.0 - rough) + 1.0);
    float fres = 0.04 + 0.96*pow(1.0 - max(dot(N, -vd), 0.0), 5.0);
    col += uSunColor * sv * ndl * specAmt * fres * pow(ndh, p) * (p + 8.0) * 0.04;
  }
  return col;
}
`;

// ── Sky ──────────────────────────────────────────────────────────────────────
export const skyVert = /* glsl */`
varying vec3 vWp;
void main(){
  vWp = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
export const skyFrag = (common) => /* glsl */`
${common}
varying vec3 vWp;
void main(){
  vec3 d = normalize(vWp - cameraPosition);
  gl_FragColor = vec4(skyRadiance(d), 1.0);
}
`;

// ── Terrain ──────────────────────────────────────────────────────────────────
export const terrainVert = /* glsl */`
varying vec3 vWp;
varying vec3 vN;
void main(){
  vWp = (modelMatrix * vec4(position, 1.0)).xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
export const terrainFrag = (common) => /* glsl */`
${common}
varying vec3 vWp;
varying vec3 vN;
uniform vec2 uTrackA;
uniform vec2 uTrackB;

float microH(vec2 p){
  float peb = 1.0 - vor(p*17.0);
  float fine = vnoise(p*45.0);
  float crack = smoothstep(0.0, 0.12, vorEdge(p*2.6));
  return peb*0.55 + fine*0.25 + crack*0.20;
}

void main(){
  vec3 toP = vWp - cameraPosition;
  float dist = length(toP);
  vec3 vd = toP / max(dist, 0.001);
  vec3 N = normalize(vN);
  vec2 uvw = vWp.xz;
  float nearW = 1.0 - smoothstep(4.0, 26.0, dist);

  // cheap parallax-occlusion style offset on near, upward-facing ground
  if (nearW > 0.01 && N.y > 0.6 && vd.y < -0.02){
    vec2 stp = vd.xz / max(0.30, -vd.y) * 0.05 * nearW;
    float hh = microH(uvw);
    uvw += stp * (1.0 - hh);
    hh = microH(uvw);
    uvw += stp * (1.0 - hh) * 0.5;
  }

  float slope = clamp(1.0 - N.y, 0.0, 1.0);
  float relH = vWp.y - uWaterY;
  float big = fbm(vWp.xz*0.018);

  float rockM  = smoothstep(0.16, 0.30, slope + (big - 0.5)*0.18);
  float screeM = smoothstep(0.085, 0.16, slope) * (1.0 - rockM) * smoothstep(8.0, 60.0, relH);
  float siltM  = (1.0 - smoothstep(0.045, 0.11, slope)) * (1.0 - smoothstep(0.9, 2.0, relH));
  float grassM = (1.0 - rockM) * (1.0 - screeM) * (1.0 - siltM)
               * smoothstep(0.30, 0.9, relH) * (1.0 - smoothstep(35.0, 80.0, relH))
               * smoothstep(0.33, 0.6, fbm(vWp.xz*0.045 + 7.0));

  float snowLine = 1050.0 + 500.0*(fbm(vWp.xz*0.0011) - 0.5);
  float snowM = smoothstep(snowLine, snowLine + 180.0, relH);
  snowM *= smoothstep(0.60, 0.28, slope + (fbm(vWp.xz*0.02 + 3.0) - 0.5)*0.25);
  snowM *= 0.55 + 0.45*smoothstep(0.30, 0.55, fbm(vWp.xz*0.006 + 11.0));
  snowM = clamp(snowM*1.6, 0.0, 1.0);
  snowM = max(snowM, smoothstep(snowLine - 120.0, snowLine + 60.0, relH)*smoothstep(0.20, 0.06, slope)*0.7);

  // granite: triplanar detail + warped strata bands
  vec3 aw = pow(abs(N), vec3(3.0)); aw /= (aw.x + aw.y + aw.z);
  float strata = fbm(vec2(vWp.y*0.055 + fbm(vWp.xz*0.004)*6.0, (vWp.x + vWp.z)*0.002));
  float rdet = fbm(vWp.zy*0.11)*aw.x + fbm(vWp.xz*0.11)*aw.y + fbm(vWp.xy*0.11)*aw.z;
  vec3 rockCol = mix(vec3(0.235, 0.225, 0.215), vec3(0.34, 0.325, 0.30), rdet);
  rockCol *= 0.78 + 0.5*strata;
  rockCol *= 1.0 - 0.35*smoothstep(0.32, 0.20, strata);
  rockCol = mix(rockCol, vec3(0.50, 0.47, 0.43), smoothstep(0.62, 0.72, strata)*0.5);

  float lich = smoothstep(0.55, 0.62, vnoise(vWp.xz*1.4 + vWp.y*0.9)) * smoothstep(0.7, 0.5, rdet);
  vec3 lichCol = mix(vec3(0.45, 0.46, 0.18), vec3(0.55, 0.33, 0.12), vnoise(vWp.xz*0.8));
  rockCol = mix(rockCol, lichCol, lich*rockM*0.35*(1.0 - snowM)*smoothstep(300.0, 30.0, dist));

  vec3 screeCol = mix(vec3(0.30, 0.29, 0.28), vec3(0.385, 0.37, 0.35), vnoise(uvw*2.2));
  screeCol *= 0.85 + 0.3*vor(uvw*1.3);

  float gn = vnoise(uvw*3.0);
  vec3 grassCol = mix(vec3(0.085, 0.115, 0.045), vec3(0.21, 0.19, 0.085), gn);
  grassCol = mix(grassCol, vec3(0.27, 0.235, 0.12), smoothstep(0.6, 0.85, fbm(uvw*0.6))*0.6);

  float mossM = smoothstep(1.2, 0.3, relH) * smoothstep(0.62, 0.82, fbm(uvw*0.9 + 4.0)) * (1.0 - siltM*0.6);
  vec3 mossCol = vec3(0.075, 0.16, 0.055);

  float peb = 1.0 - vor(uvw*17.0);
  float cracks = 1.0 - smoothstep(0.0, 0.10, vorEdge(uvw*2.6));
  vec3 siltCol = mix(vec3(0.30, 0.255, 0.205), vec3(0.40, 0.36, 0.30), vnoise(uvw*7.0));
  siltCol = mix(siltCol, vec3(0.34, 0.31, 0.27), smoothstep(0.45, 0.85, peb)*0.45);
  siltCol *= 1.0 - cracks*0.45*smoothstep(0.35, 1.0, relH)*nearW;
  siltCol *= 0.93 + 0.14*sin(uvw.x*7.0 + vnoise(uvw*1.5)*6.0)*(1.0 - smoothstep(0.1, 0.6, relH));

  vec3 alb = rockCol;
  alb = mix(alb, screeCol, screeM);
  alb = mix(alb, grassCol, grassM);
  alb = mix(alb, siltCol, siltM);
  alb = mix(alb, mossCol, mossM*0.55*(1.0 - rockM));

  // animal tracks pressed into the silt
  vec2 tAB = uTrackB - uTrackA;
  float tLen = length(tAB);
  vec2 tdir = tAB / max(tLen, 0.001);
  vec2 tperp = vec2(-tdir.y, tdir.x);
  vec2 rel = vWp.xz - uTrackA;
  float along = dot(rel, tdir);
  float latd = dot(rel, tperp);
  float trackM = 0.0;
  if (along > 0.0 && along < tLen && abs(latd) < 0.45){
    float stepL = 0.78;
    float k = floor(along/stepL);
    float side = mod(k, 2.0)*2.0 - 1.0;
    vec2 pc = uTrackA + tdir*(k*stepL + stepL*0.5) + tperp*side*0.13;
    vec2 dpc = vWp.xz - pc;
    vec2 e2 = vec2(dot(dpc, tdir)/0.055, dot(dpc, tperp)/0.038);
    trackM = (1.0 - smoothstep(0.5, 1.0, length(e2))) * siltM;
  }
  alb *= 1.0 - trackM*0.4;

  // wet/dry transition along every shoreline
  float wetEdge = 0.22 + 0.30*vnoise(uvw*1.2);
  float wetM = 1.0 - smoothstep(0.02, wetEdge + 0.25, relH - trackM*0.12);
  wetM = clamp(max(wetM, mossM*0.4), 0.0, 1.0);
  alb *= 1.0 - 0.5*wetM;

  vec3 snowCol = vec3(0.84, 0.87, 0.96);
  float sast = sin(dot(vWp.xz, normalize(uWindDir))*0.9 + fbm(vWp.xz*0.05)*9.0);
  snowCol *= 0.93 + 0.07*sast;
  alb = mix(alb, snowCol, snowM);

  // micro normal detail near the camera
  float e = 0.18;
  float h0 = microH(uvw);
  float hx = microH(uvw + vec2(e, 0.0));
  float hz = microH(uvw + vec2(0.0, e));
  vec3 mN = normalize(vec3(-(hx - h0)/e*0.35, 1.0, -(hz - h0)/e*0.35));
  N = normalize(mix(N, normalize(N + (mN - vec3(0.0, 1.0, 0.0))), nearW*(1.0 - rockM)*0.7));

  float ao = 1.0 - 0.30*cracks*nearW - 0.20*(1.0 - peb)*nearW*siltM;
  float specAmt = 0.05 + wetM*0.55 + snowM*0.10;
  float rough = mix(mix(0.82, 0.25, wetM), 0.55, snowM);
  vec3 col = litSurface(alb, N, vWp, vd, specAmt, rough, ao);

  // frost & snow sparkle
  float svHere = sunVis(vWp.xz);
  float frostZone = (1.0 - smoothstep(0.2, 0.5, svHere)) * smoothstep(2.5, 0.5, relH) * grassM;
  float sparkM = max(snowM, max(frostZone*0.9, wetM*0.2)) * smoothstep(140.0, 8.0, dist);
  if (sparkM > 0.003){
    vec2 sp = vWp.xz*42.0 + vec2(dot(vd.xz, vec2(7.0)), vd.y*9.0);
    float g = step(0.992, hash12(floor(sp)));
    col += uSunColor * g * sparkM * 0.5 * (0.25 + svHere);
    col += uSkyZenith * frostZone * 0.06;
  }

  col = applyAtmo(col, vWp);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ── Water ────────────────────────────────────────────────────────────────────
export const waterVert = /* glsl */`
varying vec3 vWp;
void main(){
  vWp = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
export const waterFrag = (common) => /* glsl */`
${common}
varying vec3 vWp;
uniform sampler2D tRefr;
uniform vec2 uResolution;

float wH(vec2 p, float t){
  float h = 0.0;
  h += vnoise(p*vec2(1.1, 2.6) + vec2(-t*1.35, t*0.18))*0.034;
  h += vnoise(p*vec2(2.6, 6.0) + vec2(-t*2.30, -t*0.32))*0.016;
  h += vnoise(p*vec2(5.6, 12.0) + vec2(-t*3.60, t*0.55))*0.008;
  h += vnoise(p*vec2(10.0, 22.0) + vec2(-t*5.20, t*0.90))*0.0045;
  h += vnoise(p*0.45 + vec2(-t*0.50, 0.0))*0.050;
  return h;
}

void main(){
  float t = uTime;
  vec3 toP = vWp - cameraPosition;
  float dist = length(toP);
  vec3 vd = toP / max(dist, 0.001);
  vec2 p = vWp.xz;

  float depth0 = max(uWaterY - groundH(p), 0.0);
  float sv = sunVis(p) * cloudShadow(p);

  // bed gradient along the flow → rapids get choppier water and whitewater
  float gA = groundH(p + vec2(2.0, 0.0));
  float gB = groundH(p - vec2(2.0, 0.0));
  float rapid = smoothstep(0.10, 0.45, abs(gA - gB)*0.5) * smoothstep(0.60, 0.12, depth0);

  float e = 0.045;
  float h0 = wH(p, t);
  float hx = wH(p + vec2(e, 0.0), t);
  float hz = wH(p + vec2(0.0, e), t);
  float nscale = (1.0 + rapid*1.4)/(1.0 + dist*0.010);
  vec3 N = normalize(vec3(-(hx - h0)/e*nscale, 1.0, -(hz - h0)/e*nscale));

  // screen-space refraction of the real riverbed
  vec2 suv = gl_FragCoord.xy / uResolution;
  vec2 ruv = suv + N.xz * 0.07 * clamp(depth0*2.0, 0.10, 1.0) / (1.0 + dist*0.06);
  ruv = clamp(ruv, vec2(0.002), vec2(0.998));
  vec3 refr = texture2D(tRefr, ruv).rgb;

  vec3 rdir = refract(vd, vec3(0.0, 1.0, 0.0), 0.752);
  float depth = max(uWaterY - groundH(p + N.xz*depth0*1.5), 0.02);
  float path = depth / max(0.30, -rdir.y);

  // caustics on the bed, fading with depth
  vec2 cuv = (p + N.xz*depth*2.0)*1.05;
  float ca = pow(1.0 - vor(cuv*2.0 + vec2(-t*0.9, t*0.25)), 5.0)
           + pow(1.0 - vor(cuv*3.1 + vec2(-t*1.3, -t*0.30)), 5.0);
  refr *= 1.0 + ca * sv * 1.2 * exp(-depth*1.8);

  // glacial water: fast red absorption + suspended rock-flour scattering
  vec3 trans = exp(-path * vec3(0.62, 0.18, 0.14) * 1.5);
  float scA = 1.0 - exp(-path*0.30);
  vec3 sunAmb = uSunColor*0.10*sv + uSkyZenith*0.55;
  vec3 under = refr * trans + vec3(0.07, 0.38, 0.36) * scA * sunAmb;

  // reflection: sky, with coarse heightfield march so mountains darken it
  vec3 rd = reflect(vd, N);
  rd.y = max(rd.y, 0.02);
  vec3 refl = skyRadiance(rd);
  if (rd.y < 0.32){
    float tt = 25.0; vec3 hp = vWp; float hit = 0.0;
    for (int i = 0; i < 5; i++){
      hp = vWp + rd*tt;
      if (hp.y < groundH(hp.xz)){ hit = 1.0; break; }
      tt *= 2.3;
    }
    if (hit > 0.5){
      vec3 mcol = vec3(0.30, 0.295, 0.29) * (uSkyZenith*0.9 + uSunColor*0.22*sunVis(hp.xz));
      refl = mix(refl, applyAtmo(mcol, hp), 0.85);
    }
  }
  float fres = 0.02 + 0.98*pow(1.0 - max(dot(N, -vd), 0.0), 5.0);
  vec3 col = mix(under, refl, clamp(fres, 0.0, 1.0));

  // sun glitter
  vec3 hv = normalize(uSunDir - vd);
  float ndh = max(dot(N, hv), 0.0);
  col += uSunColor * sv * (pow(ndh, 750.0)*1.6 + pow(ndh, 90.0)*0.07);

  // foam: shorelines, gravel-bar margins, fast streaks
  float foamN = fbm(vec2(p.x*0.35 + t*1.2, p.y*1.3));
  float shore = smoothstep(0.16, 0.03, depth0);
  float streak = smoothstep(0.55, 0.80, fbm(vec2(p.x*0.10 + t*0.55, p.y*0.9)));
  float rapidN = smoothstep(0.35, 0.75, fbm(vec2(p.x*0.7 + t*2.8, p.y*2.2)));
  float foam = clamp(shore*(0.55 + 0.45*foamN)
             + streak*smoothstep(0.5, 0.15, depth0)*0.5
             + rapid*rapidN*0.9, 0.0, 1.0);
  vec3 foamCol = vec3(0.9) * (uSunColor*0.12*sv + uSkyZenith*0.7);
  col = mix(col, foamCol, foam*0.85);

  col = applyAtmo(col, vWp);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ── Grass ────────────────────────────────────────────────────────────────────
export const grassVert = (common) => /* glsl */`
${common}
attribute vec3 aOffset;
attribute vec4 aParam;   // scale, yaw, phase, hue
varying vec3 vWp;
varying vec3 vNrm;
varying float vT;
varying float vHue;
varying float vG;
void main(){
  float scale = aParam.x, yaw = aParam.y, phase = aParam.z;
  vHue = aParam.w;
  float cy = cos(yaw), sy = sin(yaw);
  vec3 lp = vec3(position.x*cy, position.y, -position.x*sy);
  vec3 ln = normalize(vec3(normal.z*sy, normal.y, normal.z*cy));
  float g = gust(aOffset.xz);
  vG = g;
  float sway = sin(uTime*2.4 + phase + g*4.0);
  float bend = (0.10 + 1.0*g*g) * (0.65 + 0.35*sway);
  vec2 bdir = normalize(uWindDir + 0.35*vec2(sin(phase*7.0), cos(phase*3.0)));
  float t2 = position.y*position.y;
  vec3 wp = aOffset + lp*scale;
  wp.xz += bdir * bend * t2 * scale;
  wp.y  -= bend*bend * t2 * scale * 0.35;
  // high-frequency flutter, strongest in gusts, perpendicular to the bend
  float flut = sin(uTime*(9.0 + 7.0*fract(phase*0.13)) + phase*23.0) * (0.10 + 0.90*g*g);
  vec2 fdir = vec2(-bdir.y, bdir.x);
  wp.xz += fdir * flut * 0.035 * t2 * scale;
  wp.y  -= abs(flut) * 0.012 * t2 * scale;
  vWp = wp;
  vNrm = ln;
  vT = position.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
export const grassFrag = (common) => /* glsl */`
${common}
varying vec3 vWp;
varying vec3 vNrm;
varying float vT;
varying float vHue;
varying float vG;
void main(){
  vec3 toP = vWp - cameraPosition;
  float dist = length(toP);
  vec3 vd = toP / max(dist, 0.001);
  vec3 N = normalize(vNrm);
  if (!gl_FrontFacing) N = -N;
  N = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.4));

  vec3 colA = vec3(0.10, 0.14, 0.05);
  vec3 colB = vec3(0.24, 0.21, 0.09);
  vec3 alb = mix(colA, colB, vHue);
  alb *= mix(0.45, 1.05, vT);

  float svRaw = sunVis(vWp.xz);
  float frost = (1.0 - smoothstep(0.15, 0.45, svRaw)) * smoothstep(0.55, 1.0, vT) * 0.55;
  alb = mix(alb, vec3(0.55, 0.60, 0.68), frost);

  float sv = svRaw * cloudShadow(vWp.xz);
  float ndl = max(dot(N, uSunDir), 0.0)*0.7 + 0.3;
  vec3 col = alb * uSunColor * ndl * sv;
  col += alb * mix(uGroundBounce, uSkyZenith*1.3, 0.75);
  float back = pow(max(dot(vd, uSunDir), 0.0), 4.0);
  col += alb * uSunColor * back * sv * (0.5 + 0.4*vT);
  col = applyAtmo(col, vWp);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ── Flowers ──────────────────────────────────────────────────────────────────
export const flowerVert = (common) => /* glsl */`
${common}
attribute vec3 aOffset;
attribute vec4 aParam;   // scale, yaw, phase, type
varying vec2 vUv;
varying vec3 vWp;
varying float vType;
void main(){
  vUv = uv;
  vType = aParam.w;
  float scale = aParam.x, yaw = aParam.y, phase = aParam.z;
  float cy = cos(yaw), sy = sin(yaw);
  vec3 lp = vec3(position.x*cy + position.z*sy, position.y, -position.x*sy + position.z*cy);
  float g = gust(aOffset.xz);
  float bend = (0.06 + 0.5*g*g)*(0.6 + 0.4*sin(uTime*2.3 + phase));
  vec3 wp = aOffset + lp*scale;
  wp.xz += uWindDir * bend * position.y*position.y * scale;
  vWp = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
export const flowerFrag = (common) => /* glsl */`
${common}
varying vec2 vUv;
varying vec3 vWp;
varying float vType;
void main(){
  vec2 c = vUv*2.0 - 1.0;
  float r = length(c);
  float ang = atan(c.y, c.x);
  float petals = abs(cos(ang*2.5 + vType*7.0));
  float head = step(r, 0.35 + 0.55*petals);
  if (head < 0.5) discard;
  vec3 colW = vec3(0.85, 0.85, 0.80);
  vec3 colY = vec3(0.85, 0.70, 0.15);
  vec3 colP = vec3(0.55, 0.40, 0.75);
  vec3 alb = vType < 0.33 ? colW : (vType < 0.66 ? colY : colP);
  alb = mix(vec3(0.9, 0.8, 0.2), alb, smoothstep(0.0, 0.35, r));
  float sv = sunVis(vWp.xz) * cloudShadow(vWp.xz);
  vec3 col = alb * (uSunColor*0.6*sv + uSkyZenith*1.2);
  col = applyAtmo(col, vWp);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ── Rocks (boulders + pebbles share, BOULDER define adds displacement) ──────
export const rockVert = (common, boulder) => /* glsl */`
${common}
${boulder ? '#define BOULDER' : ''}
attribute vec3 aOffset;
attribute vec4 aParam;   // scale, yaw, seed, flatten
varying vec3 vWp;
varying vec3 vNrm;
varying float vSeed;
varying float vScale;
void main(){
  float scale = aParam.x, yaw = aParam.y, seed = aParam.z, flat_ = aParam.w;
  vSeed = seed;
  vScale = scale;
  vec3 lp = position * vec3(1.0, flat_, 1.0);
  vec3 ln = normalize(normal / vec3(1.0, flat_, 1.0));
  #ifdef BOULDER
    float n = (vnoise(lp.xy*2.3 + seed) + vnoise(lp.yz*2.3 + seed*1.7) + vnoise(lp.zx*2.3 + seed*2.3))/3.0;
    float n2 = vnoise(lp.xz*5.0 + seed*3.1);
    lp *= 0.58 + 0.64*n + 0.16*n2;
    ln = normalize(mix(ln, normalize(lp), 0.7));
  #endif
  float cy = cos(yaw), sy = sin(yaw);
  vec3 rp = vec3(lp.x*cy + lp.z*sy, lp.y, -lp.x*sy + lp.z*cy);
  vec3 rn = vec3(ln.x*cy + ln.z*sy, ln.y, -ln.x*sy + ln.z*cy);
  vec3 wp = aOffset + rp*scale;
  vWp = wp;
  vNrm = rn;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
export const rockFrag = (common) => /* glsl */`
${common}
varying vec3 vWp;
varying vec3 vNrm;
varying float vSeed;
varying float vScale;
void main(){
  vec3 toP = vWp - cameraPosition;
  float dist = length(toP);
  vec3 vd = toP / max(dist, 0.001);
  vec3 N = normalize(vNrm);

  vec3 aw = pow(abs(N), vec3(3.0)); aw /= (aw.x + aw.y + aw.z);
  float det = fbm(vWp.zy*1.4 + vSeed)*aw.x + fbm(vWp.xz*1.4 + vSeed)*aw.y + fbm(vWp.xy*1.4 + vSeed)*aw.z;
  float hue = hash12(vec2(vSeed, vSeed*1.7));
  vec3 alb = mix(vec3(0.30, 0.29, 0.28), vec3(0.46, 0.43, 0.39), det);
  alb = mix(alb, vec3(0.38, 0.33, 0.27), hue*0.35);
  alb *= 0.85 + 0.3*vnoise(vWp.xz*8.0 + vSeed);
  alb *= mix(1.0, 0.72, smoothstep(0.4, 1.5, vScale));

  // lichen patches on dry tops
  float relH = vWp.y - uWaterY;
  float lich = smoothstep(0.60, 0.68, vnoise(vWp.xz*3.0 + vSeed*5.0)) * smoothstep(0.3, 0.9, relH) * max(N.y, 0.0);
  vec3 lichCol = mix(vec3(0.48, 0.48, 0.18), vec3(0.58, 0.34, 0.12), hash12(vec2(vSeed*3.0, 1.0)));
  alb = mix(alb, lichCol, lich*0.22*smoothstep(120.0, 20.0, dist));

  // moss collar near the waterline
  float mossM = smoothstep(0.7, 0.10, relH) * smoothstep(0.2, 0.7, N.y) * smoothstep(0.55, 0.8, vnoise(vWp.xz*2.0 + vSeed));
  alb = mix(alb, vec3(0.07, 0.15, 0.05), mossM*0.6);

  // wet/dry transition band
  float wetM = 1.0 - smoothstep(0.02, 0.30 + 0.25*vnoise(vWp.xz*2.5), relH);
  wetM = clamp(wetM + (vWp.y < uWaterY + 0.02 ? 1.0 : 0.0), 0.0, 1.0);
  alb *= 1.0 - 0.50*wetM;

  // polish detail normal
  vec3 dN = normalize(N + 0.25*vec3(vnoise(vWp.yz*14.0) - 0.5, vnoise(vWp.xz*14.0) - 0.5, vnoise(vWp.xy*14.0) - 0.5));
  float specAmt = 0.08 + wetM*0.7;
  float rough = mix(0.7, 0.15, wetM);

  // offset shadow lookup so big stamped boulders don't self-darken
  vec3 wpS = vWp + vec3(uSunDir.x, 0.0, uSunDir.z)*vScale*1.8;
  float sv = sunVis(wpS.xz) * cloudShadow(vWp.xz);
  float ndl = max(dot(dN, uSunDir), 0.0);
  vec3 col = alb * uSunColor * ndl * sv;
  vec3 amb = mix(uGroundBounce, uSkyZenith*1.05, dN.y*0.5 + 0.5);
  col += alb * amb * (0.55 + 0.45*max(dN.y, 0.0));
  vec3 hv = normalize(uSunDir - vd);
  float p = exp2(9.0*(1.0 - rough) + 1.0);
  float fres = 0.04 + 0.96*pow(1.0 - max(dot(dN, -vd), 0.0), 5.0);
  col += uSunColor * sv * ndl * specAmt * fres * pow(max(dot(dN, hv), 0.0), p) * (p + 8.0)*0.04;

  col = applyAtmo(col, vWp);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ── Ice shelves ──────────────────────────────────────────────────────────────
export const iceVert = (common) => /* glsl */`
${common}
attribute vec3 aOffset;
attribute vec4 aParam;   // scale, yaw, seed, tilt
varying vec3 vWp;
varying vec3 vNrm;
varying float vSeed;
void main(){
  float scale = aParam.x, yaw = aParam.y, seed = aParam.z, tilt = aParam.w;
  vSeed = seed;
  float cy = cos(yaw), sy = sin(yaw);
  vec3 lp = position;
  lp.y += (vnoise(lp.xz*3.0 + seed)*0.5 - 0.25)*0.06;
  vec3 rp = vec3(lp.x*cy + lp.z*sy, lp.y + lp.x*tilt, -lp.x*sy + lp.z*cy);
  vec3 wp = aOffset + rp*scale;
  vWp = wp;
  vNrm = normalize(vec3(-tilt*cy, 1.0, tilt*sy));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
export const iceFrag = (common) => /* glsl */`
${common}
varying vec3 vWp;
varying vec3 vNrm;
varying float vSeed;
void main(){
  vec3 toP = vWp - cameraPosition;
  float dist = length(toP);
  vec3 vd = toP / max(dist, 0.001);
  vec3 N = normalize(vNrm);
  vec2 p = vWp.xz*3.0 + vSeed;
  float crack = 1.0 - smoothstep(0.0, 0.09, vorEdge(p*1.4));
  float bub = smoothstep(0.75, 0.95, vnoise(p*9.0));
  float fres = pow(1.0 - max(dot(N, -vd), 0.0), 3.0);
  float sv = sunVis(vWp.xz) * cloudShadow(vWp.xz);

  vec3 base = uSkyZenith*1.1 + uSunColor*0.05*sv;
  vec3 col = base * vec3(0.75, 0.88, 1.0) * 0.55;
  col += vec3(0.85, 0.93, 1.0) * crack * (uSkyZenith*0.8 + uSunColor*0.10*sv);
  col += vec3(1.0) * bub * uSkyZenith * 0.4;
  col += skyRadiance(reflect(vd, N)) * (0.04 + 0.5*fres);
  vec3 hv = normalize(uSunDir - vd);
  col += uSunColor * sv * pow(max(dot(N, hv), 0.0), 600.0) * 2.0;

  float alpha = clamp(0.45 + 0.35*fres + 0.25*crack, 0.0, 0.92);
  col = applyAtmo(col, vWp);
  gl_FragColor = vec4(col, alpha);
}
`;

// ── Mist billboards ──────────────────────────────────────────────────────────
export const mistVert = (common) => /* glsl */`
${common}
attribute vec3 aCenter;
attribute vec4 aParam;   // sizeX, sizeY, seed, drift speed
varying vec2 vUv;
varying vec3 vWp;
varying float vSeed;
uniform vec2 uWrapX;     // x0, span
void main(){
  vUv = uv;
  vSeed = aParam.z;
  vec3 c = aCenter;
  c.x = uWrapX.x + mod(c.x - uWrapX.x + uWindDir.x*uTime*aParam.w, uWrapX.y);
  c.z += uWindDir.y*uTime*aParam.w*0.4;
  c.y += sin(uTime*0.05 + aParam.z*9.0)*1.5;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec2 off = (uv - 0.5) * vec2(aParam.x, aParam.y) * 2.0;
  vec3 wp = c + right*off.x + up*off.y;
  vWp = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
export const mistFrag = (common) => /* glsl */`
${common}
varying vec2 vUv;
varying vec3 vWp;
varying float vSeed;
uniform float uMistGain;
void main(){
  vec3 toP = vWp - cameraPosition;
  float dist = length(toP);
  vec3 vd = toP / max(dist, 0.001);
  vec2 c = vUv*2.0 - 1.0;
  float radial = smoothstep(1.0, 0.15, length(c));
  float n = fbm(vUv*vec2(3.0, 2.0) + vSeed*17.0 + vec2(uTime*0.016, uTime*0.005));
  float alpha = radial * smoothstep(0.25, 0.75, n);

  // heightfield-based soft clip so sheets never slice the terrain hard
  float gh = groundH(vWp.xz);
  alpha *= smoothstep(0.0, 5.0, vWp.y - gh);
  alpha *= smoothstep(8.0, 40.0, dist);

  float sv = sunVis(vWp.xz);
  float forward = pow(max(dot(vd, uSunDir), 0.0), 5.0);
  vec3 col = uSkyZenith*0.75 + uHorizonCold*0.25;
  col += uSunColor * 0.05 * sv * (0.22 + forward*1.6);
  col = mix(col, uHorizonWarm*1.1, forward*sv*0.35);
  gl_FragColor = vec4(col, alpha * uMistGain);
}
`;

// ── Drifting particles (pollen / snow crystals in sunbeams) ─────────────────
export const moteVert = (common) => /* glsl */`
${common}
attribute float aSeed;
varying float vLight;
varying float vSeed;
uniform vec3 uMoteCenter;
void main(){
  vSeed = aSeed;
  vec3 p = position;
  float t = uTime;
  p.x += uWindDir.x*t*0.55 + sin(t*0.5 + aSeed*13.0)*0.7;
  p.z += uWindDir.y*t*0.55 + cos(t*0.4 + aSeed*7.0)*0.7;
  p.y += sin(t*0.33 + aSeed*23.0)*0.5;
  vec3 box = vec3(120.0, 9.0, 120.0);
  p = mod(p - uMoteCenter + box*0.5, box) - box*0.5 + uMoteCenter;
  vec3 toP = p - cameraPosition;
  float dist = length(toP);
  vec3 vd = toP / max(dist, 0.001);
  float sv = sunVis(p.xz);
  float forward = pow(max(dot(vd, uSunDir), 0.0), 8.0);
  vLight = sv * (0.04 + forward*3.0);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_PointSize = clamp(140.0 / max(dist, 1.0), 0.5, 5.0);
  gl_Position = projectionMatrix * mv;
}
`;
export const moteFrag = (common) => /* glsl */`
${common}
varying float vLight;
varying float vSeed;
void main(){
  vec2 c = gl_PointCoord*2.0 - 1.0;
  float a = smoothstep(1.0, 0.2, length(c));
  vec3 col = mix(vec3(1.0, 0.85, 0.6), vec3(0.9, 0.95, 1.0), step(0.7, vSeed)) * uSunColor * 0.25;
  float alpha = a * clamp(vLight, 0.0, 1.0);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col * vLight, alpha);
}
`;

// ── Insects ──────────────────────────────────────────────────────────────────
export const insectVert = (common) => /* glsl */`
${common}
attribute float aSeed;
varying float vGlow;
void main(){
  vec3 p = position;
  float t = uTime;
  float s = aSeed*43.7;
  p.x += sin(t*(2.0 + fract(s)*3.0) + s)*0.5 + sin(t*0.7 + s*2.0)*0.9;
  p.y += sin(t*(3.1 + fract(s*1.3)*2.0) + s*3.0)*0.30;
  p.z += cos(t*(2.4 + fract(s*0.7)*3.0) + s*5.0)*0.5;
  vec3 toP = p - cameraPosition;
  float dist = length(toP);
  vec3 vd = toP / max(dist, 0.001);
  vGlow = pow(max(dot(vd, uSunDir), 0.0), 6.0) * sunVis(p.xz);
  gl_PointSize = clamp(60.0 / max(dist, 1.0), 1.0, 4.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
export const insectFrag = (common) => /* glsl */`
${common}
varying float vGlow;
void main(){
  vec2 c = gl_PointCoord*2.0 - 1.0;
  float a = smoothstep(1.0, 0.3, length(c));
  vec3 col = vec3(0.02, 0.02, 0.02) + uSunColor*0.12*vGlow;
  gl_FragColor = vec4(col, a*0.85);
}
`;

// ── Dew droplets ─────────────────────────────────────────────────────────────
export const dewVert = (common) => /* glsl */`
${common}
attribute float aSeed;
varying float vSpark;
void main(){
  vec3 p = position;
  float g = gust(p.xz);
  p.x += g*0.05; // droplets ride the blade tips
  vec3 toP = p - cameraPosition;
  float dist = length(toP);
  vec3 vd = toP / max(dist, 0.001);
  float forward = pow(max(dot(vd, uSunDir), 0.0), 24.0);
  vSpark = (0.10 + forward*8.0) * sunVis(p.xz) * smoothstep(28.0, 6.0, dist);
  gl_PointSize = clamp(50.0 / max(dist, 1.0), 0.5, 4.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
export const dewFrag = (common) => /* glsl */`
${common}
varying float vSpark;
void main(){
  vec2 c = gl_PointCoord*2.0 - 1.0;
  float a = smoothstep(1.0, 0.1, length(c));
  float alpha = a * clamp(vSpark, 0.0, 1.0);
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(uSunColor * 0.4 * vSpark + uSkyZenith*0.3, alpha);
}
`;

// ── Driftwood / roots ────────────────────────────────────────────────────────
export const woodVert = /* glsl */`
varying vec3 vWp;
varying vec3 vNrm;
void main(){
  vWp = (modelMatrix * vec4(position, 1.0)).xyz;
  vNrm = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
export const woodFrag = (common) => /* glsl */`
${common}
varying vec3 vWp;
varying vec3 vNrm;
void main(){
  vec3 toP = vWp - cameraPosition;
  float dist = length(toP);
  vec3 vd = toP / max(dist, 0.001);
  vec3 N = normalize(vNrm);
  float grain = fbm(vec2(vWp.x*1.5 + vWp.z*1.5, vWp.y*14.0));
  vec3 alb = mix(vec3(0.23, 0.17, 0.12), vec3(0.42, 0.34, 0.25), grain);
  alb = mix(alb, vec3(0.55, 0.52, 0.46), smoothstep(0.7, 0.9, grain)*0.5); // silvered weathering
  float relH = vWp.y - uWaterY;
  float wetM = 1.0 - smoothstep(0.02, 0.35, relH);
  alb *= 1.0 - 0.5*wetM;
  vec3 col = litSurface(alb, N, vWp, vd, 0.06 + wetM*0.4, mix(0.8, 0.3, wetM), 0.8);
  col = applyAtmo(col, vWp);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ── Birds: circling silhouettes with wing flap ───────────────────────────────
export const birdVert = (common) => /* glsl */`
${common}
attribute vec3 aOffset;
attribute vec4 aParam;   // orbit radius, angular speed, phase, scale
varying vec2 vUv;
varying vec3 vWp;
void main(){
  vUv = uv;
  float R = aParam.x, w = aParam.y, ph = aParam.z, sc = aParam.w;
  float a = ph + uTime*w;
  vec3 c = aOffset + vec3(cos(a)*R, sin(a*2.13 + ph)*5.0, sin(a)*R);
  vec3 lp = position;
  float flap = sin(uTime*(6.5 + fract(ph)*3.0) + ph*9.0);
  flap *= 0.25 + 0.75*smoothstep(0.35, 0.55, fract(uTime*0.05 + ph*0.37)); // glide phases
  lp.y += abs(lp.x)*flap*0.7;
  float hd = (w > 0.0) ? -a : 3.14159265 - a;   // face direction of travel
  float cy = cos(hd), sy = sin(hd);
  vec3 rp = vec3(lp.x*cy + lp.z*sy, lp.y, -lp.x*sy + lp.z*cy);
  vec3 wp = c + rp*sc;
  vWp = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
export const birdFrag = (common) => /* glsl */`
${common}
varying vec2 vUv;
varying vec3 vWp;
void main(){
  vec2 q = vUv - 0.5;
  float halfw = mix(0.42, 0.05, clamp(abs(q.x)*2.0, 0.0, 1.0));
  if (abs(q.y) > halfw*0.5) discard;
  vec3 toP = vWp - cameraPosition;
  vec3 vd = toP/max(length(toP), 0.001);
  vec3 col = vec3(0.035, 0.033, 0.035);
  col += uSunColor*0.03*pow(max(dot(vd, uSunDir), 0.0), 3.0);
  col = applyAtmo(col, vWp);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ── Fish-rise rings on calm pools ────────────────────────────────────────────
export const ringVert = (common) => /* glsl */`
${common}
attribute vec3 aOffset;
attribute vec4 aParam;   // size, seed, cycle speed, _
varying vec2 vUv;
varying vec3 vWp;
varying float vPh;
varying float vAct;
void main(){
  vUv = uv;
  float seed = aParam.y, spd = aParam.z;
  float cyc = floor(uTime*spd + seed*7.0);
  vAct = step(hash12(vec2(cyc, seed*31.0)), 0.30);   // most cycles stay quiet
  vPh = fract(uTime*spd + seed*7.0);
  vec3 wp = aOffset + vec3((uv.x - 0.5)*aParam.x, 0.0, (uv.y - 0.5)*aParam.x);
  vWp = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
export const ringFrag = (common) => /* glsl */`
${common}
varying vec2 vUv;
varying vec3 vWp;
varying float vPh;
varying float vAct;
void main(){
  if (vAct < 0.5) discard;
  vec2 c = vUv*2.0 - 1.0;
  float r = length(c);
  float ring  = exp(-pow((r - vPh*0.95)*16.0, 2.0));
  float ring2 = exp(-pow((r - max(vPh - 0.18, 0.0)*0.95)*20.0, 2.0))*0.5;
  float plop  = exp(-r*r*40.0) * smoothstep(0.10, 0.02, vPh);
  float a = (ring + ring2)*(1.0 - vPh)*0.45 + plop*0.9;
  float sv = sunVis(vWp.xz);
  vec3 col = uSkyZenith*1.0 + uSunColor*0.12*sv;
  a *= smoothstep(160.0, 30.0, length(vWp - cameraPosition));
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0)*0.7);
}
`;

// ── Splash droplets at rapids, shorelines, wet boulders ─────────────────────
export const splashVert = (common) => /* glsl */`
${common}
attribute vec4 aParam;   // seed, rate, height, spread
varying float vA;
void main(){
  float seed = aParam.x;
  float cyc = floor(uTime*aParam.y + seed*17.0);
  float ph  = fract(uTime*aParam.y + seed*17.0);
  vec2 dir = normalize(hash22(vec2(seed*43.0, cyc)) - 0.5 + vec2(0.001));
  vec3 p = position;
  p.xz += dir * ph * aParam.w;
  p.y  += aParam.z * 4.0*ph*(1.0 - ph);
  vec3 toP = p - cameraPosition;
  float dist = length(toP);
  float sv = sunVis(p.xz);
  float back = pow(max(dot(toP/dist, uSunDir), 0.0), 4.0);
  vA = (1.0 - ph)*(1.0 - ph) * smoothstep(80.0, 14.0, dist) * (0.30 + 0.70*sv) * (0.5 + back*1.5);
  gl_PointSize = clamp(160.0*aParam.z*(1.0 - ph*0.5)/max(dist, 1.0), 0.5, 7.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
export const splashFrag = (common) => /* glsl */`
${common}
varying float vA;
void main(){
  vec2 c = gl_PointCoord*2.0 - 1.0;
  float a = smoothstep(1.0, 0.25, length(c)) * clamp(vA, 0.0, 1.0);
  if (a < 0.02) discard;
  vec3 col = uSkyZenith*1.2 + uSunColor*0.22;
  gl_FragColor = vec4(col, a);
}
`;

// ── Post: ACES tonemap, adaptive exposure, vignette, grain ──────────────────
export const postVert = /* glsl */`
varying vec2 vUv;
void main(){
  vUv = position.xy*0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;
export const postFrag = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene;
uniform float uExposure;
uniform float uT;
float phash(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 aces(vec3 x){
  return clamp(x*(2.51*x + 0.03)/(x*(2.43*x + 0.59) + 0.14), 0.0, 1.0);
}
void main(){
  vec3 c = texture2D(tScene, vUv).rgb;
  c *= uExposure;
  c = aces(c);
  c = pow(c, vec3(1.02, 1.0, 0.985));
  float r = length(vUv - 0.5);
  c *= 1.0 - 0.30*r*r;
  c += (phash(vUv*vec2(1913.0, 1021.0) + fract(uT)*7.0) - 0.5)*0.007;
  c = pow(max(c, vec3(0.0)), vec3(1.0/2.2));
  gl_FragColor = vec4(c, 1.0);
}
`;
