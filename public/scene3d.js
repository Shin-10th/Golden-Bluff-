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

// A simple grid-of-books canvas texture for the bookshelf prop -- this is a flat PLANE/BOX
// UV (0-1 linear in both axes), not a cap, so none of the polar-mapping caveats above apply.
function makeBooksTexture() {
  const w = 256, h = 128;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2a1c10';
  ctx.fillRect(0, 0, w, h);
  const hues = ['#8a3b2e', '#3b5e3a', '#5a4a8a', '#8a6a2e', '#2e5a7a', '#6a2e4a'];
  let x = 4;
  let i = 0;
  while (x < w - 4) {
    const bw = 10 + (i % 4) * 4;
    ctx.fillStyle = hues[i % hues.length];
    ctx.fillRect(x, 8 + (i % 3) * 2, bw - 2, h - 16 - (i % 3) * 2);
    x += bw;
    i++;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------- Furnished room backdrop ----------
// Brought back deliberately after the 2026-09-10 "no background" pass removed the room
// entirely -- Aki's Liar's Bar reference screenshots show a real furnished den behind the
// table (bookshelf, armchairs, wall art), not empty space. Kept simple/primitive (no
// external assets) and kept well outside the near camera field so none of it can
// reintroduce the distortion/hotspot bugs already fixed once this session:
//  - the floor is a FLAT COLOR, not a textured one -- CircleGeometry's cap UV has the exact
//    same "one texture row = one ring at a fixed radius" polar mapping documented above for
//    the table, which is easy to get wrong for a surface that's mostly out of frame anyway.
//  - the back wall is a partial arc, warm-colored with a touch of emissive glow (not the
//    app's own near-black --bg, the mistake fixed earlier), and stops well short of
//    wrapping around to the camera's side so it can't crowd the now-open table view.
function buildBackdrop(scene) {
  const wallColor = new THREE.Color('#4a3524');
  const floorColor = new THREE.Color('#1c130c');

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(9, 40),
    new THREE.MeshStandardMaterial({ color: floorColor, roughness: 0.95 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.8;
  floor.receiveShadow = true;
  scene.add(floor);

  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(6.8, 6.8, 6.5, 32, 1, true, Math.PI * 0.72, Math.PI * 1.56),
    new THREE.MeshStandardMaterial({
      color: wallColor, roughness: 0.92, side: THREE.BackSide,
      emissive: new THREE.Color('#26150a'), emissiveIntensity: 0.3,
    })
  );
  wall.position.y = 0.6;
  scene.add(wall);

  // A wainscot/baseboard strip so the wall doesn't look like it floats above the floor.
  const baseboard = new THREE.Mesh(
    new THREE.CylinderGeometry(6.78, 6.78, 0.5, 32, 1, true, Math.PI * 0.72, Math.PI * 1.56),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#1c1108'), roughness: 0.8, side: THREE.BackSide })
  );
  baseboard.position.y = -1.55;
  scene.add(baseboard);

  // Bookshelf: a simple box carcass with a books-texture front, off to one side.
  const shelfMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#3a2a18'), roughness: 0.8 });
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.6, 0.5), shelfMat);
  shelf.position.set(-4.6, -0.5, -4.6);
  shelf.rotation.y = 0.55;
  shelf.castShadow = true;
  scene.add(shelf);
  const booksTex = makeBooksTexture();
  const booksMat = new THREE.MeshStandardMaterial({ map: booksTex, roughness: 0.7 });
  for (let row = 0; row < 3; row++) {
    const books = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.62, 0.42), booksMat);
    books.position.set(-4.6, -1.05 + row * 0.72, -4.42);
    books.rotation.y = 0.55;
    scene.add(books);
  }

  // Two simple armchairs (seat + backrest, no arms for simplicity) on the other side.
  const chairMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#5a2e2a'), roughness: 0.85 });
  [{ x: 3.8, z: -4.4, ry: -0.6 }, { x: 5.4, z: -2.6, ry: -1.1 }].forEach(({ x, z, ry }) => {
    const chair = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.4, 0.9), chairMat);
    seat.position.y = -1.35;
    chair.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.22), chairMat);
    back.position.set(0, -0.7, -0.34);
    chair.add(back);
    chair.position.set(x, 0, z);
    chair.rotation.y = ry;
    chair.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(chair);
  });

  // A small framed picture on the back wall for a lived-in touch.
  const frame = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.8),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#5a4520'), roughness: 0.5 })
  );
  const art = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.6),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#3a4a5e'), roughness: 0.6, emissive: new THREE.Color('#25384a'), emissiveIntensity: 0.7 })
  );
  art.position.z = 0.01;
  const frameGroup = new THREE.Group();
  frameGroup.add(frame, art);
  frameGroup.position.set(0, 1.1, -6.75);
  scene.add(frameGroup);

  // A small warm wall-sconce glow near the bookshelf, low intensity so it can't reintroduce
  // the earlier hotspot problem -- just enough to make the room read as lived-in and lit,
  // not merely "less dark".
  const sconce = new THREE.PointLight(0xffcf90, 4, 8, 2);
  sconce.position.set(-3.6, 1.4, -4.2);
  scene.add(sconce);
  const sconce2 = new THREE.PointLight(0xffcf90, 3.5, 8, 2);
  sconce2.position.set(4.6, 1.4, -3.4);
  scene.add(sconce2);
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

// A card-back texture (dark panel + gold border + a small emblem) matching this app's own
// card design language, for the first-person hand-of-cards prop below. Plane/box UV, so
// none of the polar-mapping caveats documented above apply.
function makeCardBackTexture() {
  const w = 180, h = 252;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#241c38';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#d4af37';
  ctx.lineWidth = 8;
  ctx.strokeRect(9, 9, w - 18, h - 18);
  ctx.strokeStyle = 'rgba(212,175,55,0.5)';
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 20, w - 40, h - 40);
  ctx.fillStyle = 'rgba(212,175,55,0.85)';
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#241c38';
  ctx.font = 'bold 34px Georgia';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('GB', w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------- First-person hands + card fan ----------
// Liar's Bar's own view keeps your forearms and a fanned hand of cards visible at the
// bottom of the screen -- Aki asked for that specifically, having shown reference
// screenshots. This is a purely decorative echo of the *real* hand (the interactive one
// stays exactly where it's always been, the 2D `.hand-fan` below the table): a few card
// props tilted toward the camera between two simple forearm shapes, sitting close to the
// lens at the near edge of the table. Never rendered for the local player's own avatar
// BODY (see MY_SLOT's own comment below for why a body that close fills the frame) --
// forearms-and-hands only, which is a much smaller, camera-adjacent shape and reads
// correctly at this distance the way a full seated figure does not.
//
// This group is parented directly to the CAMERA (see the wiring in createTableScene),
// not to the scene root -- so every position below is in the camera's own local space,
// not world space. The original version placed these near the table's world-space near
// edge (matching MY_SLOT); projecting those coordinates through the camera's actual
// view basis showed the vertical offset needed to sit near the bottom of the table
// exceeded the frustum's half-height several times over at that distance, so nothing
// ever fell inside the rendered frame -- that was the whole bug. Camera-local space
// sidesteps the arithmetic entirely: a fixed small distance in front of the lens
// (negative Z) and a fixed amount below its center (negative Y) always reads as "near
// the bottom of the screen" no matter where the camera itself sits or points, the same
// way first-person weapon/hand props are conventionally parented to the camera rather
// than placed in world space.
function buildHandsProp() {
  const group = new THREE.Group();
  const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x3a2f22, roughness: 0.8 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xe8b04a, roughness: 0.7 });

  [-1, 1].forEach((side) => {
    const arm = new THREE.Group();
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.6, 4, 10), sleeveMat);
    sleeve.position.y = 0;
    arm.add(sleeve);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10), skinMat);
    hand.position.y = 0.36;
    arm.add(hand);
    // Enter from the bottom corner, angled up and inward toward the card fan.
    arm.position.set(side * 0.55, -0.55, -1.25);
    arm.rotation.z = side * 0.95;
    arm.rotation.x = -0.5;
    group.add(arm);
  });

  const cardTex = makeCardBackTexture();
  const cardMat = new THREE.MeshStandardMaterial({ map: cardTex, roughness: 0.5 });
  const cardCount = 4;
  for (let i = 0; i < cardCount; i++) {
    const card = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.58), cardMat);
    const spread = (i - (cardCount - 1) / 2) * 0.22;
    card.position.set(spread, -0.38 + Math.abs(spread) * -0.08, -1.15);
    card.rotation.z = -spread * 0.5;
    card.rotation.x = -0.75;
    group.add(card);
  }

  group.renderOrder = 1;
  return group;
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
  const fill = new THREE.HemisphereLight(0xfff3d6, 0x2a1c12, 0.75);
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
  // The camera must be part of the scene graph for anything parented to it (the hands
  // prop below) to be picked up by the renderer's traversal, which walks the `scene`
  // object -- a camera with no parent still gets its own matrix updated by the renderer
  // each frame, but its children only render if it's reachable from `scene`.
  scene.add(camera);
  buildLights(scene);
  buildBackdrop(scene);
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
  // Parented to the camera, not the scene -- see buildHandsProp's own comment for why.
  const handsProp = buildHandsProp();
  camera.add(handsProp);

  // Turn-indicator ring, repositioned onto whichever other seat is currently active. Its
  // geometry is rebuilt each frame (see loop(), below) with a shrinking thetaLength -- a
  // decorative pacing sweep, not an enforced countdown (there's no server-side turn
  // clock to bind to), echoed in 2D for the local player's own turn by the gold bar under
  // the "your turn" status bubble (see .turn-bar-fill in styles.css). It resets to a full
  // circle only when the active player actually changes (tracked via turnRingKey/
  // turnRingStart below), not on every unrelated state broadcast.
  const TURN_RING_CYCLE_MS = 9000;
  let turnRingKey = null;
  let turnRingStart = 0;
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
      if (opts.activePlayerId !== turnRingKey) {
        turnRingKey = opts.activePlayerId;
        turnRingStart = performance.now();
      }
    } else {
      turnRing.visible = false;
      turnRingKey = null;
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
    if (turnRing.visible) {
      const elapsed = (performance.now() - turnRingStart) % TURN_RING_CYCLE_MS;
      const pct = 1 - elapsed / TURN_RING_CYCLE_MS;
      const theta = Math.max(0.001, pct * Math.PI * 2);
      turnRing.geometry.dispose();
      turnRing.geometry = new THREE.RingGeometry(0.5, 0.62, 32, 1, -Math.PI / 2, theta);
    }
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
