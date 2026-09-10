// Golden Bluff - live 3D bar-table scene (Three.js, ES module).
// Phase 1 of the "make it feel like Liar's Bar" request: a persistent room + table +
// seated live avatars, replacing the flat 2D table-ring background. Cards, the hand,
// the drawer, and every existing fx-layer effect (ability spotlight, challenge flash,
// ticket/card flights) stay exactly as they are -- 2D UI layered on top of this canvas,
// same as how Liar's Bar itself overlays cards on top of its own 3D room.
//
// Unlike avatar3d.js's "never more than one live context" rule (which exists to avoid
// running 6+ SEPARATE contexts at once), this is deliberately the one persistent live
// scene for the whole game screen -- one canvas, many objects, which is the normal way
// to do this rather than a violation of that earlier rule.
import * as THREE from './vendor/three.module.min.js';
import { buildAvatarGroup } from './avatar3d.js';

function cssColor(varName, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  try { return new THREE.Color(v || fallback); } catch (e) { return new THREE.Color(fallback); }
}

// ---------- Procedural canvas textures (no external image assets available) ----------
// A wood-grain diffuse texture for the bar table.
//
// CylinderGeometry's end-cap UVs are NOT the (cosθ, sinθ) polar mapping that name suggests
// -- checked directly against the vendored three.js build: the cap's center vertex is
// uv=(0.5, 0.5) and EVERY rim vertex is uv=(θ/2π, 1.0) -- i.e. u sweeps the angle, v is a
// pure function of radius alone (0.5 at the center, 1.0 at the rim). A texture that varies
// by CANVAS ROW (a horizontal stripe design, like this one) therefore paints exactly one
// solid ring per row -- correct. A texture that instead varies by distance from the
// canvas's own center in XY pixel space (concentric circles drawn on the canvas) does NOT
// line up with that -- a single drawn "ring" spans many different actual v-values as its
// angle sweeps, and 40 of those overlapping was exactly what produced the smeared, nearly
// solid center blob during testing 2026-09-10. Horizontal stripes + wrapS/T repeat(1,2)
// (so the cap's used v-range, 0.5-1.0, stretches back out to the full drawn image instead
// of only reading its bottom half) is the version that actually renders as wood grain.
function makeWoodTexture() {
  const w = 256, h = 256;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#4a3520';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 46; i++) {
    const y = (i / 46) * h + (Math.sin(i * 12.9) * 3);
    const shade = 18 + Math.floor(Math.abs(Math.sin(i * 3.7)) * 22);
    ctx.strokeStyle = `rgba(${shade + 10}, ${shade}, ${Math.max(0, shade - 8)}, ${0.35 + (i % 3) * 0.12})`;
    ctx.lineWidth = 1.2 + (i % 4) * 0.6;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= w; x += 16) {
      ctx.lineTo(x, y + Math.sin(x * 0.04 + i) * 2.5);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 2);
  return tex;
}

// ---------- Table geometry, built once ----------
// No modeled floor or walls: Aki asked for a Liar's Bar look with "no background" --
// this used to build a floor disc (radius 9) and a wraparound wall cylinder around the
// table, which (a) fought CSS for the job of "what the room looks like", (b) was often
// the actual cause of the flat-black-circle look reported 2026-09-10 (an unlit floor
// disc peeking past the table edge once the camera pulled back far enough to see it),
// and (c) added rendering cost for a room nobody asked to see. The renderer is
// alpha:true, so with nothing behind the table, the .table-ring div's own CSS gradient
// (styles.css) shows straight through as the "room" -- a moody backdrop for near zero
// cost, the same trick Liar's Bar's own blurred background uses.
function buildRoom(scene) {
  const trimColor = cssColor('--gold', '#d4af37');

  // Round bar table, dark wood (procedural grain texture) with a thin gold trim ring.
  const woodTex = makeWoodTexture();
  const table = new THREE.Mesh(
    new THREE.CylinderGeometry(2.5, 2.6, 0.22, 40),
    new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.65, metalness: 0.05 })
  );
  table.position.y = -1.0;
  table.castShadow = true;
  table.receiveShadow = true;
  scene.add(table);
  const trim = new THREE.Mesh(
    new THREE.TorusGeometry(2.52, 0.045, 10, 48),
    new THREE.MeshStandardMaterial({ color: trimColor, roughness: 0.3, metalness: 0.6 })
  );
  trim.rotation.x = Math.PI / 2;
  trim.position.y = -0.89;
  scene.add(trim);

  return { table };
}

function buildStool(x, z, ry) {
  const group = new THREE.Group();
  const seat = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.42, 0.14, 20),
    new THREE.MeshStandardMaterial({ color: 0x241a14, roughness: 0.8 })
  );
  seat.position.y = -1.45;
  seat.castShadow = true;
  seat.receiveShadow = true;
  group.add(seat);
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 0.65, 10),
    new THREE.MeshStandardMaterial({ color: 0x161010, roughness: 0.6, metalness: 0.3 })
  );
  post.position.y = -1.78;
  post.castShadow = true;
  group.add(post);
  group.position.set(x, 0, z);
  group.rotation.y = ry;
  return group;
}

function buildLights(scene) {
  // intensity 22 with no tone mapping on the renderer (see createTableScene) clipped
  // straight to a flat, blown-out gold disc on the wood right under the light -- barely
  // visible when the table was small and distant, impossible to miss once it fills most
  // of the screen. Softer intensity + ACES tone mapping (below) turns that into an actual
  // warm highlight instead of a hard-edged hotspot.
  const key = new THREE.PointLight(0xffe3b0, 12, 16, 2);
  key.position.set(0, 3.4, 2.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 14;
  key.shadow.bias = -0.0025;
  key.shadow.radius = 3; // soft edges (PCFSoftShadowMap)
  scene.add(key);
  const rim = new THREE.PointLight(0x8fb0ff, 8, 14, 2);
  rim.position.set(0, 2.2, -4);
  scene.add(rim);
  const fill = new THREE.HemisphereLight(0xfff3d6, 0x151022, 0.55);
  scene.add(fill);
}

// More seats need more room: a fixed 150-degree arc packs 5-6 opponents so tightly they
// crop at the top of the circular frame and nearly overlap each other. Widen the arc (and
// give seats a bit more radius) as the count grows so a full table still reads clearly.
function arcSpanFor(n) {
  if (n <= 2) return 150;
  if (n <= 4) return 175;
  return 205; // 5-6 players
}
function othersRadiusFor(n) {
  if (n <= 3) return 2.05;
  if (n <= 4) return 2.2;
  return 2.4; // 5-6 players -- more spacing so neighboring avatars don't overlap
}

// Evenly spaces `n` seats across a `spanDeg`-degree arc centered on `centerDeg`, at radius
// `R`, mirroring the angle math the old 2D seat layout used (just aimed at the far side of
// the table instead of the top of the screen).
function arcPositions(n, centerDeg, R, spanDeg) {
  const out = [];
  const half = spanDeg / 2;
  for (let i = 0; i < n; i++) {
    // A single other player would otherwise sit exactly opposite (x=0), dead in line with
    // my own seat and the camera -- I'd completely block them. Nudge that one-seat case off-axis.
    const angleDeg = n === 1 ? centerDeg + 26 : centerDeg + (-half + (spanDeg * i) / (n - 1));
    const rad = (angleDeg * Math.PI) / 180;
    out.push({ x: R * Math.sin(rad), z: R * Math.cos(rad), ry: Math.PI - rad });
  }
  return out;
}

export function createTableScene(canvas) {
  const scene = new THREE.Scene();
  // Closer and lower than the 2026-09-10 "fix the deformity" pass: that pass pulled the
  // camera back far enough to stop the near table edge from distorting into a dark dome,
  // but a distant, near-top-down shot is also what made every seated character shrink to
  // a small blob on the rim. Liar's Bar sits close over the table so whoever's opposite
  // you reads as a real character, not a token -- so pull back in, but keep the FOV
  // moderate (not the old close-in 42@5.6 that caused the distortion) so the near edge
  // stays a clean ellipse instead of a blob.
  const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 40);
  camera.position.set(0, 2.05, 4.5);
  camera.lookAt(0, -0.55, 0);
  buildLights(scene);
  buildRoom(scene);

  const R = 2.05;
  const MY_SLOT = { x: 0, z: R, ry: Math.PI };

  const SEAT_Y = -0.3; // sinks the avatar so its lower body reads as behind/below the table edge

  // My own seat -- built once, rarely changes mid-game. MY_SLOT sits at the near edge of
  // the table, right where the camera is, facing away from it -- so a full avatar body
  // placed here (this used to happen, in update() below) put the back of your own head a
  // couple of units from the lens: at any camera distance close enough to make opponents
  // read as actual characters (the whole point of the 2026-09-10 "bring the camera in"
  // pass), your own head fills most of the frame, an unrecognizable smooth close-up blob --
  // this, not the table's wood texture or lighting (both suspected and cleared first), was
  // the real cause of the flat gold/black disc reported both before AND after that pass.
  // mySlot.anchor is kept (empty) only so future code has a hook for it; the stool alone is
  // enough for the near edge to read as "your seat" the way Liar's Bar's own view never
  // shows your own body either.
  const mySlot = { anchor: new THREE.Group(), sig: null };
  mySlot.anchor.position.set(MY_SLOT.x, SEAT_Y, MY_SLOT.z);
  mySlot.anchor.rotation.y = MY_SLOT.ry;
  scene.add(buildStool(MY_SLOT.x, MY_SLOT.z, MY_SLOT.ry));
  scene.add(mySlot.anchor);

  // Turn-indicator ring, repositioned onto whichever other seat is currently active.
  const turnRing = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.62, 32),
    new THREE.MeshBasicMaterial({ color: cssColor('--gold-bright', '#f4d573'), side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
  );
  turnRing.rotation.x = -Math.PI / 2;
  turnRing.position.y = -0.86;
  turnRing.visible = false;
  scene.add(turnRing);

  let others = []; // { anchor, stool, group, sig }
  let othersCount = -1;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Without tone mapping, any lit pixel over 1.0 just clips to flat white/gold instead of
  // rolling off -- that hard clipping is what turned the key light into a manhole-cover-like
  // hotspot on the table. ACES rolls highlights off naturally, the same fix any physically-lit
  // three.js scene needs once a light is bright enough to blow out a nearby surface.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function ensureSlotCount(n) {
    if (n === othersCount) return;
    others.forEach((s) => scene.remove(s.anchor, s.stool));
    others = [];
    const positions = arcPositions(n, 180, othersRadiusFor(n), arcSpanFor(n));
    for (let i = 0; i < n; i++) {
      const { x, z, ry } = positions[i];
      const anchor = new THREE.Group();
      anchor.position.set(x, SEAT_Y, z);
      anchor.rotation.y = ry;
      const stool = buildStool(x, z, ry);
      scene.add(anchor, stool);
      others.push({ anchor, stool, group: null, sig: null });
    }
    othersCount = n;
  }

  function setSeatAvatar(slot, config, charOverride) {
    if (slot.group) { slot.anchor.remove(slot.group); slot.group = null; }
    if (!config) return; // empty seat (eliminated, or no avatar data yet)
    slot.group = buildAvatarGroup(config, charOverride || null);
    // buildAvatarGroup() is shared with the avatar-creator preview and the offscreen PNG
    // snapshot renderer, neither of which use shadows -- so shadow flags are set here,
    // scoped to this live scene, rather than inside avatar3d.js itself.
    slot.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    slot.anchor.add(slot.group);
  }

  // others: array of { id, avatar, alive } for every OTHER player, in seat order.
  // myAvatar: the local player's own avatar config -- accepted for API compatibility with
  // callers, but deliberately never rendered as a body (see mySlot's own comment above for
  // why: nothing sits between the camera and the table, so nobody's own head fills the
  // frame). The empty stool stays, so the near edge of the table still reads as "your seat".
  // opts: { activePlayerId, reactingIds: Set<id> }
  function update(othersData, myAvatar, opts = {}) {
    ensureSlotCount(othersData.length);

    let activeAnchor = null;
    othersData.forEach((p, i) => {
      const slot = others[i];
      const sig = JSON.stringify({ id: p.id, avatar: p.avatar, alive: p.alive });
      if (sig !== slot.sig) { setSeatAvatar(slot, p.alive ? p.avatar : null); slot.sig = sig; }
      slot.id = p.id;
      if (opts.activePlayerId && p.id === opts.activePlayerId) activeAnchor = slot.anchor;
    });

    if (activeAnchor) {
      turnRing.position.x = activeAnchor.position.x;
      turnRing.position.z = activeAnchor.position.z * 0.62; // pull slightly toward table center
      turnRing.visible = true;
    } else {
      turnRing.visible = false;
    }
  }

  // Projects each named seat's world anchor to canvas-local pixel coordinates, so the
  // existing name/ticket/heart HTML overlay can be placed exactly where the 3D seat is.
  function getSeatScreenPositions(ids) {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    const out = {};
    ids.forEach((id) => {
      const slot = others.find((s) => s.id === id);
      if (!slot) return;
      const v = new THREE.Vector3(slot.anchor.position.x, slot.anchor.position.y + 1.05, slot.anchor.position.z).project(camera);
      out[id] = { x: (v.x * 0.5 + 0.5) * w, y: (1 - (v.y * 0.5 + 0.5)) * h };
    });
    return out;
  }

  let raf = null;
  function loop() {
    resize();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  }
  loop();

  return {
    update,
    getSeatScreenPositions,
    dispose() { if (raf) cancelAnimationFrame(raf); renderer.dispose(); },
  };
}

window.Scene3D = { createTableScene };
window.dispatchEvent(new Event('scene3d-ready'));
