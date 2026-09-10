// Golden Bluff - 3D chibi avatar builder (Three.js, ES module).
// Stylized "toon" character built entirely from primitive geometry + a cel-shaded
// (toon) material + a backface-expansion outline pass -- no external 3D model assets,
// consistent with this project's "no build step, no external art pipeline" approach.
import * as THREE from './vendor/three.module.min.js';

// ---------- Shared toon gradient (2-3 step cel banding) ----------
function makeGradientMap() {
  const data = new Uint8Array([80, 170, 255]);
  const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  tex.needsUpdate = true;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}
let _gradientMap = null;
function gradientMap() { return _gradientMap || (_gradientMap = makeGradientMap()); }

function toonMat(color) {
  return new THREE.MeshToonMaterial({ color, gradientMap: gradientMap() });
}

// A shade darker than the given body color, for the simple "clothing" trim added below
// (collar/belt) -- ties each accent back to the character's own color instead of a
// fixed tone that would look identical on every avatar.
function darken(color, factor) {
  return color.clone().multiplyScalar(factor);
}

// Wraps a mesh with a slightly-larger, backface-only dark shell -- the classic
// "backface expansion" outline trick. Adds the outline as a sibling in the same
// parent group so it doesn't compound the mesh's own transform.
function withOutline(mesh, group, scale = 1.12, color = 0x0c0810) {
  const outline = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ color, side: THREE.BackSide }));
  outline.position.copy(mesh.position);
  outline.rotation.copy(mesh.rotation);
  outline.scale.copy(mesh.scale).multiplyScalar(scale);
  group.add(outline);
  group.add(mesh);
  return mesh;
}

// ---------- Face texture (drawn on a small canvas, applied as a decal plane) ----------
function makeFaceTexture(face) {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#241a14';
  ctx.strokeStyle = '#241a14';
  ctx.lineCap = 'round';

  const eyeY = 122, eyeDX = 50, eyeR = 24;
  if (face === 'glasses') {
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#1a1410';
    ctx.beginPath(); ctx.moveTo(128 - eyeDX - 30, eyeY); ctx.lineTo(128 - eyeDX + 30, eyeY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(128 + eyeDX - 30, eyeY); ctx.lineTo(128 + eyeDX + 30, eyeY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(128 - eyeDX + 30, eyeY); ctx.lineTo(128 + eyeDX - 30, eyeY); ctx.stroke();
    ctx.fillStyle = '#0c0a10';
    ctx.beginPath(); ctx.arc(128 - eyeDX, eyeY, 32, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(128 + eyeDX, eyeY, 32, 0, Math.PI * 2); ctx.fill();
  } else if (face === 'mask') {
    // A bandit/thief eye-mask band across the eyes.
    ctx.fillStyle = '#20161c';
    ctx.beginPath();
    ctx.moveTo(128 - eyeDX - 40, eyeY - 28);
    ctx.quadraticCurveTo(128, eyeY - 50, 128 + eyeDX + 40, eyeY - 28);
    ctx.quadraticCurveTo(128 + eyeDX + 40, eyeY + 26, 128, eyeY + 34);
    ctx.quadraticCurveTo(128 - eyeDX - 40, eyeY + 26, 128 - eyeDX - 40, eyeY - 28);
    ctx.fill();
    ctx.fillStyle = '#f4d573';
    ctx.beginPath(); ctx.ellipse(128 - eyeDX, eyeY, 10, 14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(128 + eyeDX, eyeY, 10, 14, 0, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = '#241a14';
    ctx.beginPath(); ctx.arc(128 - eyeDX, eyeY, eyeR, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(128 + eyeDX, eyeY, eyeR, 0, Math.PI * 2); ctx.fill();
    // A bold highlight in each eye for life, sized to still read at small sizes.
    ctx.fillStyle = '#fff8e8';
    ctx.beginPath(); ctx.arc(128 - eyeDX + 8, eyeY - 8, 7, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(128 + eyeDX + 8, eyeY - 8, 7, 0, Math.PI * 2); ctx.fill();
    // Eyebrows, angled per expression.
    ctx.strokeStyle = '#241a14';
    ctx.lineWidth = 12;
    const brow = face === 'smirk' ? [-1, 1] : face === 'surprised' ? [-0.2, -0.2] : [-0.3, -0.3];
    ctx.beginPath(); ctx.moveTo(128 - eyeDX - 28, eyeY - 34); ctx.lineTo(128 - eyeDX + 24, eyeY - 34 + brow[0] * 12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(128 + eyeDX + 28, eyeY - 34); ctx.lineTo(128 + eyeDX - 24, eyeY - 34 + brow[1] * 12); ctx.stroke();
  }

  // Mouth
  ctx.lineWidth = 13;
  ctx.strokeStyle = '#241a14';
  ctx.beginPath();
  if (face === 'surprised') {
    ctx.fillStyle = '#241a14';
    ctx.beginPath(); ctx.ellipse(128, 180, 22, 26, 0, 0, Math.PI * 2); ctx.fill();
  } else if (face === 'smirk') {
    ctx.moveTo(98, 182); ctx.quadraticCurveTo(140, 202, 164, 166); ctx.stroke();
  } else {
    ctx.moveTo(88, 174); ctx.quadraticCurveTo(128, 216, 168, 174); ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // This decal is always viewed at roughly the same size, so skip mipmapping entirely --
  // it's unnecessary here and sidesteps mip-chain generation quirks on some GPU drivers.
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

// ---------- Hat builders: each returns a THREE.Group positioned to sit on the head ----------
const HAT_BUILDERS = {
  none: () => null,
  cap: (group, accentColor) => {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.62, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), toonMat(accentColor));
    withOutline(dome, group);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 0.08, 20, 1, false, -0.5, Math.PI + 1), toonMat(accentColor));
    brim.position.set(0, -0.02, 0.28);
    brim.rotation.x = -0.06;
    withOutline(brim, group);
  },
  cone: (group, accentColor) => {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.05, 20), toonMat(accentColor));
    cone.position.y = 0.5;
    withOutline(cone, group);
    const brimRing = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.07, 10, 24), toonMat(accentColor));
    brimRing.rotation.x = Math.PI / 2;
    withOutline(brimRing, group);
  },
  crown: (group, accentColor) => {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.66, 0.34, 16), toonMat(accentColor));
    withOutline(band, group);
    const n = 5;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.34, 8), toonMat(accentColor));
      spike.position.set(Math.cos(a) * 0.55, 0.32, Math.sin(a) * 0.55);
      withOutline(spike, group);
    }
  },
  band: (group, accentColor) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.63, 0.09, 10, 24), toonMat(accentColor));
    ring.rotation.x = Math.PI / 2;
    withOutline(ring, group);
  },
};

// ---------- Character-specific accessory overrides for card art (hood/helmet/etc.) ----------
export const CHARACTER_ACCESSORY = {
  ROYAL:     { hat: 'crown', accentColor: 0xe8c14a, face: null },
  THIEF:     { hat: 'hood',  accentColor: 0x3fae74, face: 'mask' },
  GUARD:     { hat: 'helmet', accentColor: 0x4a93d9, face: null },
  SEER:      { hat: 'hoodOrb', accentColor: 0x9660e0, face: null },
  TRICKSTER: { hat: 'jester', accentColor: 0xdd57a8, face: 'mask' },
  ASSASSIN:  { hat: 'hood',  accentColor: 0xdc4a42, face: 'mask' },
};

HAT_BUILDERS.hood = (group, accentColor) => {
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.72, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), toonMat(accentColor));
  hood.position.y = 0.02;
  withOutline(hood, group);
};
HAT_BUILDERS.helmet = (group, accentColor) => {
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.68, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.58), toonMat(accentColor));
  withOutline(dome, group);
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 1.15), toonMat(accentColor));
  ridge.position.y = 0.22;
  withOutline(ridge, group);
};
HAT_BUILDERS.hoodOrb = (group, accentColor) => {
  HAT_BUILDERS.hood(group, accentColor);
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), new THREE.MeshPhysicalMaterial({ color: accentColor, roughness: 0.15, transmission: 0.6, thickness: 0.3 }));
  orb.position.set(0, -0.15, 0.85);
  group.add(orb);
};
HAT_BUILDERS.jester = (group, accentColor) => {
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.63, 0.63, 0.22, 16), toonMat(accentColor));
  withOutline(band, group);
  [-1, 1].forEach((side) => {
    const point = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 10), toonMat(accentColor));
    point.position.set(side * 0.42, 0.32, 0);
    point.rotation.z = side * 0.35;
    withOutline(point, group);
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), toonMat(0xf4d573));
    bell.position.set(side * 0.42 + side * 0.16, 0.5, 0);
    group.add(bell);
  });
};

// ---------- The chibi character itself ----------
// config: { bodyColor: '#rrggbb', hat: 'none'|'cap'|'cone'|'crown'|'band', face: 'happy'|'smirk'|'surprised'|'glasses'|'mask' }
// charOverride: an entry from CHARACTER_ACCESSORY, or null for the player's own customized look.
export function buildAvatarGroup(config, charOverride) {
  const root = new THREE.Group();
  const bodyColor = new THREE.Color(config.bodyColor || '#e8b04a');
  const bodyMat = toonMat(bodyColor);

  // Legs
  [-0.22, 0.22].forEach((x) => {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.22, 4, 10), bodyMat);
    leg.position.set(x, -0.78, 0);
    withOutline(leg, root);
  });

  // Torso -- short and stubby (chibi proportions).
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.32, 6, 14), bodyMat);
  torso.position.y = -0.28;
  withOutline(torso, root);

  // Simple "clothing" read (a stretch-goal push at Character fidelity, per Aki's own
  // priority order): a collar trim and a belt, both just rings hugging the torso
  // capsule's own surface, so a single flat-colored body doesn't look like a bare blob.
  // Not an attempt at real garment geometry (no cloth sim, no separate mesh silhouette)
  // -- procedural primitives only, same as everything else here.
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.39, 0.045, 8, 20), toonMat(darken(bodyColor, 0.65)));
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.05;
  withOutline(collar, root, 1.15);

  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.05, 8, 20), toonMat(new THREE.Color('#2a1c12')));
  belt.rotation.x = Math.PI / 2;
  belt.position.y = -0.42;
  withOutline(belt, root, 1.15);

  // Boots -- a short dark cylinder capping each leg, instead of the bare body-colored
  // capsule running straight into the floor.
  [-0.22, 0.22].forEach((x) => {
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.16, 12), toonMat(new THREE.Color('#2a1c12')));
    boot.position.set(x, -1.0, 0.03);
    withOutline(boot, root, 1.12);
  });

  // Arms
  [-0.52, 0.52].forEach((x) => {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.4, 4, 10), bodyMat);
    arm.position.set(x, -0.32, 0);
    arm.rotation.z = x < 0 ? 0.25 : -0.25;
    withOutline(arm, root);
  });

  // Head group -- large, dominant, sits above the torso.
  const headGroup = new THREE.Group();
  headGroup.position.y = 0.42;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.72, 24, 18), bodyMat);
  withOutline(head, headGroup);

  const face = (charOverride && charOverride.face) || config.face || 'happy';
  const facePlane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.86, 0.86),
    new THREE.MeshBasicMaterial({ map: makeFaceTexture(face), transparent: true })
  );
  // z must clear the head sphere's radius (0.72) everywhere under the plane's footprint,
  // or the opaque head mesh clips into the decal and fragments it.
  facePlane.position.set(0, -0.02, 0.75);
  headGroup.add(facePlane);

  const hatKey = (charOverride && charOverride.hat) || config.hat || 'none';
  const hatAccent = charOverride ? charOverride.accentColor : new THREE.Color(config.hatColor || '#5c4a32');
  const build = HAT_BUILDERS[hatKey];
  if (build) {
    const hatGroup = new THREE.Group();
    hatGroup.position.y = 0.62;
    build(hatGroup, hatAccent);
    headGroup.add(hatGroup);
  }

  root.add(headGroup);

  // A small colored disc under the feet, ties in the player's name-tag color.
  if (config.tagColor) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.06, 24), toonMat(new THREE.Color(config.tagColor)));
    base.position.y = -1.02;
    withOutline(base, root, 1.08);
  }

  return root;
}

export const AVATAR_OPTIONS = {
  bodyColors: ['#e8b04a', '#3fae74', '#4a93d9', '#9660e0', '#dd57a8', '#dc4a42', '#e8dcc8', '#7a5c3e'],
  hats: ['none', 'cap', 'cone', 'crown', 'band'],
  faces: ['happy', 'smirk', 'surprised', 'glasses', 'mask'],
};

// ---------- Scene plumbing shared by the live preview and the offscreen snapshot renderer ----------
function buildScene() {
  const scene = new THREE.Scene();
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2, 3, 4);
  const fill = new THREE.HemisphereLight(0xfff3d6, 0x2a2038, 1.1);
  scene.add(key, fill);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
  camera.position.set(0, 0.15, 4.6);
  return { scene, camera };
}

// Live, continuously-rotating preview for the character-creator screen.
export function createPreviewRenderer(canvas) {
  const { scene, camera } = buildScene();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  let group = null;
  let raf = null;
  let spinning = true;

  function resize() {
    const w = canvas.clientWidth || 260, h = canvas.clientHeight || 260;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function update(config, charOverride) {
    if (group) scene.remove(group);
    group = buildAvatarGroup(config, charOverride || null);
    scene.add(group);
  }

  function loop() {
    if (spinning && group) group.rotation.y += 0.012;
    resize();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  }
  loop();

  return {
    update,
    setSpinning(v) { spinning = v; },
    dispose() { if (raf) cancelAnimationFrame(raf); renderer.dispose(); },
  };
}

// One-shot offscreen render to a PNG data URL -- used for seat avatars and character
// cards, so we never keep more than one live WebGL context around at a time.
let _snapCanvas = null, _snapRenderer = null;
export function renderSnapshot(config, opts = {}) {
  const size = opts.size || 220;
  if (!_snapCanvas) {
    _snapCanvas = document.createElement('canvas');
    _snapRenderer = new THREE.WebGLRenderer({ canvas: _snapCanvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  }
  _snapRenderer.setPixelRatio(1);
  _snapRenderer.setSize(size, size, false);
  const { scene, camera } = buildScene();
  const group = buildAvatarGroup(config, opts.charOverride || null);
  if (opts.yaw) group.rotation.y = opts.yaw;
  scene.add(group);
  _snapRenderer.render(scene, camera);
  const url = _snapCanvas.toDataURL('image/png');
  scene.remove(group);
  return url;
}

// app.js is a classic (non-module) script, so expose the small API surface it needs here.
window.Avatar3D = { AVATAR_OPTIONS, CHARACTER_ACCESSORY, createPreviewRenderer, renderSnapshot };
window.dispatchEvent(new Event('avatar3d-ready'));
