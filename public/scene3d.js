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

// ---------- Room + table geometry, built once ----------
function buildRoom(scene) {
  const floorColor = cssColor('--panel-2', '#2b2440');
  const wallColor = cssColor('--bg', '#151022');
  const woodColor = 0x3a2b1c;
  const trimColor = cssColor('--gold', '#d4af37');

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(9, 32),
    new THREE.MeshStandardMaterial({ color: floorColor, roughness: 0.95 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.55;
  scene.add(floor);

  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(9, 9, 7, 32, 1, true, Math.PI * 0.15, Math.PI * 1.7),
    new THREE.MeshStandardMaterial({ color: wallColor, roughness: 1, side: THREE.BackSide })
  );
  wall.position.y = 1.6;
  scene.add(wall);

  // Round bar table, dark wood with a thin gold trim ring.
  const table = new THREE.Mesh(
    new THREE.CylinderGeometry(2.5, 2.6, 0.22, 40),
    new THREE.MeshStandardMaterial({ color: woodColor, roughness: 0.55, metalness: 0.05 })
  );
  table.position.y = -1.0;
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
  group.add(seat);
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 0.65, 10),
    new THREE.MeshStandardMaterial({ color: 0x161010, roughness: 0.6, metalness: 0.3 })
  );
  post.position.y = -1.78;
  group.add(post);
  group.position.set(x, 0, z);
  group.rotation.y = ry;
  return group;
}

function buildLights(scene) {
  const key = new THREE.PointLight(0xffe3b0, 22, 16, 2);
  key.position.set(0, 3.4, 2.5);
  scene.add(key);
  const rim = new THREE.PointLight(0x8fb0ff, 8, 14, 2);
  rim.position.set(0, 2.2, -4);
  scene.add(rim);
  const fill = new THREE.HemisphereLight(0xfff3d6, 0x151022, 0.55);
  scene.add(fill);
}

// Evenly spaces `n` seats across a 150-degree arc centered on `centerDeg`, at radius `R`,
// mirroring the angle math the old 2D seat layout used (just aimed at the far side of the
// table instead of the top of the screen).
function arcPositions(n, centerDeg, R, y) {
  const out = [];
  for (let i = 0; i < n; i++) {
    // A single other player would otherwise sit exactly opposite (x=0), dead in line with
    // my own seat and the camera -- I'd completely block them. Nudge that one-seat case off-axis.
    const angleDeg = n === 1 ? centerDeg + 26 : centerDeg + (-75 + (150 * i) / (n - 1));
    const rad = (angleDeg * Math.PI) / 180;
    out.push({ x: R * Math.sin(rad), z: R * Math.cos(rad), ry: Math.PI - rad });
  }
  return out;
}

export function createTableScene(canvas) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 40);
  camera.position.set(0, 1.7, 5.6);
  camera.lookAt(0, -0.5, 0);
  buildLights(scene);
  buildRoom(scene);

  const R = 2.05;
  const MY_SLOT = { x: 0, z: R, ry: Math.PI };

  const SEAT_Y = -0.3; // sinks the avatar so its lower body reads as behind/below the table edge

  // My own seat -- built once, rarely changes mid-game.
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
    const positions = arcPositions(n, 180, R, 0);
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
    slot.anchor.add(slot.group);
  }

  // others: array of { id, avatar, alive } for every OTHER player, in seat order.
  // myAvatar: the local player's own avatar config (or null).
  // opts: { activePlayerId, reactingIds: Set<id> }
  function update(othersData, myAvatar, opts = {}) {
    ensureSlotCount(othersData.length);

    const mySig = JSON.stringify(myAvatar || null);
    if (mySig !== mySlot.sig) { setSeatAvatar(mySlot, myAvatar); mySlot.sig = mySig; }

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
      const v = new THREE.Vector3(slot.anchor.position.x, slot.anchor.position.y + 0.85, slot.anchor.position.z).project(camera);
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
