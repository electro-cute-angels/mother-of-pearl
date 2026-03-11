import * as THREE from 'three';
import './style.css';

// ═══════════════════════════════════════════════════════════════
// GLSL — Vertex Shader
// ═══════════════════════════════════════════════════════════════

const vertexShader = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec2 vUv;

void main() {
  vUv = uv;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  // World-space normal (safe for uniform scale / rotation only)
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

// ═══════════════════════════════════════════════════════════════
// GLSL — Fragment Shader  (thin-film interference nacre)
// ═══════════════════════════════════════════════════════════════

const fragmentShader = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec2 vUv;

uniform float uTime;
uniform vec2  uTilt;   // x = left/right, y = forward/back — from gyroscope or mouse

/* ── Procedural noise (gradient-value hybrid) ── */

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)),
           dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = dot(hash2(i),               f);
  float b = dot(hash2(i + vec2(1, 0)),   f - vec2(1, 0));
  float c = dot(hash2(i + vec2(0, 1)),   f - vec2(0, 1));
  float d = dot(hash2(i + vec2(1, 1)),   f - vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) + 0.5;
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p  = rot * p * 2.0;
    a *= 0.5;
  }
  return v;
}

/* ── Wavelength (nm) → approximate sRGB ── */

vec3 wavelengthToRGB(float l) {
  vec3 c;
  if      (l < 410.0) { float t = (l - 380.0) / 30.0;                    c = vec3(0.33 * t,        0.0,            t); }
  else if (l < 460.0) { float t = (l - 410.0) / 50.0;                    c = vec3(0.33 * (1.0-t),  0.0,            1.0); }
  else if (l < 490.0) { float t = (l - 460.0) / 30.0;                    c = vec3(0.0,             t,              1.0); }
  else if (l < 510.0) { float t = (l - 490.0) / 20.0;                    c = vec3(0.0,             1.0,            1.0 - t); }
  else if (l < 580.0) { float t = (l - 510.0) / 70.0;                    c = vec3(t,               1.0,            0.0); }
  else if (l < 640.0) { float t = (l - 580.0) / 60.0;                    c = vec3(1.0,             1.0 - t,        0.0); }
  else                 { float t = clamp((l - 640.0) / 60.0, 0.0, 1.0);  c = vec3(1.0 - 0.5 * t,  0.0,            0.0); }

  // Fade at the edges of the visible spectrum
  float edge = 1.0;
  if      (l < 420.0) edge = 0.3 + 0.7 * (l - 380.0) / 40.0;
  else if (l > 680.0) edge = 0.3 + 0.7 * (720.0 - l) / 40.0;
  return c * edge;
}

/* ── Thin-film interference — Airy reflectance ── */

float thinFilmR(float lambda, float cosI, float d, float n0, float n1) {
  // Snell's law
  float sinI = sqrt(max(1.0 - cosI * cosI, 0.0));
  float sinT = (n0 / n1) * sinI;
  if (sinT >= 1.0) return 1.0;            // total internal reflection
  float cosT = sqrt(1.0 - sinT * sinT);

  // Optical path difference → phase
  float delta = 4.0 * 3.14159265 * n1 * d * cosT / lambda;

  // Fresnel reflectance at one interface (Schlick)
  float R0 = pow((n0 - n1) / (n0 + n1), 2.0);

  // Airy summation
  float num = 2.0 * R0 * (1.0 - cos(delta));
  float den = 1.0 + R0 * R0 - 2.0 * R0 * cos(delta);
  return clamp(num / max(den, 0.0001), 0.0, 1.0);
}

/* ── Rotate a vector around an axis (Rodrigues) ── */

vec3 rotateAxis(vec3 v, vec3 axis, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}

/* ── Main ── */

void main() {
  vec3 N = normalize(vNormal);

  // Tilt the normal as if rotating the shell in your hand
  N = rotateAxis(N, vec3(1.0, 0.0, 0.0), uTilt.y);  // tilt forward/back
  N = rotateAxis(N, vec3(0.0, 1.0, 0.0), uTilt.x);  // tilt left/right
  N = normalize(N);

  vec3 V = normalize(cameraPosition - vWorldPos);
  float NdotV = max(dot(N, V), 0.001);

  // ── Organic thickness variation (simulates natural aragonite platelet layout) ──
  float nv  = fbm(vUv * 8.0 + uTime * 0.02);
  float baseD = 380.0;  // nm — typical nacre platelet thickness
  float varD  = 130.0 * nv
              + 55.0 * sin(vUv.x * 18.0 + uTime * 0.12)
              + 45.0 * cos(vUv.y * 14.0 - uTime * 0.09)
              + 30.0 * sin(vUv.x * 7.0 + vUv.y * 9.0 + uTime * 0.06);

  // ── Multi-layer thin-film iridescence ──
  //    7 stacked aragonite layers × 16 spectral samples for richer color
  vec3 iri = vec3(0.0);
  for (int layer = 0; layer < 7; layer++) {
    float d  = baseD + varD + float(layer) * 38.0;
    vec3  lc = vec3(0.0);
    for (int w = 0; w < 16; w++) {
      float lam = 380.0 + float(w) * 21.25;  // 380 → 720 nm
      lc += wavelengthToRGB(lam) * thinFilmR(lam, NdotV, d, 1.0, 1.58);
    }
    float attenuation = 1.0 - float(layer) * 0.08;
    iri += lc * attenuation / 16.0;
  }
  iri /= 7.0;

  // ── Warm nacre base ──
  vec3 warmBase = mix(
    vec3(0.97, 0.94, 0.91),
    vec3(0.96, 0.90, 0.86),
    fbm(vUv * 3.0 + 0.5)
  );

  // ── Fresnel rim ──
  float fres = pow(1.0 - NdotV, 4.0);

  // ── Three-point pearlescent specular ──
  vec3 L1 = normalize(vec3( 3.0, 5.0,  4.0));
  vec3 L2 = normalize(vec3(-4.0, 3.0, -2.0));
  vec3 L3 = normalize(vec3( 1.0,-2.0,  5.0));
  float s1 = pow(max(dot(N, normalize(V + L1)), 0.0), 128.0);
  float s2 = pow(max(dot(N, normalize(V + L2)), 0.0),  64.0);
  float s3 = pow(max(dot(N, normalize(V + L3)), 0.0),  96.0);

  // ── Diffuse (half-lambert for soft wrap) ──
  float diff = dot(N, L1) * 0.5 + 0.5;

  // ── Sub-surface translucency ──
  float trans = pow(max(dot(-N, L1), 0.0), 3.0) * 0.06;

  // ── Compose ──
  vec3 col = vec3(0.0);

  // Diffuse base
  col += warmBase * diff * 0.22;

  // Iridescence (boosted at grazing angles, like real nacre)
  col += iri * (0.65 + fres * 0.55) * 3.2;

  // Specular
  col += vec3(1.00, 0.98, 0.95) * s1 * 0.85;
  col += vec3(0.95, 0.98, 1.00) * s2 * 0.35;
  col += vec3(1.00, 0.95, 0.98) * s3 * 0.25;

  // Rim glow
  vec3 rim = mix(
    vec3(0.85, 0.92, 1.0),
    vec3(1.0, 0.90, 0.95),
    sin(vUv.x * 8.0) * 0.5 + 0.5
  );
  col += rim * fres * 0.35;

  // Translucency
  col += vec3(1.0, 0.92, 0.87) * trans;

  // Subtle shimmer
  col += sin(vUv.x * 55.0 + uTime * 0.35)
       * cos(vUv.y * 42.0 - uTime * 0.25)
       * 0.008 * (1.0 - NdotV);

  // ACES-ish tone mapping
  col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);

  // Gamma
  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));

  gl_FragColor = vec4(col, 1.0);
}
`;

// ═══════════════════════════════════════════════════════════════
// Three.js Scene
// ═══════════════════════════════════════════════════════════════

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000);
document.body.appendChild(renderer.domElement);

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  100,
);

// Fixed camera — pulled back to see the full pendulum
camera.position.set(0, 0, 6.0);
camera.lookAt(0, 0.3, 0);

// ═══════════════════════════════════════════════════════════════
// Materials
// ═══════════════════════════════════════════════════════════════

const nacreMat = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader,
  uniforms: {
    uTime: { value: 0 },
    uTilt: { value: new THREE.Vector2(0, 0) },
  },
  side: THREE.DoubleSide,
});

const metalMat = new THREE.MeshStandardMaterial({
  color: 0x888888,
  metalness: 0.85,
  roughness: 0.25,
});

const darkMetal = new THREE.MeshStandardMaterial({
  color: 0x444444,
  metalness: 0.9,
  roughness: 0.3,
});

const brassMat = new THREE.MeshStandardMaterial({
  color: 0xb5a642,
  metalness: 0.9,
  roughness: 0.2,
});

const copperMat = new THREE.MeshStandardMaterial({
  color: 0xb87333,
  metalness: 0.85,
  roughness: 0.3,
});

const rubberMat = new THREE.MeshStandardMaterial({
  color: 0x1a1a1a,
  metalness: 0.0,
  roughness: 0.95,
});

// ═══════════════════════════════════════════════════════════════
// Lighting for metal parts
// ═══════════════════════════════════════════════════════════════

const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
scene.add(ambientLight);

const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight1.position.set(3, 5, 4);
scene.add(dirLight1);

const dirLight2 = new THREE.DirectionalLight(0x8899bb, 0.4);
dirLight2.position.set(-4, 3, -2);
scene.add(dirLight2);

// ═══════════════════════════════════════════════════════════════
// Geometry helpers
// ═══════════════════════════════════════════════════════════════

function createHexBolt(radius, height) {
  const group = new THREE.Group();

  // Hex head with chamfered edges
  const hexGeo = new THREE.CylinderGeometry(radius, radius * 0.92, height * 0.35, 6);
  const hexMesh = new THREE.Mesh(hexGeo, brassMat);
  hexMesh.position.y = height * 0.175;
  group.add(hexMesh);

  // Socket detail on top of hex head
  const socketGeo = new THREE.CylinderGeometry(radius * 0.35, radius * 0.35, height * 0.12, 6);
  const socket = new THREE.Mesh(socketGeo, darkMetal);
  socket.position.y = height * 0.38;
  group.add(socket);

  // Washer
  const washerGeo = new THREE.TorusGeometry(radius * 1.1, radius * 0.25, 8, 24);
  const washer = new THREE.Mesh(washerGeo, metalMat);
  washer.rotation.x = Math.PI / 2;
  washer.position.y = -height * 0.02;
  group.add(washer);

  // Lock washer (split ring)
  const lockGeo = new THREE.TorusGeometry(radius * 0.8, radius * 0.12, 6, 20, Math.PI * 1.8);
  const lockWasher = new THREE.Mesh(lockGeo, copperMat);
  lockWasher.rotation.x = Math.PI / 2;
  lockWasher.position.y = -height * 0.08;
  group.add(lockWasher);

  // Threaded shaft
  const shaftGeo = new THREE.CylinderGeometry(radius * 0.35, radius * 0.35, height * 0.6, 12);
  const shaft = new THREE.Mesh(shaftGeo, darkMetal);
  shaft.position.y = -height * 0.35;
  group.add(shaft);

  return group;
}

function createBearingHousing(radius) {
  const group = new THREE.Group();

  // Outer housing
  const outerGeo = new THREE.TorusGeometry(radius, radius * 0.3, 12, 24);
  const outer = new THREE.Mesh(outerGeo, darkMetal);
  outer.rotation.x = Math.PI / 2;
  group.add(outer);

  // Inner race
  const innerGeo = new THREE.TorusGeometry(radius * 0.55, radius * 0.15, 8, 24);
  const inner = new THREE.Mesh(innerGeo, metalMat);
  inner.rotation.x = Math.PI / 2;
  group.add(inner);

  // Mounting flange (rectangular with holes)
  const flangeGeo = new THREE.BoxGeometry(radius * 3.5, radius * 3.5, radius * 0.2);
  const flange = new THREE.Mesh(flangeGeo, metalMat);
  group.add(flange);

  // Flange mounting holes (4 corners)
  for (const [fx, fy] of [[-1,1],[1,1],[1,-1],[-1,-1]]) {
    const holeGeo = new THREE.CylinderGeometry(radius * 0.2, radius * 0.2, radius * 0.25, 8);
    const hole = new THREE.Mesh(holeGeo, darkMetal);
    hole.rotation.x = Math.PI / 2;
    hole.position.set(fx * radius * 1.3, fy * radius * 1.3, 0);
    group.add(hole);
  }

  return group;
}

function createRod(length, radius) {
  const geo = new THREE.CylinderGeometry(radius, radius, length, 16);
  geo.translate(0, length / 2, 0);
  return new THREE.Mesh(geo, metalMat);
}

function createNacrePanel(w, h, depth) {
  const geo = new THREE.BoxGeometry(w, h, depth, 4, 16, 4);
  const panel = new THREE.Mesh(geo, nacreMat);

  // Metal trim frame around the panel edges
  const trimR = 0.008;
  const trimMat = metalMat;

  // Horizontal trims (top and bottom)
  for (const ySign of [-1, 1]) {
    const tGeo = new THREE.CylinderGeometry(trimR, trimR, w + 0.02, 6);
    tGeo.rotateZ(Math.PI / 2);
    const trim = new THREE.Mesh(tGeo, trimMat);
    trim.position.y = ySign * h / 2;
    trim.position.z = depth / 2 + trimR;
    panel.add(trim);
  }

  // Vertical trims (left and right)
  for (const xSign of [-1, 1]) {
    const tGeo = new THREE.CylinderGeometry(trimR, trimR, h + 0.02, 6);
    const trim = new THREE.Mesh(tGeo, trimMat);
    trim.position.x = xSign * w / 2;
    trim.position.z = depth / 2 + trimR;
    panel.add(trim);
  }

  // Small rivets along edges
  const rivetGeo = new THREE.SphereGeometry(0.012, 6, 6);
  const rivetCount = Math.floor(h / 0.1);
  for (let side = -1; side <= 1; side += 2) {
    for (let r = 0; r < rivetCount; r++) {
      const rivet = new THREE.Mesh(rivetGeo, brassMat);
      rivet.position.set(
        side * (w / 2 - 0.005),
        -h / 2 + (r + 0.5) * (h / rivetCount),
        depth / 2 + 0.01
      );
      panel.add(rivet);
    }
  }

  return panel;
}

// ═══════════════════════════════════════════════════════════════
// Triple inverted pendulum — mechanical build
// ═══════════════════════════════════════════════════════════════

const ARM_LENGTHS = [1.3, 1.05, 0.8];
const ARM_MASSES  = [3.0, 2.0, 1.0];   // mass ratio bottom → top
const ROD_R = 0.025;
const PANEL_W = 0.22;
const PANEL_DEPTH = 0.06;
const BOLT_R = 0.045;
const BOLT_H = 0.12;

// ── Base platform (heavier, more detailed) ──
const baseGroup = new THREE.Group();
baseGroup.position.set(0, -1.8, 0);
scene.add(baseGroup);

// Main platform
const baseGeo = new THREE.BoxGeometry(1.0, 0.10, 0.40);
const baseMesh = new THREE.Mesh(baseGeo, darkMetal);
baseGroup.add(baseMesh);

// Top plate
const topPlateGeo = new THREE.BoxGeometry(0.5, 0.03, 0.30);
const topPlate = new THREE.Mesh(topPlateGeo, metalMat);
topPlate.position.y = 0.065;
baseGroup.add(topPlate);

// Counterweight block
const cwGeo = new THREE.BoxGeometry(0.6, 0.08, 0.32);
const counterweight = new THREE.Mesh(cwGeo, metalMat);
counterweight.position.y = -0.09;
baseGroup.add(counterweight);

// Rubber feet
for (const xOff of [-0.4, -0.15, 0.15, 0.4]) {
  const footGeo = new THREE.CylinderGeometry(0.04, 0.05, 0.04, 12);
  const foot = new THREE.Mesh(footGeo, rubberMat);
  foot.position.set(xOff, -0.13, 0);
  baseGroup.add(foot);
}

// Side mounting brackets on base
for (const xSign of [-1, 1]) {
  const bracketGeo = new THREE.BoxGeometry(0.04, 0.10, 0.28);
  const bracket = new THREE.Mesh(bracketGeo, metalMat);
  bracket.position.set(xSign * 0.48, 0, 0);
  baseGroup.add(bracket);

  // Bracket bolts
  for (const yOff of [-0.03, 0.03]) {
    const b = createHexBolt(0.025, 0.06);
    b.rotation.x = Math.PI / 2;
    b.position.set(xSign * 0.48, yOff, 0.16);
    baseGroup.add(b);
  }
}

// ── Build segments ──
const segments = [];

for (let i = 0; i < 3; i++) {
  const h = ARM_LENGTHS[i];
  const pivot = new THREE.Group();

  // Two parallel rods
  const rodOffset = 0.06;
  const rodL = createRod(h, ROD_R);
  rodL.position.x = -rodOffset;
  pivot.add(rodL);

  const rodR = createRod(h, ROD_R);
  rodR.position.x = rodOffset;
  pivot.add(rodR);

  // Nacre panel attached between the rods
  const panelH = h * 0.65;
  const panel = createNacrePanel(PANEL_W, panelH, PANEL_DEPTH);
  panel.position.y = h * 0.45;
  pivot.add(panel);

  // Cross braces (small horizontal rods)
  for (const yFrac of [0.15, 0.5, 0.85]) {
    const braceGeo = new THREE.CylinderGeometry(ROD_R * 0.6, ROD_R * 0.6, rodOffset * 2, 8);
    braceGeo.rotateZ(Math.PI / 2);
    const brace = new THREE.Mesh(braceGeo, darkMetal);
    brace.position.y = h * yFrac;
    pivot.add(brace);
  }

  // Diagonal cross brace (X pattern)
  const diagLen = Math.sqrt((rodOffset * 2) ** 2 + (h * 0.35) ** 2);
  const diagAngle = Math.atan2(h * 0.35, rodOffset * 2);
  for (const flip of [1, -1]) {
    const dGeo = new THREE.CylinderGeometry(ROD_R * 0.35, ROD_R * 0.35, diagLen, 6);
    const diag = new THREE.Mesh(dGeo, copperMat);
    diag.position.y = h * 0.5;
    diag.rotation.z = flip * diagAngle;
    pivot.add(diag);
  }

  // Bearing housing at pivot point
  const bearing = createBearingHousing(0.055);
  bearing.position.z = PANEL_DEPTH / 2 + 0.04;
  pivot.add(bearing);

  if (i === 0) {
    pivot.position.set(0, -1.76, 0);
    scene.add(pivot);
  } else {
    pivot.position.set(0, ARM_LENGTHS[i - 1], 0);
    // Attach to the previous pivot group
    segments[i - 1].pivot.add(pivot);
  }

  // Top bolt (where next segment connects, or a cap on the last one)
  const topBolt = createHexBolt(BOLT_R * (i === 2 ? 0.7 : 1.0), BOLT_H * 0.8);
  topBolt.rotation.x = Math.PI / 2;
  topBolt.position.set(0, h, PANEL_DEPTH / 2 + 0.03);
  pivot.add(topBolt);

  segments.push({
    pivot,
    angle: 0,
    angVel: 0,
    length: h,
    mass: ARM_MASSES[i],
  });
}

// ═══════════════════════════════════════════════════════════════
// Lagrangian-derived coupled pendulum physics
// ═══════════════════════════════════════════════════════════════

const G = 9.81;
const DAMP = 2.8;         // strong angular damping (viscous joint friction)
const SPRING = 18.0;      // strong restoring spring at each joint (like a torsion bar)
const SUB_STEPS = 12;     // integration sub-steps per frame for stability

// ═══════════════════════════════════════════════════════════════
// Tilt state — drives the shader uTilt uniform
// ═══════════════════════════════════════════════════════════════

const tilt   = { x: 0, y: 0 };
const tiltTarget = { x: 0, y: 0 };
let useGyro = false;

// ── Desktop: mouse position → tilt ──
window.addEventListener('mousemove', (e) => {
  if (useGyro) return;
  tiltTarget.x = ((e.clientX / window.innerWidth)  - 0.5) * 1.4;  // left/right
  tiltTarget.y = ((e.clientY / window.innerHeight) - 0.5) * 1.0;  // forward/back
});

// ── Mobile: gyroscope → tilt ──
function onDeviceOrientation(e) {
  const beta  = e.beta  || 0;   // forward / back tilt
  const gamma = e.gamma || 0;   // left / right tilt

  tiltTarget.x = THREE.MathUtils.degToRad(gamma) * 1.2;
  tiltTarget.y = THREE.MathUtils.degToRad(beta - 90) * 0.8;
}

function enableGyroscope() {
  useGyro = true;
  window.addEventListener('deviceorientation', onDeviceOrientation, true);
}

// ═══════════════════════════════════════════════════════════════
// Start Button (required for iOS DeviceOrientationEvent permission)
// ═══════════════════════════════════════════════════════════════

const overlay  = document.getElementById('overlay');
const startBtn = document.getElementById('start');

startBtn.addEventListener('click', async () => {
  if (
    typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission === 'function'
  ) {
    try {
      const perm = await DeviceOrientationEvent.requestPermission();
      if (perm === 'granted') enableGyroscope();
    } catch (err) {
      console.warn('Gyroscope permission denied', err);
    }
  } else if (typeof DeviceOrientationEvent !== 'undefined') {
    enableGyroscope();
  }

  overlay.classList.add('hidden');
});

// ═══════════════════════════════════════════════════════════════
// Resize
// ═══════════════════════════════════════════════════════════════

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ═══════════════════════════════════════════════════════════════
// Animation Loop
// ═══════════════════════════════════════════════════════════════

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.05);
  const t  = clock.elapsedTime;
  nacreMat.uniforms.uTime.value = t;

  // Smooth lerp toward target tilt
  tilt.x += (tiltTarget.x - tilt.x) * 0.08;
  tilt.y += (tiltTarget.y - tilt.y) * 0.08;
  nacreMat.uniforms.uTilt.value.set(tilt.x, tilt.y);

  // ── Coupled triple inverted pendulum physics ──
  // The pendulum is stabilized by torsion springs at each joint.
  // Tilting the phone/mouse shifts the effective gravity direction,
  // which the pendulum responds to — like balancing a rod on a moving platform.
  const baseTilt = tilt.x * 2.5;  // effective tilt angle of the base

  const subDt = dt / SUB_STEPS;
  for (let step = 0; step < SUB_STEPS; step++) {
    const a = [];
    for (let i = 0; i < 3; i++) {
      const seg = segments[i];
      const l = seg.length;
      const m = seg.mass;

      // Moment of inertia (uniform rod about end)
      const I = (m * l * l) / 3.0;

      // Gravity torque (destabilising — inverted pendulum)
      // The effective gravity direction is shifted by the base tilt
      const effectiveAngle = seg.angle - baseTilt;
      let torque = m * G * (l / 2) * Math.sin(effectiveAngle);

      // Weight of all segments above this one
      for (let j = i + 1; j < 3; j++) {
        torque += segments[j].mass * G * l * Math.sin(effectiveAngle);
      }

      // Torsion spring restoring torque (pulls toward upright relative to parent)
      const springTorque = -SPRING * seg.angle;

      // Coupling: inertial reaction from upper segment motion
      if (i < 2) {
        const upper = segments[i + 1];
        torque += upper.mass * l * (upper.length / 2) *
                  upper.angVel * upper.angVel * Math.sin(upper.angle - seg.angle) * 0.4;
      }

      // Viscous damping (joint friction)
      const dampTorque = -DAMP * seg.angVel * l;

      a.push((torque + springTorque + dampTorque) / I);
    }

    // Semi-implicit Euler
    for (let i = 0; i < 3; i++) {
      segments[i].angVel += a[i] * subDt;
      segments[i].angle  += segments[i].angVel * subDt;
      segments[i].angle   = THREE.MathUtils.clamp(segments[i].angle, -0.8, 0.8);
    }
  }

  // Apply angles to pivots
  for (let i = 0; i < 3; i++) {
    segments[i].pivot.rotation.z = segments[i].angle;
  }

  renderer.render(scene, camera);
}

animate();

