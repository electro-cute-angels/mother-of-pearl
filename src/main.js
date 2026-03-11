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
camera.position.set(0, 0, 5.5);
camera.lookAt(0, 0, 0);

// ═══════════════════════════════════════════════════════════════
// Triple inverted pendulum with nacre shader
// ═══════════════════════════════════════════════════════════════

const SEG_W = 0.30;
const SEG_LENGTHS = [1.2, 1.0, 0.8]; // bottom, middle, top
const SEG_DEPTH   = 0.12;

const material = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader,
  uniforms: {
    uTime: { value: 0 },
    uTilt: { value: new THREE.Vector2(0, 0) },
  },
  side: THREE.DoubleSide,
});

// Each segment: pivot at bottom-center, geometry extends upward
const segments = [];  // { pivot, angle, angVel }
let parentGroup = scene;

for (let i = 0; i < 3; i++) {
  const h = SEG_LENGTHS[i];
  const geo = new THREE.BoxGeometry(SEG_W, h, SEG_DEPTH, 4, 16, 4);
  geo.translate(0, h / 2, 0);  // pivot at bottom

  const mesh = new THREE.Mesh(geo, material);

  const pivot = new THREE.Group();
  pivot.add(mesh);

  if (i === 0) {
    // Base of pendulum at bottom of screen
    pivot.position.set(0, -1.4, 0);
    scene.add(pivot);
  } else {
    // Attach at the top of the previous segment
    pivot.position.set(0, SEG_LENGTHS[i - 1], 0);
    segments[i - 1].pivot.children[0].add(pivot);
  }

  segments.push({ pivot, angle: 0, angVel: 0, length: h });
  parentGroup = pivot;
}

// ── Add a small sphere at each joint (the "screw") ──
const jointGeo = new THREE.SphereGeometry(0.06, 16, 16);
const jointMat = new THREE.MeshBasicMaterial({ color: 0x333333 });

// Base joint
const baseJoint = new THREE.Mesh(jointGeo, jointMat);
baseJoint.position.set(0, -1.4, 0);
scene.add(baseJoint);

// Joints between segments
for (let i = 0; i < 2; i++) {
  const joint = new THREE.Mesh(jointGeo, jointMat);
  joint.position.set(0, SEG_LENGTHS[i], 0);
  segments[i].pivot.children[0].add(joint);
}

// ═══════════════════════════════════════════════════════════════
// Pendulum physics
// ═══════════════════════════════════════════════════════════════

const GRAVITY   = 4.0;
const DAMPING   = 0.985;
const STIFFNESS = 2.5;  // restoring spring toward upright

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

  const dt = Math.min(clock.getDelta(), 0.05); // cap large spikes
  const t  = clock.elapsedTime;
  material.uniforms.uTime.value = t;

  // Smooth lerp toward target tilt
  tilt.x += (tiltTarget.x - tilt.x) * 0.08;
  tilt.y += (tiltTarget.y - tilt.y) * 0.08;
  material.uniforms.uTilt.value.set(tilt.x, tilt.y);

  // ── Pendulum physics (simple Euler per segment) ──
  // Tilt acts as an external force (like tilting the base)
  const force = tilt.x * 3.0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    // Cascade: each segment feels more instability from segments below
    const cascade = (i + 1) * 1.5;
    const accel =
      -GRAVITY * Math.sin(seg.angle) * cascade +  // gravity
      -STIFFNESS * seg.angle +                     // restoring spring
       force * cascade * 0.35;                     // gyroscope / mouse

    seg.angVel += accel * dt;
    seg.angVel *= DAMPING;
    seg.angle  += seg.angVel * dt;
    seg.angle   = THREE.MathUtils.clamp(seg.angle, -0.7, 0.7);

    seg.pivot.rotation.z = seg.angle;
  }

  renderer.render(scene, camera);
}

animate();

