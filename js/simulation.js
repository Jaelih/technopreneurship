/* ═══════════════════════════════════════════════════════
   simulation.js — Three.js Disaster Simulation v2
   Spawn: 2nd-floor classroom | AABB collisions | proximity decisions
   ═══════════════════════════════════════════════════════ */

var Simulation = (function () {

  // ─── Scene objects ────────────────────────────────────
  var scene, camera, renderer, clock;
  var controls;
  var floodMesh, rain;
  var ambientLight, lightningLight;
  var safeZoneRing, beaconHalo;
  var lightningTimer = 0;
  var decisionTriggerMeshes = [];  // pulsing ring per decision
  var decisionOptionMeshes = [];   // [[{disc,beacon}, {disc,beacon}], ...]

  // ─── Collision ────────────────────────────────────────
  // Each box: { minX, maxX, minZ, maxZ, applyFloor:'all'|'upper'|'lower' }
  var collisionBoxes = [];
  var PLAYER_RADIUS = 0.38;
  var velocity = { x: 0, z: 0 };
  var ACCEL = 55;
  var FRICTION = 9;
  var MAX_SPEED = 6.2;
  var SPRINT_MULT = 1.7;

  function addToFloor(mesh, fi) { return mesh; } // single floor — no culling needed

  function addColl(minX, maxX, minZ, maxZ, floorTag) {
    collisionBoxes.push({ minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ, applyFloor: floorTag || 'all' });
  }

  function collides(x, z, r) {
    var floor = playerFloor;
    for (var i = 0; i < collisionBoxes.length; i++) {
      var b = collisionBoxes[i];
      if (b.applyFloor !== 'all' && b.applyFloor !== floor) continue;
      if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) return true;
    }
    return false;
  }

  // ─── Floor ───────────────────────────────────────────
  var FLOOR_H = 3.5;
  var EYE_H   = 1.7;
  var playerFloor = 'lower'; // single floor — always ground level

  function updateFloorY(delta) {
    var x = camera.position.x, z = camera.position.z;
    state.onStairs = false;
    var hillD = Math.sqrt((x - SHELTER.x) * (x - SHELTER.x) + (z - SHELTER.z) * (z - SHELTER.z));
    var hill = hillD < 28 ? Math.max(0, (28 - hillD) / 28) * 1.4 : 0;
    var targetY = EYE_H + hill;
    var dy = targetY - camera.position.y;
    var maxStep = 6.0 * (delta || 0.016);
    if (Math.abs(dy) <= maxStep) camera.position.y = targetY;
    else camera.position.y += (dy > 0 ? maxStep : -maxStep);
  }

  // ─── State ────────────────────────────────────────────
  var state = {
    running: false,
    gameOver: false,
    simTime: 0,
    floodLevel: -3,
    score: 0,
    decisions: [],
    activeDecision: null,
    reachedShelter: false,
    keys: { w: false, a: false, s: false, d: false, shift: false },
    penaltyTimer: 0,   // seconds remaining of speed reduction
    onStairs: false    // set by updateFloorY each frame
  };

  // ─── Decision — single choice point inside the building ─────────────────────
    var DECISIONS = [
      {
        id: 0,
        triggerPos: { x: 0, z: -3 }, triggerRadius: 3.0, floorReq: 'lower',
        question: '🌊 Hydrostatic pressure has jammed the main entrance doors. The east emergency exit is accessible.',
        triggered: false, resolved: false, openedAt: 0,
        options: [
          { text: '🚪 East emergency exit',
            points: 25, correct: true,
            feedback: '✅ Emergency exits open outward by code. Always know your secondary exits.',
            zonePos: { x: 20, z: 0 }, zoneRadius: 2.0, floorReq: 'lower' },
          { text: '💥 Force the main entrance doors',
            points: 0, correct: false,
            feedback: '❌ Doors held by water pressure require hundreds of kg of force. Use an alternate exit.',
            zonePos: { x: 0, z: -7 }, zoneRadius: 2.0, floorReq: 'lower' }
        ]
      },
      {
        id: 1,
        triggerPos: { x: 34, z: -70 }, triggerRadius: 4.0, floorReq: 'lower',
        question: '👴 An injured elder is lying on the road, unable to move. Floodwaters are rising fast. What do you do?',
        triggered: false, resolved: false, openedAt: 0,
        options: [
          { text: '🤝 Help the elder to safety',
            points: 25, correct: true,
            feedback: '✅ Assisting vulnerable people during evacuation saves lives. Every second counts — but no one gets left behind.',
            zonePos: { x: 34, z: -60 }, zoneRadius: 2.5, floorReq: 'lower' },
          { text: '🏃 Leave and continue alone',
            points: 0, correct: false,
            feedback: '❌ Abandoning an injured person during a disaster puts their life at critical risk. Seek help or assist if it is safe to do so.',
            zonePos: { x: 34, z: -80 }, zoneRadius: 2.5, floorReq: 'lower' }
        ]
      },
      {
        id: 2,
        triggerPos: { x: 24, z: 2 }, triggerRadius: 3.0, floorReq: 'lower',
        question: '⚡ A utility pole has snapped outside the east exit. A downed power line is sparking in the floodwater ahead. What do you do?',
        triggered: false, resolved: false, openedAt: 0,
        options: [
          { text: '🔄 Detour north — stay far from the line',
            points: 25, correct: true,
            feedback: '✅ Floodwater conducts electricity. Keep at least 10 metres from downed lines and never step into water near them.',
            zonePos: { x: 24, z: 10 }, zoneRadius: 2.0, floorReq: 'lower' },
          { text: '⚡ Wade through — it looks shallow',
            points: 0, correct: false,
            feedback: '❌ Water energized by a downed line can kill instantly, even in ankle-deep floods. Never approach a downed power line.',
            zonePos: { x: 30, z: 2 }, zoneRadius: 2.0, floorReq: 'lower' }
        ]
      }
    ];

  // Community center entry zone — relocated far to the east, off the main road.
  // Reaching it requires an east detour + southward run. Not visible from the school.
  var SHELTER = { x: 70, z: -135, entryZ: -124, radius: 10 };

  // ─── Pointer Lock Controls ────────────────────────────
  function createPLC(cam, domEl) {
    var euler = new THREE.Euler(0, 0, 0, 'YXZ');
    var PI2 = Math.PI / 2;
    var locked = false;
    var ignoreUntil = 0;
    function onMove(e) {
      if (!locked) return;
      if (performance.now() < ignoreUntil) return;
      var mx = Math.max(-100, Math.min(100, e.movementX || 0));
      var my = Math.max(-100, Math.min(100, e.movementY || 0));
      euler.y -= mx * 0.002;
      euler.x -= my * 0.002;
      euler.x = Math.max(-PI2 + 0.01, Math.min(PI2 - 0.01, euler.x));
      cam.quaternion.setFromEuler(euler);
    }
    function onChange() {
      locked = document.pointerLockElement === domEl;
      if (locked) ignoreUntil = performance.now() + 100;
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('pointerlockchange', onChange);
    return {
      lock: function () { domEl.requestPointerLock(); },
      unlock: function () { if (document.pointerLockElement) document.exitPointerLock(); },
      get isLocked() { return locked; },
      syncRotation: function () { euler.setFromQuaternion(cam.quaternion, 'YXZ'); },
      dispose: function () {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('pointerlockchange', onChange);
      }
    };
  }

  // ─── VR Button ───────────────────────────────────────
  function addVRButton(rend, cont) {
    if (!navigator.xr) return;
    navigator.xr.isSessionSupported('immersive-vr').then(function (ok) {
      if (!ok) return;
      var btn = document.createElement('button');
      btn.id = 'VRButton'; btn.textContent = '🥽 Enter VR';
      var cur = null;
      btn.addEventListener('click', function () {
        if (!cur) {
          navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] })
            .then(function (s) { s.addEventListener('end', function () { cur = null; btn.textContent = '🥽 Enter VR'; }); rend.xr.setSession(s); cur = s; btn.textContent = '✕ Exit VR'; });
        } else { cur.end(); }
      });
      cont.appendChild(btn);
    });
  }

  // ─── Scene helpers ────────────────────────────────────
  // Material cache — reuse one Lambert material per color for massive draw-call/memory savings.
  // Unique materials are only made when custom opts (transparency/opacity) are provided.
  var _matCache = {};
  var _bmatCache = {};
  function mat(color, opts) {
    if (opts) return new THREE.MeshLambertMaterial(Object.assign({ color: color }, opts));
    var k = '' + color;
    if (!_matCache[k]) _matCache[k] = new THREE.MeshLambertMaterial({ color: color });
    return _matCache[k];
  }
  function bmat(color) {
    var k = '' + color;
    if (!_bmatCache[k]) _bmatCache[k] = new THREE.MeshBasicMaterial({ color: color });
    return _bmatCache[k];
  }

  // Geometry cache — reuse identical BoxGeometry to cut GPU uploads
  var _geoCache = {};
  function geo(w, h, d) {
    var k = w + '|' + h + '|' + d;
    if (!_geoCache[k]) _geoCache[k] = new THREE.BoxGeometry(w, h, d);
    return _geoCache[k];
  }

  function box(cx, cy, cz, w, h, d, color) {
    var m = new THREE.Mesh(geo(w, h, d), mat(color));
    m.position.set(cx, cy, cz);
    scene.add(m);
    return m;
  }

  // ─── SCHOOL BUILDING ─────────────────────────────────────────────────────────
  // New footprint: 44W × 16D  (x: -22 to +22,  z: -8 to +8)
  // Double-loaded corridor at z=-1.5 to +1.5, east–west.
  // Stairwells at x=-22→-16 (west) and x=+16→+22 (east), full depth z=-8→+8.
  // Rooms per side: N1(-16→-5) | N2(-5→+5) | N3(+5→+16)  and mirrored south.
  // South-facing main entrance (z=-8, x=-2 to +2) — 1st floor only.
  // East emergency exit (x=+22, z=-0.75 to +0.75) — 1st floor only.

  function buildSchool() {
    var wallC  = 0xd6cfc4, intC   = 0xe0d8cc;
    var floorC = 0xb0a898, ceilC  = 0xc8c0b0;
    var glassC = 0x8ab4d4, concrC = 0x888880;
    var WT = 0.25, BH = FLOOR_H, halfBH = BH / 2;

    // ── Outer walls (BoxGeometry — no invisible-face issues) ─────────────────
    // North wall — full height, full width, all floors
    var northW = box(0, halfBH, 8 + WT/2, 44 + WT*2, BH, WT, wallC);
    addColl(-22, 22, 8, 8 + WT);

    // South wall — split into 3 segments for main entrance gap (x=-2 to +2) at floor 0 height,
    // but the outer wall goes full height (entrance opening is cut by having no slab below floor level).
    // Segment west: x=-22 to -2
    var swW = box(-12, halfBH, -8 - WT/2, 20, BH, WT, wallC);
    addColl(-22, -2, -8 - WT, -8);
    // Segment east: x=+2 to +22
    var swE = box(12, halfBH, -8 - WT/2, 20, BH, WT, wallC);
    addColl(2, 22, -8 - WT, -8);
    // Door header above gap (x=-2 to +2), above door height (2.2 to BH)
    var swMidHdr = box(0, 2.2 + (BH - 2.2)/2, -8 - WT/2, 4, BH - 2.2, WT, wallC);
    addColl(-2, 2, -8 - WT, -8); // full-depth collision even across doorway height (player can't fly)

    // West wall — full height; fire escape gap at z=-0.75 to +0.75 ONLY on floor 0
    var wwN = box(-22 - WT/2, halfBH, 4.625, WT, BH, 7.25, wallC); addColl(-22 - WT, -22, 1, 8);
    var wwS = box(-22 - WT/2, halfBH, -4.625, WT, BH, 7.25, wallC); addColl(-22 - WT, -22, -8, -1);
    // Gap segment (door header above opening)
    var wwGapHdr = box(-22 - WT/2, 2.2 + (BH-2.2)/2, 0, WT, BH-2.2, 1.5, wallC);
    // Debris blocking fire escape (visual, no gap in collision — west escape is blocked)
    var weDebris = box(-21.5, 0.4, 0, 1.5, 0.8, 1.5, 0x6a6258);
    addColl(-22.5, -20.5, -0.75, 0.75); // blocks the fire-escape gap

    // East wall — full height; emergency exit gap at z=-0.75 to +0.75, floor 0
    var ewN = box(22 + WT/2, halfBH, 4.625, WT, BH, 7.25, wallC); addColl(22, 22 + WT, 1, 8);
    var ewS = box(22 + WT/2, halfBH, -4.625, WT, BH, 7.25, wallC); addColl(22, 22 + WT, -8, -1);
    // East exit: leave the gap open (no collision here at floor 0, door is passable)
    var ewGapHdr = box(22 + WT/2, 2.2 + (BH-2.2)/2, 0, WT, BH-2.2, 1.5, wallC);
    // Emergency exit sign
    var exitSign = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.06), bmat(0x00cc44));
    exitSign.position.set(21.5, 2.6, 0); exitSign.rotation.y = Math.PI / 2;
    scene.add(exitSign);

    // ── Floor slab ────────────────────────────────────────────────────────────
    var gf = new THREE.Mesh(new THREE.PlaneGeometry(44, 16), mat(floorC));
    gf.rotation.x = -Math.PI / 2; gf.position.set(0, 0.01, 0); scene.add(gf);

    // Ceiling (single floor height)
    var roofCeil = new THREE.Mesh(new THREE.PlaneGeometry(44, 16), mat(ceilC));
    roofCeil.rotation.x = Math.PI / 2; roofCeil.position.set(0, FLOOR_H - 0.01, 0); scene.add(roofCeil);

    // ── Ground-floor interior walls, rooms, hazards ───────────────────────────
    buildFloorWalls(0, intC);
    buildFloorRooms(0);
    buildFloorHazards(0);

    // ── Windows ───────────────────────────────────────────────────────────────
    var wMat = mat(glassC, { transparent: true, opacity: 0.42 });
    [-15, -8, 0, 8, 15].forEach(function (wx) {
      [0].forEach(function (fi) {
        var wy = fi * FLOOR_H + 2.0;
        // North windows
        var wn = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.4), wMat);
        wn.position.set(wx, wy, 8.06); scene.add(wn);
        // South windows (skip main-entrance x-range on floor 0)
        if (fi !== 0 || Math.abs(wx) > 3) {
          var ws = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.4), wMat);
          ws.rotation.y = Math.PI; ws.position.set(wx, wy, -8.06); scene.add(ws);
        }
      });
    });
    // East/west side windows
    [-5, 0, 5].forEach(function (wz) {
      [0].forEach(function (fi) {
        var wy = fi * FLOOR_H + 2.0;
        var we = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.4), wMat);
        we.rotation.y = -Math.PI / 2; we.position.set(22.06, wy, wz); scene.add(we);
        var ww = we.clone(); ww.rotation.y = Math.PI / 2;
        ww.position.set(-22.06, wy, wz); scene.add(ww);
      });
    });

    // ── Corridor lights ───────────────────────────────────────────────────────
    var lA = new THREE.PointLight(0xfff0d0, 0.9, 30);
    lA.position.set(-10, 2.8, 0); scene.add(lA);
    var lB = new THREE.PointLight(0xfff0d0, 0.9, 30);
    lB.position.set(10, 2.8, 0); scene.add(lB);
  }

  function buildStairwellWalls() { /* no stairwells — single floor */ }

  // ── Interior walls per floor ───────────────────────────────────────────────
  // Each floor: north/south corridor walls with 3 door gaps each, plus 2 room-divider walls.
  function buildFloorWalls(fi, intC) {
    var yb  = fi * FLOOR_H;
    var mid = yb + FLOOR_H / 2;
    var WT  = 0.25;
    var ft  = fi === 0 ? 'lower' : fi === 1 ? 'upper' : 'top';
    var wH  = FLOOR_H;

    // Door positions for north corridor wall (z=+1.5) — centered on each room
    // Room N1: x=-16→-5 (center x=-10.5), door at x=-10.5, w=1.5
    // Room N2: x=-5→+5  (center x=0),     door at x=0,     w=1.5
    // Room N3: x=+5→+16 (center x=+10.5), door at x=+10.5, w=1.5
    var doors = [{ cx: -10.5 }, { cx: 0 }, { cx: 10.5 }];
    var doorHW = 0.75; // half door width

    // North corridor wall segments (z=+1.5)
    function northSeg(x1, x2) {
      var cx = (x1 + x2) / 2, w = x2 - x1;
      var m = box(cx, mid, 1.5, w, wH, WT, intC); addToFloor(m, fi);
      addColl(x1, x2, 1.5 - WT/2, 1.5 + WT/2, ft);
    }
    // Segments around 3 doors: x=-16 to x=+16
    northSeg(-16, doors[0].cx - doorHW);
    northSeg(doors[0].cx + doorHW, doors[1].cx - doorHW);
    northSeg(doors[1].cx + doorHW, doors[2].cx - doorHW);
    northSeg(doors[2].cx + doorHW, 16);

    // South corridor wall segments (z=-1.5)
    function southSeg(x1, x2) {
      var cx = (x1 + x2) / 2, w = x2 - x1;
      var m = box(cx, mid, -1.5, w, wH, WT, intC); addToFloor(m, fi);
      addColl(x1, x2, -1.5 - WT/2, -1.5 + WT/2, ft);
    }
    southSeg(-16, doors[0].cx - doorHW);
    southSeg(doors[0].cx + doorHW, doors[1].cx - doorHW);
    southSeg(doors[1].cx + doorHW, doors[2].cx - doorHW);
    southSeg(doors[2].cx + doorHW, 16);

    // Room divider walls (x-aligned, splitting rooms N1/N2, N2/N3, S1/S2, S2/S3)
    [-5, 5].forEach(function (wx) {
      // South divider (z=-8 to -1.5) — always solid
      var sd = box(wx, mid, -4.75, WT, wH, 6.5, intC); addToFloor(sd, fi);
      addColl(wx - WT/2, wx + WT/2, -8, -1.5, ft);

      // North divider: on 2F (fi=1) at x=+5 leave a library shortcut door gap at z=+3.25→+4.75
      if (fi === 1 && wx === 5) {
        // South segment: z=+1.5 to +3.25
        var ndS = box(wx, mid, 2.375, WT, wH, 1.75, intC); addToFloor(ndS, fi);
        addColl(wx - WT/2, wx + WT/2, 1.5, 3.25, ft);
        // North segment: z=+4.75 to +8
        var ndN = box(wx, mid, 6.375, WT, wH, 3.25, intC); addToFloor(ndN, fi);
        addColl(wx - WT/2, wx + WT/2, 4.75, 8, ft);
      } else {
        var nd = box(wx, mid, 4.75, WT, wH, 6.5, intC); addToFloor(nd, fi);
        addColl(wx - WT/2, wx + WT/2, 1.5, 8, ft);
      }
    });
  }

  // ── Furniture and hazard props per floor ──────────────────────────────────
  function buildFloorRooms(fi) {
    var yb = fi * FLOOR_H;
    var deskC  = 0x8b6040, legC = 0x5a3a1a, boardC = 0x2a5d3e;
    var shelfC = 0x7a5a38, labC = 0x909090;

    // Helper: row of student desks  (rows × cols grid, anchored at NW corner)
    function deskGrid(ax, az, rows, cols, fi) {
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          var dx = ax + c * 2.2 + 1.0, dz = az + r * 1.5 + 0.8;
          addToFloor(box(dx, yb + 0.42, dz, 1.1, 0.06, 0.65, deskC), fi);
        }
      }
    }

    if (fi === 2) {
      // 3rd Floor
      // N1 — Science Lab: 4 lab benches (2×2 grid, large)
      addToFloor(box(-14,  yb+0.5, 5.5, 3.5, 0.08, 1.2, labC), fi); addColl(-15.75, -12.25, 4.9, 6.1, 'top');
      addToFloor(box(-8,   yb+0.5, 5.5, 3.5, 0.08, 1.2, labC), fi); addColl(-9.75, -6.25, 4.9, 6.1, 'top');
      addToFloor(box(-14,  yb+0.5, 3.0, 3.5, 0.08, 1.2, labC), fi); addColl(-15.75, -12.25, 2.4, 3.6, 'top');
      addToFloor(box(-8,   yb+0.5, 3.0, 3.5, 0.08, 1.2, labC), fi); addColl(-9.75, -6.25, 2.4, 3.6, 'top');
      // Fume hood on north wall
      addToFloor(box(-12,  yb+1.1, 7.6, 4.0, 2.2, 0.7, 0x8090a0), fi);
      // N2 — Computer Lab: 12 monitor desks (3×4)
      deskGrid(-4, 1.8, 3, 4, fi);
      // N3 — Classroom 301
      deskGrid(5.5, 1.8, 4, 3, fi);
      var brd3 = new THREE.Mesh(new THREE.PlaneGeometry(6, 2), mat(boardC));
      brd3.position.set(10.5, yb + 2.4, 7.85); scene.add(brd3); addToFloor(brd3, fi);
      // S1 — Classroom 302
      deskGrid(-15.5, -7.5, 4, 3, fi);
      var brdS1 = new THREE.Mesh(new THREE.PlaneGeometry(6, 2), mat(boardC));
      brdS1.rotation.y = Math.PI; brdS1.position.set(-10.5, yb + 2.4, -7.85); scene.add(brdS1); addToFloor(brdS1, fi);
      // S2 — Storage: sealed door (metal shelf row blocking entry visually)
      addToFloor(box(0, yb + 0.9, -3.0, 8.0, 1.8, 0.5, 0x666666), fi);
      addColl(-4, 4, -3.25, -2.75, 'top');
      // S3 — Classroom 303
      deskGrid(5.5, -7.5, 4, 3, fi);
      var brdS3 = new THREE.Mesh(new THREE.PlaneGeometry(6, 2), mat(boardC));
      brdS3.rotation.y = Math.PI; brdS3.position.set(10.5, yb + 2.4, -7.85); scene.add(brdS3); addToFloor(brdS3, fi);

    } else if (fi === 1) {
      // 2nd Floor
      // N1 — Faculty Room: 8 staggered teacher desks
      var teachDeskPos = [[-14,5.5],[-12,3.5],[-10,5.5],[-8,3.5],[-14,7],[-10,7],[-8,6.5],[-12,6]];
      teachDeskPos.forEach(function(p) {
        addToFloor(box(p[0], yb+0.45, p[1], 1.4, 0.07, 0.8, deskC), fi);
      });
      // Filing cabinets on east wall of N1
      addToFloor(box(-5.4, yb+0.7, 5.5, 0.6, 1.4, 3.0, 0x7a8090), fi);
      addColl(-5.7, -5.1, 4.0, 7.0, 'upper');
      // N2 — Library: 3 bookshelf rows creating 2 walkable aisles
      // Row 1: x=-4 to +4 (partial, leaving gap at x=+3 to +4 for east access)
      addToFloor(box(-1.5, yb+1.0, 4.5, 5, 2.0, 0.6, shelfC), fi);
      addColl(-4, 1, 4.2, 4.8, 'upper');
      // Row 2
      addToFloor(box(-1.5, yb+1.0, 6.0, 5, 2.0, 0.6, shelfC), fi);
      addColl(-4, 1, 5.7, 6.3, 'upper');
      // Row 3 (short, north wall)
      addToFloor(box(0, yb+1.0, 7.4, 8, 2.0, 0.6, shelfC), fi);
      addColl(-4, 4, 7.1, 7.7, 'upper');
      // Library east-side door through room divider at x=+5, z=+4 (gap in divider wall for shortcut)
      // The divider wall segments in buildFloorWalls already leave the gap via door-gap logic at x=5 z=1.5
      // We add a visual doorframe here:
      addToFloor(box(4.88, yb+1.1, 4.5, 0.12, 2.2, 1.5, 0x8b6040), fi); // doorframe north post
      addToFloor(box(4.88, yb+2.3, 4.5, 0.12, 0.15, 1.5, 0x8b6040), fi); // header
      // N3 — Classroom 201
      deskGrid(5.5, 1.8, 4, 3, fi);
      // S1 — Restroom (stall partitions, no furniture)
      addToFloor(box(-13.5, yb+1.0, -5.5, 0.2, 2.0, 5.0, 0xcccccc), fi);
      addColl(-13.6, -13.4, -8, -3, 'upper');
      addToFloor(box(-9.5,  yb+1.0, -5.5, 0.2, 2.0, 5.0, 0xcccccc), fi);
      addColl(-9.6, -9.4, -8, -3, 'upper');
      // S2 — Guidance Office: booth dividers
      addToFloor(box(0, yb+0.9, -5.0, 7.0, 1.8, 0.3, 0x9aaca4), fi);
      addColl(-3.5, 3.5, -5.15, -4.85, 'upper');
      // S3 — Classroom 202
      deskGrid(5.5, -7.5, 4, 3, fi);

    } else {
      // 1st Floor
      // N1 — Principal's Office: large desk
      addToFloor(box(-11, yb+0.45, 5.0, 2.5, 0.08, 1.2, deskC), fi);
      addColl(-12.25, -9.75, 4.4, 5.6, 'lower');
      addToFloor(box(-14.5, yb+1.0, 5.5, 0.5, 2.0, 4.0, shelfC), fi);
      addColl(-14.75, -14.25, 3.5, 7.5, 'lower');
      // N2 — Admin: long counter + benches
      addToFloor(box(0, yb+0.55, 5.0, 8.0, 1.1, 0.7, 0x9a7a5a), fi);
      addColl(-4, 4, 4.65, 5.35, 'lower');
      addToFloor(box(-2, yb+0.22, 3.0, 1.4, 0.45, 0.5, deskC), fi);
      addToFloor(box( 2, yb+0.22, 3.0, 1.4, 0.45, 0.5, deskC), fi);
      // N3 — Clinic: 2 beds
      addToFloor(box(8,  yb+0.3, 4.5, 1.0, 0.6, 2.0, 0xeeeeee), fi); addColl(7.5, 8.5, 3.5, 5.5, 'lower');
      addToFloor(box(13, yb+0.3, 4.5, 1.0, 0.6, 2.0, 0xeeeeee), fi); addColl(12.5, 13.5, 3.5, 5.5, 'lower');
      // S2 — Lobby: 4 wall benches and notice board
      addToFloor(box(-3, yb+0.22, -6.5, 3.0, 0.45, 0.5, 0x6a4a2a), fi);
      addToFloor(box( 3, yb+0.22, -6.5, 3.0, 0.45, 0.5, 0x6a4a2a), fi);
      addToFloor(box(0,  yb+0.22, -3.5, 5.0, 0.45, 0.5, 0x6a4a2a), fi);
      // Notice board on lobby south wall
      var nb = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.5, 0.08), mat(0x8b6040));
      nb.position.set(0, yb+1.8, -7.85); scene.add(nb); addToFloor(nb, fi);
      // Lobby flood puddle (hazard visual for D4)
      var puddle = new THREE.Mesh(new THREE.PlaneGeometry(7, 5),
        mat(0x2a4a6a, { transparent: true, opacity: 0.65 }));
      puddle.rotation.x = -Math.PI / 2; puddle.position.set(0, 0.04, -5.5); scene.add(puddle);
      // Wet-floor cone
      var cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 8), mat(0xff8020));
      cone.position.set(1.5, yb+0.35, -4.0); scene.add(cone);
    }
  }

  // ── Per-floor hazard props (tied to decision points) ───────────────────────
  function buildFloorHazards(fi) {
    var yb = fi * FLOOR_H;
    var rubbleC = 0x6a6258, plasterC = 0xc8c2b6, beamC = 0x8a6a4a;
    var wireC = 0x222222, sparkC = 0xffcc22;
    var ft = fi === 0 ? 'lower' : fi === 1 ? 'upper' : 'top';

    if (fi === 2) {
      // ── 3F D0: debris pile blocking west corridor (x≈-8, z=0) ──
      var b1 = box(-8, yb+0.7, 0, 2.2, 1.4, 1.2, rubbleC); addToFloor(b1, fi);
      addColl(-9.1, -6.9, -0.6, 0.6, ft);
      [[-9.8, 0.5], [-7.2, -0.4], [-8.5, 1.2]].forEach(function(p) {
        var ch = new THREE.Mesh(geo(0.6, 0.35, 0.5), mat(plasterC));
        ch.position.set(p[0], yb+0.18, p[1]); ch.rotation.y = 0.7; scene.add(ch); addToFloor(ch, fi);
      });
      var fb = box(-8.5, yb+1.35, 0.1, 2.8, 0.32, 0.32, beamC); addToFloor(fb, fi);
      // ── 3F D1: smoke haze at west stairwell door (x=-16.5, z=0) ──
      [[-16.3, 0.4], [-16.7, -0.3], [-16.5, 1.0]].forEach(function(off) {
        var haze = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 3.5),
          mat(0x111111, { transparent: true, opacity: 0.3, side: THREE.DoubleSide }));
        haze.position.set(off[0], yb+1.8, off[1]); scene.add(haze); addToFloor(haze, fi);
      });

    } else if (fi === 1) {
      // ── 2F D2: live wire at x=+12, z=0 ──
      var wirePost = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6), mat(wireC));
      wirePost.position.set(12, yb+2.0, 0); wirePost.rotation.x = 0.25;
      scene.add(wirePost); addToFloor(wirePost, fi);
      var spark = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8),
        new THREE.MeshBasicMaterial({ color: sparkC, transparent: true, opacity: 1.0 }));
      spark.position.set(12.1, yb+0.8, 0.1); scene.add(spark); addToFloor(spark, fi);
      strobes.push({ mesh: spark, color: sparkC, base: 1.0, freq: 7.0, baseY: yb + 0.8 });
      addColl(11.6, 12.6, -0.5, 0.5, ft);
      var scorch = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4),
        mat(0x1a1a1a, { transparent: true, opacity: 0.7 }));
      scorch.rotation.x = -Math.PI / 2; scorch.position.set(12, yb+0.03, 0);
      scene.add(scorch); addToFloor(scorch, fi);
      // ── 2F D3: fallen locker near west stairwell door (x=-16, z=+0.3) ──
      var lok = box(-16, yb+0.3, 0.3, 2.0, 0.6, 1.2, 0x6e7e8c); addToFloor(lok, fi);
      lok.rotation.y = 0.08; // slight rotation — looks tipped
      addColl(-17.2, -14.8, -0.4, 1.0, ft);
      [[-17.2, -0.8], [-14.8, 1.4]].forEach(function(p) {
        var tile = new THREE.Mesh(geo(0.45, 0.08, 0.45), mat(plasterC));
        tile.position.set(p[0], yb+0.04, p[1]); tile.rotation.y = 0.5;
        scene.add(tile); addToFloor(tile, fi);
      });

    } else {
      // ── 1F D4: lobby flood visual ── (puddle built in buildFloorRooms)
      // Debris against main entrance doors
      var dbl = box(-0.5, yb+0.45, -8.4, 2.5, 0.9, 0.6, rubbleC);
      addColl(-1.75, 0.75, -8.7, -8.1, ft);
      // Wet-floor wet sheen near exit path
      var sheen = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 2.0),
        mat(0x2a4a6a, { transparent: true, opacity: 0.45 }));
      sheen.rotation.x = -Math.PI / 2; sheen.position.set(18, 0.04, 0); scene.add(sheen);
    }
  }

  // ─── EAST EXIT SURROUNDINGS ───────────────────────────
  // Fills the empty zone east of the school's emergency exit (x=22+, z≈-8 to +20).
  function buildEastExitArea() {
    var swMat = mat(0x9a9387);

    // Sidewalk running east from exit (x=22) to east-road corridor (x=40) at z=0
    var exitPath = new THREE.Mesh(new THREE.PlaneGeometry(18, 2.5), swMat);
    exitPath.rotation.x = -Math.PI / 2;
    exitPath.position.set(31, 0.012, 0);
    scene.add(exitPath);

    // Short N-S connector at x=38 linking exit path down to z=-20 (toward east road)
    var connPath = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 22), swMat);
    connPath.rotation.x = -Math.PI / 2;
    connPath.position.set(38, 0.012, -10);
    scene.add(connPath);

    // Small courtyard/apron directly outside the exit door
    var apron = new THREE.Mesh(new THREE.PlaneGeometry(6, 5), swMat);
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(24.5, 0.011, 0);
    scene.add(apron);

    // ── Houses northeast of the school ──
    var doorMat   = mat(0x4a2a18);
    var windowMat = mat(0xfff0a0, { transparent: true, opacity: 0.55 });

    // House A — hip roof, northeast (x=34, z=14)
    box(34, 3, 14, 10, 6, 9, 0xd4a76a);
    addColl(29, 39, 9.5, 18.5, 'lower');
    var hipA = new THREE.Mesh(new THREE.ConeGeometry(7.2, 2, 4), mat(0x2a4a7a));
    hipA.rotation.y = Math.PI / 4;
    hipA.position.set(34, 7, 14); scene.add(hipA);

    // House B — hip roof, further east (x=50, z=9)
    box(50, 2.75, 9, 9, 5.5, 8, 0xb8805a);
    addColl(45.5, 54.5, 5, 13, 'lower');
    var hipB = new THREE.Mesh(new THREE.ConeGeometry(7.2, 2, 4), mat(0x6e2a2a));
    hipB.rotation.y = Math.PI / 4;
    hipB.position.set(50, 6.5, 9); scene.add(hipB);

    // Doors and windows for both houses
    [{ hx: 34, hz: 14, hw: 10, hd: 9 }, { hx: 50, hz: 9, hw: 9, hd: 8 }].forEach(function (h) {
      var dr = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.9, 0.06), doorMat);
      dr.position.set(h.hx - 1.5, 0.95, h.hz - h.hd / 2 - 0.04);
      scene.add(dr);
      var hnd = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), mat(0xddc060));
      hnd.position.set(dr.position.x + 0.3, 1.0, dr.position.z - 0.04);
      scene.add(hnd);
      for (var wi = 0; wi < 2; wi++) {
        var wx = h.hx - h.hw / 2 + (h.hw / 3) * (wi + 1);
        if (Math.abs(wx - dr.position.x) < 0.9) continue;
        var ws = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), windowMat);
        ws.position.set(wx, 1.4, h.hz + h.hd / 2 + 0.04); scene.add(ws);
        var wn = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), windowMat);
        wn.position.set(wx, 1.4, h.hz - h.hd / 2 - 0.04); wn.rotation.y = Math.PI; scene.add(wn);
      }
    });

    // ── Lamp posts along exit path ──
    [28, 34].forEach(function (lx) {
      var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 5, 6), mat(0x2a2a2a));
      pole.position.set(lx, 2.5, 1.8); scene.add(pole);
      var arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.2), mat(0x2a2a2a));
      arm.position.set(lx, 5, 1.8); scene.add(arm);
      var bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), bmat(0xfff5b0));
      bulb.position.set(lx, 4.9, 1.8); scene.add(bulb);
      var ll = new THREE.PointLight(0xffeec4, 0.55, 14);
      ll.position.set(lx, 4.6, 1.8); scene.add(ll);
      addColl(lx - 0.15, lx + 0.15, 1.65, 1.95, 'lower');
    });

    // ── Fence along the south face of house A ──
    for (var fx = 29; fx < 39; fx += 1.2) {
      var slat = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 0.06), mat(0xb0a080));
      slat.position.set(fx, 0.5, 9);
      scene.add(slat);
    }
    var fenceRail = new THREE.Mesh(new THREE.BoxGeometry(10, 0.06, 0.04), mat(0x9b8b6c));
    fenceRail.position.set(34, 0.85, 9); scene.add(fenceRail);
    addColl(29, 39, 8.94, 9.06, 'lower');

    // ── Mailboxes near new houses ──
    [[33, 9.2], [49, 5.4]].forEach(function (m) {
      var post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 6), mat(0x4a3020));
      post.position.set(m[0], 0.5, m[1]); scene.add(post);
      var bx = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.25), mat(0x404040));
      bx.position.set(m[0], 1.1, m[1]); scene.add(bx);
    });

    // ── Bench just outside the exit door ──
    var seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.5), mat(0x6b4226));
    seat.position.set(26, 0.55, 1.9); scene.add(seat);
    var back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 0.08), mat(0x6b4226));
    back.position.set(26, 0.85, 1.66); scene.add(back);
    [[25.2, 1.9], [26.8, 1.9]].forEach(function (p) {
      var leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.55, 0.5), mat(0x3a3a3a));
      leg.position.set(p[0], 0.28, p[1]); scene.add(leg);
    });
    addColl(25.1, 26.9, 1.65, 2.15, 'lower');

    // ── Trash can near exit ──
    var can = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 10), mat(0x2a4a2a));
    can.position.set(24, 0.45, -1.5); scene.add(can);
    addColl(23.7, 24.3, -1.8, -1.2, 'lower');

    // ── Power pole on the north side of the exit path ──
    var pp = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 9, 6), mat(0x6a4a30));
    pp.position.set(36, 4.5, 2.8); scene.add(pp);
    var ca = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 0.1), mat(0x4a3020));
    ca.position.set(36, 8.4, 2.8); scene.add(ca);
    addColl(35.8, 36.2, 2.6, 3.0, 'lower');
  }

  // ─── OUTDOOR AREA ─────────────────────────────────────
  function buildOutdoor() {
    // Main ground
    var groundMat = mat(0x4a7c59);
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), groundMat);
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // Pavement around school south exit
    var pave = new THREE.Mesh(new THREE.PlaneGeometry(50, 10), mat(0x888880));
    pave.rotation.x = -Math.PI / 2;
    pave.position.set(0, 0.01, -13);
    scene.add(pave);

    buildRoads();
    buildOutdoorBuildings();
    buildStreetFurniture();
    buildDebrisAndBarriers();
    buildShelter();
    buildTrees();
    buildEastExitArea();
    buildSituationalCues();
  }

  function buildDebrisAndBarriers() {
    // ── COLLAPSED BRIDGE blocking the main road south of z=-48. Full-width. ──
    function barrierWall(x1, x2, z1, z2, h, color) {
      var cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
      var w = Math.abs(x2 - x1), d = Math.abs(z2 - z1);
      box(cx, h / 2, cz, Math.max(w, 0.2), h, Math.max(d, 0.2), color);
      addColl(Math.min(x1, x2), Math.max(x1, x2), Math.min(z1, z2), Math.max(z1, z2), 'lower');
    }
    barrierWall(-16, 16, -49.5, -48.5, 1.8, 0x7a7a72); // concrete barrier across road
    barrierWall(-16, 16, -51.5, -50.5, 1.4, 0x6a6a62); // second fallen slab row
    // Broken asphalt / rebar chunks in the collapse gap
    [[-10, -50], [-5, -49.3], [0, -50.5], [5, -49.7], [10, -50.2]].forEach(function (p) {
      var ch = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.4, 1.2), mat(0x4a4a42));
      ch.position.set(p[0], 0.2, p[1]);
      ch.rotation.y = Math.random() * 0.8;
      scene.add(ch);
    });
    // Fallen power pole lying on top of the collapse
    var fallen = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 14, 8), mat(0x6a4a30));
    fallen.rotation.z = Math.PI / 2;
    fallen.position.set(0, 1.4, -50);
    scene.add(fallen);
    var wire = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 14, 6), mat(0x222222));
    wire.rotation.z = Math.PI / 2;
    wire.position.set(0, 2.0, -49.5);
    scene.add(wire);
    // Police tape + warning posts just north of the collapse
    [[-5, -46.5], [5, -46.5]].forEach(function (p) {
      var post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 6), mat(0xeeeeee));
      post.position.set(p[0], 0.7, p[1]);
      scene.add(post);
    });
    var tape = new THREE.Mesh(new THREE.PlaneGeometry(10, 0.25), mat(0xffdd20));
    tape.position.set(0, 1.3, -46.4);
    scene.add(tape);

    // (Removed: fake debris pile and slab chunks that sat outside the school exit — felt artificial)

    // ── Extra tight fencing between houses creates dead-end alleys ──
    function wall(x1, x2, z1, z2, h, color) {
      var cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
      var w = Math.abs(x2 - x1), d = Math.abs(z2 - z1);
      box(cx, h / 2, cz, Math.max(w, 0.2), h, Math.max(d, 0.2), color);
      addColl(Math.min(x1, x2), Math.max(x1, x2), Math.min(z1, z2), Math.max(z1, z2), 'lower');
    }
    // Extended side barricades prevent going around the collapsed bridge on grass
    wall(-40, -16, -48.2, -47.8, 2.2, 0xa89878);
    wall(16, 40, -50.2, -49.8, 2.2, 0xa89878);
    // Concrete barriers funneling the D4 intersection on the shelter approach road
    wall(30, 38, -108.2, -107.8, 1.2, 0xb0b0b0);
    wall(58, 75, -108.2, -107.8, 1.2, 0xb0b0b0);

    // ── Sandbag walls protecting some houses (visual + collision) ──
    function sandbag(x, z, len, ry) {
      for (var i = 0; i < len; i++) {
        var sb = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.3, 0.5), mat(0xa89060));
        var ox = i * 0.85 * Math.cos(ry);
        var oz = i * 0.85 * Math.sin(ry);
        sb.position.set(x + ox, 0.15, z + oz);
        sb.rotation.y = ry;
        scene.add(sb);
      }
      var endX = x + (len - 1) * 0.85 * Math.cos(ry);
      var endZ = z + (len - 1) * 0.85 * Math.sin(ry);
      addColl(Math.min(x, endX) - 0.4, Math.max(x, endX) + 0.4,
              Math.min(z, endZ) - 0.3, Math.max(z, endZ) + 0.3, 'lower');
    }
    sandbag(22, -58, 5, 0);
    sandbag(52, -70, 5, 0);
    sandbag(62, -98, 5, 0);

    // ── Narrow passable gap at the intersection so the route choice matters ──
    // Partial wall across main road at z=-30 (just before crosswalk), gap in center is east/west only
    // (actually the signs at z=-28 are what player must walk between)

    // (Removed: chair/desk blocking 2nd-floor hallway — felt artificial in a real school layout)
  }

  function buildRoads() {
    var roadMat = mat(0x2a2a2a);
    var lineMat = mat(0xffee44);
    var swMat = mat(0x9a9387);
    var crackMat = mat(0x1a1a1a);

    // ── Main N-S road (blocked south of z=-48 by collapsed bridge) ──
    var mainRoad = new THREE.Mesh(new THREE.PlaneGeometry(8, 150), roadMat);
    mainRoad.rotation.x = -Math.PI / 2;
    mainRoad.position.set(0, 0.02, -95);
    scene.add(mainRoad);

    // ── East detour N-S road (x=40) from intersection at z=-35 down to z=-140 ──
    var eastRoad = new THREE.Mesh(new THREE.PlaneGeometry(8, 110), roadMat);
    eastRoad.rotation.x = -Math.PI / 2;
    eastRoad.position.set(40, 0.02, -90);
    scene.add(eastRoad);

    // ── Shelter approach (E-W) at z=-135 from main to shelter entrance ──
    var shelterRoad = new THREE.Mesh(new THREE.PlaneGeometry(45, 7), roadMat);
    shelterRoad.rotation.x = -Math.PI / 2;
    shelterRoad.position.set(52, 0.02, -124);
    scene.add(shelterRoad);

    // Cross roads at intersections (on main road)
    [-35, -55, -80, -105].forEach(function (z) {
      var cr = new THREE.Mesh(new THREE.PlaneGeometry(120, 7), roadMat);
      cr.rotation.x = -Math.PI / 2;
      cr.position.set(0, 0.02, z);
      scene.add(cr);
    });

    // Dashed center lines on main road (skip intersections + blockage area)
    for (var z = -25; z > -170; z -= 6) {
      if (z < -48 && z > -54) continue; // skip collapsed bridge zone
      if (Math.abs(z + 35) < 4 || Math.abs(z + 55) < 4 || Math.abs(z + 80) < 4 || Math.abs(z + 105) < 4) continue;
      var line = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 3), lineMat);
      line.rotation.x = -Math.PI / 2;
      line.position.set(0, 0.03, z);
      scene.add(line);
    }
    // Dashed center lines on east road
    for (var ez = -38; ez > -140; ez -= 6) {
      if (Math.abs(ez + 105) < 4 || Math.abs(ez + 124) < 4) continue;
      var eline = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 3), lineMat);
      eline.rotation.x = -Math.PI / 2;
      eline.position.set(40, 0.03, ez);
      scene.add(eline);
    }

    // Crosswalks at intersections
    [-35, -55, -80, -105].forEach(function (cz) {
      for (var i = -3; i <= 3; i++) {
        var stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 6), mat(0xeeeeee));
        stripe.rotation.x = -Math.PI / 2;
        stripe.position.set(i * 1.0, 0.04, cz);
        scene.add(stripe);
      }
    });
    // Crosswalk at east road + shelter approach junction (40, -105) and (40, -124)
    [[40, -105], [40, -124]].forEach(function (p) {
      for (var i = -3; i <= 3; i++) {
        var stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 6), mat(0xeeeeee));
        stripe.rotation.x = -Math.PI / 2;
        stripe.position.set(p[0] + i * 1.0, 0.04, p[1]);
        scene.add(stripe);
      }
    });

    // Road cracks removed for perf — they were purely decorative

    // Sidewalks along main road
    [-5.5, 5.5].forEach(function (sx) {
      var sw = new THREE.Mesh(new THREE.PlaneGeometry(2, 150), swMat);
      sw.rotation.x = -Math.PI / 2;
      sw.position.set(sx, 0.015, -95);
      scene.add(sw);
      var curb = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.12, 150), mat(0xbbb6a8));
      curb.position.set(sx + (sx > 0 ? -1 : 1), 0.06, -95);
      scene.add(curb);
    });
    // Sidewalks along east road
    [34.5, 45.5].forEach(function (sx) {
      var sw = new THREE.Mesh(new THREE.PlaneGeometry(2, 110), swMat);
      sw.rotation.x = -Math.PI / 2;
      sw.position.set(sx, 0.015, -90);
      scene.add(sw);
    });

    // Sidewalks along cross-streets
    [-35, -55, -80, -105].forEach(function (cz) {
      [-1.5, 1.5].forEach(function (off) {
        var sw = new THREE.Mesh(new THREE.PlaneGeometry(120, 1.8), swMat);
        sw.rotation.x = -Math.PI / 2;
        sw.position.set(0, 0.015, cz + off * 2.6);
        scene.add(sw);
      });
    });
    // Sidewalk along shelter approach
    [-1.5, 1.5].forEach(function (off) {
      var sw = new THREE.Mesh(new THREE.PlaneGeometry(45, 1.8), swMat);
      sw.rotation.x = -Math.PI / 2;
      sw.position.set(52, 0.015, -124 + off * 2.6);
      scene.add(sw);
    });
  }

  function buildOutdoorBuildings() {
    var wallColors = [0xc8956c, 0xd4a76a, 0xb8805a, 0xe8c49a, 0xa07850, 0xcfa080, 0x9c8466];
    var roofColors = [0x6e2a2a, 0x2a4a7a, 0x3a6a3a, 0x7a6a22, 0x5a3a2a];
    var windowMat = mat(0xfff0a0, { transparent: true, opacity: 0.55 });
    var doorMat   = mat(0x4a2a18);

    var houses = [
      { x: -18, z: -32, w: 12, h: 7, d: 10, roof: 'hip' },
      { x: -30, z: -45, w: 8,  h: 5, d: 8,  roof: 'hip' },
      { x: -18, z: -55, w: 10, h: 6, d: 9,  roof: 'hip' },
      { x: 20,  z: -28, w: 11, h: 6, d: 8,  roof: 'hip' },
      { x: 28,  z: -42, w: 9,  h: 8, d: 10, roof: 'hip' },
      { x: 22,  z: -58, w: 10, h: 6, d: 8,  roof: 'hip' },
      { x: -11, z: -36, w: 6,  h: 5, d: 6,  roof: 'hip' },
      { x: 11,  z: -66, w: 6,  h: 5, d: 6,  roof: 'hip' },
      { x: -40, z: -68, w: 14, h: 7, d: 12, roof: 'hip' },
      { x: 55,  z: -70, w: 14, h: 7, d: 12, roof: 'hip' },
      { x: -25, z: -82, w: 10, h: 6, d: 8,  roof: 'hip' },
      { x: 25,  z: -88, w: 10, h: 6, d: 8,  roof: 'hip' },
      { x: -30, z: -38, w: 8,  h: 4, d: 6,  roof: 'hip' },
      { x: -45, z: -90, w: 12, h: 6, d: 10, roof: 'hip' },
      { x: 58,  z: -92, w: 12, h: 6, d: 10, roof: 'hip' },
      { x: 55,  z: -50, w: 10, h: 6, d: 8,  roof: 'hip' },
      { x: 26,  z: -118, w: 9, h: 5, d: 7,  roof: 'hip' }
    ];

    houses.forEach(function (b, i) {
      var bc = wallColors[i % wallColors.length];
      var rc = roofColors[i % roofColors.length];

      // walls
      box(b.x, b.h / 2, b.z, b.w, b.h, b.d, bc);
      addColl(b.x - b.w/2, b.x + b.w/2, b.z - b.d/2, b.z + b.d/2, 'lower');

      // roof
      var hipGeo = new THREE.ConeGeometry(Math.max(b.w, b.d) * 0.72, 2, 4);
      var hip = new THREE.Mesh(hipGeo, mat(rc));
      hip.rotation.y = Math.PI / 4;
      hip.position.set(b.x, b.h + 1, b.z);
      scene.add(hip);

      // door (south-facing)
      var dr = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.9, 0.06), doorMat);
      dr.position.set(b.x + (Math.random() - 0.5) * (b.w * 0.4), 0.95, b.z + b.d / 2 + 0.04);
      scene.add(dr);
      // door handle
      var hnd = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), mat(0xddc060));
      hnd.position.set(dr.position.x + 0.3, 1.0, dr.position.z + 0.04);
      scene.add(hnd);

      // windows on each side
      var winRows = b.h > 6 ? 2 : 1;
      var winsPerSide = b.w > 9 ? 3 : 2;
      for (var r = 0; r < winRows; r++) {
        var wy = 1.4 + r * 2.4;
        for (var w = 0; w < winsPerSide; w++) {
          var wx = b.x - b.w/2 + (b.w / (winsPerSide + 1)) * (w + 1);
          // skip window where door is on south side
          if (r === 0 && Math.abs(wx - dr.position.x) < 0.8) continue;
          // south
          var ws = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), windowMat);
          ws.position.set(wx, wy, b.z + b.d/2 + 0.04);
          scene.add(ws);
          // north
          var wn = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), windowMat);
          wn.position.set(wx, wy, b.z - b.d/2 - 0.04);
          wn.rotation.y = Math.PI;
          scene.add(wn);
        }
        for (var ws2 = 0; ws2 < (b.d > 8 ? 2 : 1); ws2++) {
          var wz = b.z - b.d/2 + (b.d / ((b.d > 8 ? 2 : 1) + 1)) * (ws2 + 1);
          var we = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), windowMat);
          we.rotation.y = -Math.PI / 2;
          we.position.set(b.x + b.w/2 + 0.04, wy, wz);
          scene.add(we);
          var ww = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), windowMat);
          ww.rotation.y = Math.PI / 2;
          ww.position.set(b.x - b.w/2 - 0.04, wy, wz);
          scene.add(ww);
        }
      }
    });
  }

  // Lamp posts, fences, abandoned cars, mailboxes, signs
  function buildStreetFurniture() {
    // Lamp posts along the main road
    for (var lz = -25; lz > -160; lz -= 14) {
      [-7, 7].forEach(function (lx) {
        var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 5, 6), mat(0x2a2a2a));
        pole.position.set(lx, 2.5, lz);
        scene.add(pole);
        var arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.2), mat(0x2a2a2a));
        arm.position.set(lx + (lx > 0 ? -0.6 : 0.6), 5, lz);
        scene.add(arm);
        var bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), bmat(0xfff5b0));
        bulb.position.set(lx + (lx > 0 ? -1.2 : 1.2), 4.9, lz);
        scene.add(bulb);
        var lampLight = new THREE.PointLight(0xffeec4, 0.55, 14);
        lampLight.position.set(lx + (lx > 0 ? -1.2 : 1.2), 4.6, lz);
        scene.add(lampLight);
        addColl(lx - 0.15, lx + 0.15, lz - 0.15, lz + 0.15, 'lower');
      });
    }

    // Fences between yards (front edges of houses)
    function fence(x1, x2, z) {
      for (var fx = x1; fx < x2; fx += 1.2) {
        var slat = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 0.06), mat(0xb0a080));
        slat.position.set(fx, 0.5, z);
        scene.add(slat);
      }
      var rail = new THREE.Mesh(new THREE.BoxGeometry(x2 - x1, 0.06, 0.04), mat(0x9b8b6c));
      rail.position.set((x1 + x2) / 2, 0.85, z);
      scene.add(rail);
      addColl(x1, x2, z - 0.06, z + 0.06, 'lower');
    }
    fence(-43, -33, -40);
    fence(-26, -16, -40);
    fence(15, 27, -40);
    fence(22, 32, -52);        // west of east road
    fence(-43, -34, -75);
    fence(48, 64, -75);        // east of east road (past NPC)
    fence(16, 22, -122);       // along shelter-approach south sidewalk, west end

    // Abandoned cars (partially blocking road)
    function car(x, z, ry, color) {
      var body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 4.4), mat(color));
      body.position.set(x, 0.55, z);
      body.rotation.y = ry;
      scene.add(body);
      var top = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.7, 2.4), mat(color));
      top.position.set(x, 1.2, z);
      top.rotation.y = ry;
      scene.add(top);
      // windows
      var glassMt = mat(0x224455, { transparent: true, opacity: 0.75 });
      [[0.85, 0], [-0.85, 0]].forEach(function (o) {
        var w = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.55), glassMt);
        w.rotation.y = ry + Math.PI/2;
        w.position.set(x + Math.cos(ry) * o[0], 1.2, z + Math.sin(ry) * o[0]);
        scene.add(w);
      });
      // wheels
      [[1.0, 1.6], [-1.0, 1.6], [1.0, -1.6], [-1.0, -1.6]].forEach(function (off) {
        var ox = off[0] * Math.cos(ry) - off[1] * Math.sin(ry);
        var oz = off[0] * Math.sin(ry) + off[1] * Math.cos(ry);
        var wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.3, 10), mat(0x111111));
        wheel.rotation.z = Math.PI / 2;
        wheel.rotation.y = ry;
        wheel.position.set(x + ox, 0.35, z + oz);
        scene.add(wheel);
      });
      // collision (axis-aligned approx)
      var hw = Math.abs(Math.cos(ry)) * 1 + Math.abs(Math.sin(ry)) * 2.2;
      var hd = Math.abs(Math.sin(ry)) * 1 + Math.abs(Math.cos(ry)) * 2.2;
      addColl(x - hw, x + hw, z - hd, z + hd, 'lower');
    }
    car(-2.5, -42, 0.15, 0xb53030);
    car(2.0, -68, -0.1, 0x2a4a7a);
    car(-12, -27, 1.2, 0x6a6a6a);
    car(14, -88, 0, 0xc8b030);
    car(-3.5, -98, 1.5, 0x556055);

    // Mailboxes
    [[-12, -28], [-22, -52], [13, -38], [22, -52], [-15, -82], [16, -84]].forEach(function (m) {
      var post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 6), mat(0x4a3020));
      post.position.set(m[0], 0.5, m[1]);
      scene.add(post);
      var bx = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.25), mat(0x404040));
      bx.position.set(m[0], 1.1, m[1]);
      scene.add(bx);
    });

    // Trash cans
    [[6, -36], [-6, -50], [7, -78], [-7, -92]].forEach(function (t) {
      var can = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 10), mat(0x2a4a2a));
      can.position.set(t[0], 0.45, t[1]);
      scene.add(can);
      addColl(t[0] - 0.3, t[0] + 0.3, t[1] - 0.3, t[1] + 0.3, 'lower');
    });

    // Power line poles
    for (var pz = -28; pz > -150; pz -= 22) {
      var pp = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 9, 6), mat(0x6a4a30));
      pp.position.set(-9, 4.5, pz);
      scene.add(pp);
      var crossArm = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 0.1), mat(0x4a3020));
      crossArm.position.set(-9, 8.4, pz);
      scene.add(crossArm);
      addColl(-9.2, -8.8, pz - 0.2, pz + 0.2, 'lower');
    }
  }

  function buildShelter() {
    var sx = SHELTER.x, sz = SHELTER.z;

    // Hill base — visual mound under the shelter (player Y handled in updateFloorY)
    var hill = new THREE.Mesh(
      new THREE.SphereGeometry(28, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.4),
      mat(0x3a6a3a)
    );
    hill.position.set(sx, 0.05, sz);
    hill.scale.set(1, 0.06, 1);
    scene.add(hill);
    // Concrete steps up to hill on the north side
    for (var s = 0; s < 5; s++) {
      var step = new THREE.Mesh(new THREE.BoxGeometry(8, 0.3, 1.2), mat(0xa0a0a0));
      step.position.set(sx, 0.15 + s * 0.28, sz + 13 - s * 1.0);
      scene.add(step);
    }

    // Community center main building (visual only — collision handled separately)
    box(sx, 5.5 + 1.4, sz, 22, 11, 16, 0x1a4a70);
    // 3 solid walls + north entrance gap (-4 to +4) — at hill height
    addColl(sx - 11, sx + 11, sz - 8, sz - 7.7, 'lower'); // south wall
    addColl(sx - 11, sx - 10.7, sz - 8, sz + 8, 'lower'); // west wall
    addColl(sx + 10.7, sx + 11, sz - 8, sz + 8, 'lower'); // east wall
    addColl(sx - 11, sx - 4, sz + 7.7, sz + 8, 'lower');  // north wall left
    addColl(sx + 4, sx + 11, sz + 7.7, sz + 8, 'lower');  // north wall right

    // Roof
    box(sx, 13.0, sz, 24, 1.2, 18, 0x123550);
    // Pillars at entrance
    [-8, -4, 4, 8].forEach(function (px) {
      box(sx + px, 5.4, sz + 8.5, 0.6, 8, 0.6, 0x1a4a70);
    });
    // Porch awning
    box(sx, 10.6, sz + 9, 22, 0.4, 4, 0x123550);

    // Sign above entrance
    var signMesh = new THREE.Mesh(new THREE.BoxGeometry(14, 2, 0.15), mat(0xffffff));
    signMesh.position.set(sx, 13.9, sz + 8.1);
    scene.add(signMesh);
    var bar = new THREE.Mesh(new THREE.BoxGeometry(14, 0.6, 0.12), mat(0x1a6cf0));
    bar.position.set(sx, 12.9, sz + 8.11);
    scene.add(bar);
    // "EVACUATION CENTER" lettering hint (white plane on blue)
    var letters = new THREE.Mesh(new THREE.PlaneGeometry(13.5, 1.6), mat(0x1a4a70));
    letters.position.set(sx, 13.9, sz + 8.18);
    scene.add(letters);

    // ── Beacon pole — tall green pillar visible from the school ──────────────
    var beaconPole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.4, 40, 8),
      new THREE.MeshBasicMaterial({ color: 0x00ff66 })
    );
    beaconPole.position.set(sx, 20, sz);
    scene.add(beaconPole);

    // Spinning halo ring high up on the beacon
    var haloGeo = new THREE.RingGeometry(5, 7, 32);
    var haloMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    beaconHalo = new THREE.Mesh(haloGeo, haloMat);
    beaconHalo.position.set(sx, 42, sz);
    scene.add(beaconHalo);
    strobes.push({ mesh: beaconHalo, color: 0x00ff88, base: 0.85, freq: 1.8 });

    // Glowing sphere at the top of the beacon
    var beaconLight = new THREE.PointLight(0x00ff66, 2.5, 80);
    beaconLight.position.set(sx, 41, sz);
    scene.add(beaconLight);
    strobes.push({ light: beaconLight, base: 2.5, freq: 1.8 });

    // Safe zone ring on the ground (pulsing in animate)
    var ringGeo = new THREE.RingGeometry(12, 15, 48);
    var ringMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.2, side: THREE.DoubleSide });
    safeZoneRing = new THREE.Mesh(ringGeo, ringMat);
    safeZoneRing.rotation.x = -Math.PI / 2;
    safeZoneRing.position.set(sx, 0.12, sz + 4);
    scene.add(safeZoneRing);

    // Green floor arrows pointing toward entrance
    for (var az = SHELTER.entryZ + 2; az > SHELTER.entryZ - 8; az -= 4) {
      var arrow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.5), bmat(0x00cc66));
      arrow.rotation.x = -Math.PI / 2;
      arrow.position.set(sx, 0.05, az);
      scene.add(arrow);
    }

    // "SAFE SHELTER →" text on the shelter-approach road, visible from east-road junction
    var guideSign = new THREE.Mesh(new THREE.BoxGeometry(8, 1.5, 0.1), mat(0x27ae60));
    guideSign.position.set(50, 5, -124);
    guideSign.rotation.y = -Math.PI / 2; // faces west, readable from the east road
    scene.add(guideSign);
  }

  function buildTrees() {
    var trunkMat = mat(0x8b4513);
    var leafMats = [mat(0x2d8a1b), mat(0x1a6b10), mat(0x3a9020)];

    function makeTree(x, z) {
      var h = 3.5 + Math.random() * 3;
      var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, h, 6), trunkMat);
      trunk.position.set(x, h / 2, z);
      scene.add(trunk);
      var lm = leafMats[Math.floor(Math.random() * leafMats.length)];
      var fol = new THREE.Mesh(new THREE.SphereGeometry(1.4 + Math.random() * 0.5, 7, 7), lm);
      fol.position.set(x, h + 0.9, z);
      scene.add(fol);
    }

    var treeSpots = [
      [-14,-28],[-16,-38],[-15,-48],[-14,-62],[-15,-72],[-14,-84],
      [14,-30],[15,-42],[14,-52],[15,-64],[14,-74],[15,-86],
      [-35,-25],[-38,-35],[28,-25],[30,-40],
      [-42,-55],[-44,-68],[30,-58],[30,-78],[50,-54],[52,-82],
      [-8,-25],[-10,-28],[8,-25],[10,-28],
      [48,-115],[30,-128],
      // northeast exit area
      [27,7],[32,18],[40,19],[46,17],[53,17],[38,-6]
    ];
    treeSpots.forEach(function (t) { makeTree(t[0], t[1]); });
  }

  // ─── Flood Water ─────────────────────────────────────
  function buildFloodWater() {
    var geo = new THREE.PlaneGeometry(600, 600);
    var fmat = mat(0x1565c0, { transparent: true, opacity: 0.75 });
    floodMesh = new THREE.Mesh(geo, fmat);
    floodMesh.rotation.x = -Math.PI / 2;
    floodMesh.position.y = -3;
    scene.add(floodMesh);
  }

  // ─── Rain ─────────────────────────────────────────────
  function buildRain() {
    var count = 7000;
    var geo = new THREE.BufferGeometry();
    var pos = new Float32Array(count * 3);
    for (var i = 0; i < count * 3; i += 3) {
      pos[i]     = (Math.random() - 0.5) * 280;
      pos[i + 1] = Math.random() * 90;
      pos[i + 2] = (Math.random() - 0.5) * 280;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    var rmat = new THREE.PointsMaterial({ color: 0x8899ff, size: 0.1, transparent: true, opacity: 0.5 });
    rain = new THREE.Points(geo, rmat);
    scene.add(rain);
  }

  // ─── Situational cues (environmental, no floating orbs) ──
  // Pulsing red strobes register in `strobes[]` for animateMarkers to flicker.
  var strobes = [];
  function buildSituationalCues() {
    // ── Alarm box on 3rd-floor north wall (Science Lab, DP0 context) ──
    var alarmBox = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.15), mat(0xeeeeee));
    alarmBox.position.set(-12, FLOOR_H * 2 + 2.8, 7.88);
    scene.add(alarmBox);
    var alarmLight = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 1.0 }));
    alarmLight.position.set(-12, FLOOR_H * 2 + 2.85, 7.78);
    scene.add(alarmLight);
    strobes.push({ mesh: alarmLight, color: 0xff2020, base: 1.0, freq: 4.5 });
    var emLight = new THREE.PointLight(0xff3030, 0.7, 14);
    emLight.position.set(-12, FLOOR_H * 2 + 3.0, 5.0);
    scene.add(emLight);
    strobes.push({ light: emLight, base: 0.7, freq: 4.5 });

    // ── D2: Two large directional signs visible from the school exit ──
    // (just outside south door, at the first intersection z=-30)
    function roadSign(x, z, ry, label, bgColor) {
      var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4, 6), mat(0x444444));
      pole.position.set(x, 2, z);
      scene.add(pole);
      var board = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.4, 0.1), mat(bgColor));
      board.position.set(x, 3.5, z);
      board.rotation.y = ry;
      scene.add(board);
      // arrow strip
      var arrow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.35), mat(0xffffff));
      arrow.position.set(x + Math.sin(ry) * 0.06, 3.5, z + Math.cos(ry) * 0.06);
      arrow.rotation.y = ry;
      scene.add(arrow);
      addColl(x - 0.1, x + 0.1, z - 0.1, z + 0.1, 'lower');
      return { pole: pole, board: board, label: label };
    }
    // D2 signs at the z=-35 intersection — face NORTH so player approaching from the
    // school reads them head-on. Green east-evac sign on the right, red road-closed warning on the left.
    roadSign(5, -32, 0, 'EVAC ROUTE EAST →', 0x2a7a3a);
    roadSign(-5, -32, 0, '⚠ ROAD CLOSED ↓', 0x8a2a2a);

    // ── D3: Elderly neighbor lying on the east detour road at (34, -70) ──
    var body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.35, 0.5), mat(0xc4956c));
    body.position.set(34, 0.2, -70);
    scene.add(body);
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 10), mat(0xd8a880));
    head.position.set(33.45, 0.4, -70);
    scene.add(head);
    var hair = new THREE.Mesh(new THREE.SphereGeometry(0.29, 10, 10), mat(0xeeeeee));
    hair.position.set(33.45, 0.45, -70);
    hair.scale.set(1, 0.55, 1);
    scene.add(hair);
    var arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.7, 6), mat(0xc4956c));
    arm.position.set(34.1, 0.55, -70);
    arm.rotation.z = -0.6;
    scene.add(arm);
    var helpIcon = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 10), new THREE.MeshBasicMaterial({ color: 0xff4040, transparent: true, opacity: 1.0 }));
    helpIcon.position.set(34, 1.6, -70);
    scene.add(helpIcon);
    strobes.push({ mesh: helpIcon, color: 0xff4040, base: 1.0, freq: 3.0, baseY: 1.6 });
    var cane = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 6), mat(0x6a4a30));
    cane.position.set(34.6, 0.1, -70.4);
    cane.rotation.z = Math.PI / 2 - 0.3;
    scene.add(cane);

    // ── D4: Shelter-choice signs at the final junction (east-road meets shelter approach) ──
    // Placed north of the junction (z=-118), facing NORTH so they're readable from east-road descent.
    // Community Center ↑ (east, on the hill) — green sign
    var sgnA = new THREE.Group();
    var poleA = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 5, 6), mat(0x444444));
    poleA.position.set(37, 2.5, -118);
    sgnA.add(poleA);
    var boardA = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.0, 0.12), mat(0x227a44));
    boardA.position.set(37, 4.5, -118);
    sgnA.add(boardA);
    var arrA = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.5), mat(0xffffff));
    arrA.position.set(37, 4.5, -117.93);
    sgnA.add(arrA);
    scene.add(sgnA);
    addColl(36.9, 37.1, -118.1, -117.9, 'lower');
    // Convenience store warning — orange
    var sgnB = new THREE.Group();
    var poleB = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 5, 6), mat(0x444444));
    poleB.position.set(43, 2.5, -118);
    sgnB.add(poleB);
    var boardB = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.0, 0.12), mat(0x8a4a1a));
    boardB.position.set(43, 4.5, -118);
    sgnB.add(boardB);
    var arrB = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.5), mat(0xffffff));
    arrB.position.set(43, 4.5, -117.93);
    sgnB.add(arrB);
    scene.add(sgnB);
    addColl(42.9, 43.1, -118.1, -117.9, 'lower');

    // Subtle environmental cue: water seeping under lobby south wall (1F corridor near DP4)
    var puddle = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.8), mat(0x2a4a6a, { transparent: true, opacity: 0.55 }));
    puddle.rotation.x = -Math.PI / 2;
    puddle.position.set(0, 0.02, -2.5);
    scene.add(puddle);
  }

  // ─── Init ─────────────────────────────────────────────
  function init() {
    var container = document.getElementById('sim-container');

    // Renderer — perf-tuned: antialias off, pixelRatio capped at 1, shadows off
    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = false;
    renderer.xr.enabled = true;
    container.appendChild(renderer.domElement);
    addVRButton(renderer, container);

    // Scene + lights
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a1018);
    scene.fog = new THREE.FogExp2(0x0a1018, 0.011);

    ambientLight = new THREE.AmbientLight(0x334466, 0.55);
    scene.add(ambientLight);

    var dirLight = new THREE.DirectionalLight(0x6699cc, 0.75);
    dirLight.position.set(-50, 110, -40);
    scene.add(dirLight);

    // Per-floor interior lights are added inside buildSchool()

    lightningLight = new THREE.PointLight(0xffffff, 0, 900);
    lightningLight.position.set(0, 120, 0);
    scene.add(lightningLight);

    // Camera starts in Classroom A (2nd floor)
    camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 600);
    resetCamera();

    // Build world
    buildSchool();
    buildOutdoor();
    buildFloodWater();
    // buildRain();  // performance optimization: disabled cosmetic rain particles
    buildDecisionMarkers();

    // Controls
    controls = createPLC(camera, renderer.domElement);
    controls.syncRotation();

    // Auto-relock: any click on the sim container re-acquires pointer lock
    container.addEventListener('click', function () {
      if (state.running && !controls.isLocked) controls.lock();
    });

    // "Click to resume" overlay shown automatically when pointer escapes during a running sim
    var resumeOverlay = document.createElement('div');
    resumeOverlay.id = 'sim-resume-overlay';
    resumeOverlay.className = 'sim-resume-overlay hidden';
    resumeOverlay.innerHTML = '<div class="resume-card"><h2>⏸ Paused</h2><p>Click anywhere to resume the simulation</p></div>';
    container.appendChild(resumeOverlay);
    resumeOverlay.addEventListener('click', function () {
      if (state.running) controls.lock();
    });

    document.addEventListener('pointerlockchange', function () {
      var locked = document.pointerLockElement === renderer.domElement;
      if (!locked && state.running && !state.gameOver) {
        resumeOverlay.classList.remove('hidden');
      } else {
        resumeOverlay.classList.add('hidden');
      }
    });

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('resize', onResize);

    // Clock + animation
    clock = new THREE.Clock();
    renderer.setAnimationLoop(animate);

    document.getElementById('btn-start-sim').addEventListener('click', startSimulation);
    container.addEventListener('simulationComplete', function (e) { showResultUI(e.detail); });
  }

  function resetCamera() {
    playerFloor = 'lower';
    // Ground floor corridor, facing toward main lobby (south)
    camera.position.set(0, EYE_H, 3.0);
    camera.rotation.set(0, Math.PI, 0);
    camera.quaternion.setFromEuler(camera.rotation);
    if (controls) controls.syncRotation();
    velocity.x = 0; velocity.z = 0;
  }

  // ─── Keys ─────────────────────────────────────────────
  function onKeyDown(e) {
    switch (e.code) {
      case 'KeyW': case 'ArrowUp':         state.keys.w = true; break;
      case 'KeyA': case 'ArrowLeft':       state.keys.a = true; break;
      case 'KeyS': case 'ArrowDown':       state.keys.s = true; break;
      case 'KeyD': case 'ArrowRight':      state.keys.d = true; break;
      case 'ShiftLeft': case 'ShiftRight': state.keys.shift = true; break;
      case 'KeyR':
        // Only restart if we're actually in the simulation screen
        if (renderer && document.getElementById('screen-simulation').classList.contains('active')) {
          e.preventDefault();
          restart();
        }
        break;
    }
  }
  function onKeyUp(e) {
    switch (e.code) {
      case 'KeyW': case 'ArrowUp':         state.keys.w = false; break;
      case 'KeyA': case 'ArrowLeft':       state.keys.a = false; break;
      case 'KeyS': case 'ArrowDown':       state.keys.s = false; break;
      case 'KeyD': case 'ArrowRight':      state.keys.d = false; break;
      case 'ShiftLeft': case 'ShiftRight': state.keys.shift = false; break;
    }
  }

  // ─── Movement + Collision ─────────────────────────────
  function updateMovement(delta) {
    var fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    var rgt = new THREE.Vector3();
    rgt.crossVectors(fwd, new THREE.Vector3(0, 1, 0));

    // Desired direction (input) — normalized so diagonals don't move faster
    var ix = 0, iz = 0;
    if (state.keys.w) { ix += fwd.x; iz += fwd.z; }
    if (state.keys.s) { ix -= fwd.x; iz -= fwd.z; }
    if (state.keys.a) { ix -= rgt.x; iz -= rgt.z; }
    if (state.keys.d) { ix += rgt.x; iz += rgt.z; }
    var iLen = Math.sqrt(ix * ix + iz * iz);
    if (iLen > 0.0001) { ix /= iLen; iz /= iLen; }

    var maxSpeed = state.keys.shift ? MAX_SPEED * SPRINT_MULT : MAX_SPEED;
    if (state.penaltyTimer > 0) maxSpeed *= 0.67;
    if (state.onStairs) maxSpeed *= 0.6;

    // Apply input acceleration, then friction
    velocity.x += ix * ACCEL * delta;
    velocity.z += iz * ACCEL * delta;
    var fric = Math.max(0, 1 - FRICTION * delta);
    if (iLen < 0.0001) { velocity.x *= fric; velocity.z *= fric; }

    // Cap horizontal speed
    var spd = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
    if (spd > maxSpeed) { velocity.x = velocity.x / spd * maxSpeed; velocity.z = velocity.z / spd * maxSpeed; }
    if (spd < 0.02) { velocity.x = 0; velocity.z = 0; }

    var r = PLAYER_RADIUS;
    var dx = velocity.x * delta;
    var dz = velocity.z * delta;
    var px = camera.position.x, pz = camera.position.z;

    // X axis with wall sliding + step-up over small obstacles (curbs)
    var nxX = px + dx;
    if (!collides(nxX, pz, r)) {
      camera.position.x = nxX;
    } else {
      velocity.x *= 0.4;
    }

    var nzZ = pz + dz;
    if (!collides(camera.position.x, nzZ, r)) {
      camera.position.z = nzZ;
    } else {
      velocity.z *= 0.4;
    }

    // World bounds
    camera.position.x = Math.max(-180, Math.min(180, camera.position.x));
    camera.position.z = Math.max(-180, Math.min(60, camera.position.z));

    // Update floor and smooth Y
    updateFloorY(delta);
  }

  // ─── Simulation Logic ─────────────────────────────────
  function startSimulation() {
    document.getElementById('sim-start-overlay').classList.add('hidden');
    state.running = true;
    state.gameOver = false;
    state.simTime = 0;
    state.floodLevel = -3;
    state.score = 0;
    state.decisions = [];
    state.activeDecision = null;
    state.reachedShelter = false;

    DECISIONS.forEach(function (d) { d.triggered = false; d.resolved = false; d.openedAt = 0; });
    state.penaltyTimer = 0;
    hideDecisionHUD();

    resetCamera();
    updateHUD();
    controls.lock();
    clock.start();
  }

  function floorMatch(req) {
    return (req === playerFloor) ||
           (req === 'lower' && playerFloor === 'lower');
  }

  function checkDecisions() {
    DECISIONS.forEach(function (d) {
      if (d.resolved) return;
      if (!floorMatch(d.floorReq)) return;

      if (!d.triggered) {
        var tx = camera.position.x - d.triggerPos.x;
        var tz = camera.position.z - d.triggerPos.z;
        if (Math.sqrt(tx * tx + tz * tz) < d.triggerRadius) {
          d.triggered = true;
          d.openedAt = state.simTime;
          state.activeDecision = d;
          showDecisionHUD(d);
        }
        return;
      }

      d.options.forEach(function (opt, oi) {
        if (!floorMatch(d.floorReq)) return;
        var ox = camera.position.x - opt.zonePos.x;
        var oz = camera.position.z - opt.zonePos.z;
        if (Math.sqrt(ox * ox + oz * oz) < opt.zoneRadius) {
          resolveDecision(d, oi);
        }
      });
    });
  }

  function checkShelterReached() {
    if (state.reachedShelter || state.gameOver || playerFloor !== 'lower') return;
    var dx = camera.position.x - SHELTER.x;
    var dz = camera.position.z - SHELTER.z;
    if (Math.sqrt(dx * dx + dz * dz) < SHELTER.radius) {
      state.reachedShelter = true;
      endSimulation(true);
    }
  }

  function resolveDecision(d, optionIdx) {
    if (d.resolved) return;
    d.resolved = true;
    if (state.activeDecision === d) state.activeDecision = null;

    var opt = d.options[optionIdx];
    var pts = opt.points;

    state.decisions.push({
      question: d.question,
      choice: opt.text, correct: opt.correct,
      points: pts, feedback: opt.feedback,
      time: state.simTime, floodLevel: state.floodLevel
    });
    state.score += pts;

    if (!opt.correct) state.penaltyTimer = 15; // 15s speed reduction

    hideDecisionHUD();
    showFeedback(opt.correct, opt.feedback);
    updateHUD();
  }

  function endSimulation(survived) {
    if (state.gameOver) return;
    state.gameOver = true;
    state.running = false;
    controls.unlock();
    hideDecisionHUD();

    var result = {
      survived: survived,
      score: state.score,
      maxScore: DECISIONS.length * 25,
      decisions: state.decisions,
      duration: state.simTime,
      date: new Date().toISOString()
    };
    document.getElementById('sim-container').dispatchEvent(new CustomEvent('simulationComplete', { detail: result }));
  }

  // ─── Animation Loop ───────────────────────────────────
  function animate() {
    var delta = Math.min(clock.getDelta(), 0.05);

    // Always render (even before start, so scene is visible)
    if (state.running) {
      state.simTime += delta;

      if (state.penaltyTimer > 0) state.penaltyTimer = Math.max(0, state.penaltyTimer - delta);
      state.floodLevel = Math.min(state.floodLevel + delta * 0.09, 3.2);
      floodMesh.position.y = state.floodLevel;
      if (state.floodLevel > camera.position.y - 0.5) { endSimulation(false); return; }

      updateMovement(delta);
      checkDecisions();
      checkShelterReached();
      // animateRain(delta);  // performance optimization: disabled cosmetic rain animation
      animateMarkers(delta);
      animateDecisionMarkers();
      updateLightning(delta);
      updateHUD();
      updateCompass();
      updateFloodBar();
      updateFloorLabel();
    }

    renderer.render(scene, camera);
  }

  function animateRain(delta) {
    var pos = rain.geometry.attributes.position.array;
    for (var i = 1; i < pos.length; i += 3) {
      pos[i] -= 20 * delta;
      if (pos[i] < -2) pos[i] = 90;
    }
    rain.geometry.attributes.position.needsUpdate = true;
  }

  function animateMarkers(delta) {
    var t = state.simTime;
    strobes.forEach(function (s) {
      var pulse = 0.5 + 0.5 * Math.sin(t * s.freq);
      if (s.mesh) s.mesh.material.opacity = 0.4 + pulse * 0.6;
      if (s.light) s.light.intensity = s.base * (0.4 + pulse * 0.8);
      if (s.baseY != null) s.mesh.position.y = s.baseY + Math.sin(t * 2.5) * 0.18;
    });
    if (safeZoneRing) {
      safeZoneRing.material.opacity = 0.1 + Math.sin(t * 2) * 0.12;
    }
    if (beaconHalo) {
      beaconHalo.rotation.z = t * 0.8;
    }
  }

  function updateLightning(delta) {
    lightningTimer += delta;
    if (lightningTimer > 3 + Math.random() * 7) {
      lightningTimer = 0;
      lightningLight.intensity = 4;
      setTimeout(function () {
        lightningLight.intensity = 0;
        setTimeout(function () { lightningLight.intensity = 2.5; setTimeout(function () { lightningLight.intensity = 0; }, 70); }, 70);
      }, 100);
    }
  }

  // ─── HUD ──────────────────────────────────────────────
  function updateHUD() {
    var m = Math.floor(state.simTime / 60), s = Math.floor(state.simTime % 60);
    document.getElementById('hud-time').textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    var cm = Math.max(0, Math.round(state.floodLevel * 100));
    document.getElementById('hud-flood').textContent = cm >= 100 ? (cm / 100).toFixed(1) + ' m' : cm + ' cm';
    document.getElementById('hud-score').textContent = state.score;
    document.getElementById('hud-decisions').textContent = state.decisions.length + '/' + DECISIONS.length;
  }

  function updateFloodBar() {
    var pct = Math.max(0, Math.min(100, ((state.floodLevel + 3) / 6.2) * 100));
    document.getElementById('flood-bar-fill').style.height = pct + '%';
    var danger = document.getElementById('flood-bar-danger');
    danger.style.opacity = pct > 60 ? '1' : '0.3';
    if (pct > 60) document.getElementById('flood-bar-fill').style.background = 'linear-gradient(to top,#e74c3c,#c0392b)';
  }

  function updateFloorLabel() {
    var el = document.getElementById('floor-label');
    if (!el) return;
    el.textContent = '1st Floor';
  }

  function updateCompass() {
    var distEl = document.getElementById('compass-dist');
    var arrowEl = document.getElementById('compass-arrow');
    if (!distEl || !arrowEl) return;
    var sx = SHELTER.x, sz = SHELTER.z + 4;
    var dx = sx - camera.position.x, dz = sz - camera.position.z;
    distEl.textContent = Math.round(Math.sqrt(dx*dx+dz*dz)) + ' m away';
    var camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir); camDir.y = 0; camDir.normalize();
    var angle = Math.atan2(dx, dz) - Math.atan2(camDir.x, camDir.z);
    arrowEl.style.transform = 'rotate(' + (angle * 180 / Math.PI) + 'deg)';
  }

  // ─── Decision HUD (non-blocking — player keeps moving) ─
  function showDecisionHUD(d) {
    document.getElementById('decision-hud-question').textContent = d.question;
    document.getElementById('decision-hud-opt0').textContent = d.options[0].text;
    document.getElementById('decision-hud-opt1').textContent = d.options[1].text;
    document.getElementById('decision-hud').classList.remove('hidden');
  }

  function hideDecisionHUD() {
    document.getElementById('decision-hud').classList.add('hidden');
  }

  // ─── Decision 3D Markers ──────────────────────────────
  function buildDecisionMarkers() {
    var optColors = [0x00aaff, 0xff6600];

    DECISIONS.forEach(function (d, di) {
      // Trigger ring (pulsing yellow, always visible until resolved)
      var py = d.floorReq === 'top' ? FLOOR_H * 2 + 0.05 : d.floorReq === 'upper' ? FLOOR_H + 0.05 : 0.05;
      var ringGeo = new THREE.RingGeometry(d.triggerRadius - 0.35, d.triggerRadius, 36);
      var ringMat = new THREE.MeshBasicMaterial({ color: 0xffee22, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
      var ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(d.triggerPos.x, py, d.triggerPos.z);
      scene.add(ring);
      decisionTriggerMeshes.push(ring);

      // Option zone discs + vertical beacons (hidden until decision is triggered)
      var optMeshes = [];
      d.options.forEach(function (opt, oi) {
        var opy = d.floorReq === 'top' ? FLOOR_H * 2 + 0.04 : d.floorReq === 'upper' ? FLOOR_H + 0.04 : 0.04;
        var col = optColors[oi];

        var discGeo = new THREE.CylinderGeometry(opt.zoneRadius, opt.zoneRadius, 0.1, 32);
        var discMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.0 });
        var disc = new THREE.Mesh(discGeo, discMat);
        disc.position.set(opt.zonePos.x, opy, opt.zonePos.z);
        scene.add(disc);

        var bcGeo = new THREE.CylinderGeometry(0.12, 0.12, 5, 8);
        var bcMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.0 });
        var beacon = new THREE.Mesh(bcGeo, bcMat);
        beacon.position.set(opt.zonePos.x, opy + 2.5, opt.zonePos.z);
        scene.add(beacon);

        optMeshes.push({ disc: disc, beacon: beacon });
      });
      decisionOptionMeshes.push(optMeshes);
    });
  }

  function animateDecisionMarkers() {
    var t = state.simTime;
    DECISIONS.forEach(function (d, di) {
      var ring = decisionTriggerMeshes[di];
      if (ring) {
        if (d.resolved || d.triggered) {
          ring.material.opacity = 0;
        } else {
          ring.material.opacity = 0.3 + 0.25 * Math.sin(t * 2.8);
        }
      }

      var optMeshes = decisionOptionMeshes[di];
      if (!optMeshes) return;
      optMeshes.forEach(function (m, oi) {
        if (d.triggered && !d.resolved) {
          var pulse = 0.4 + 0.25 * Math.sin(t * 3.5 + oi * Math.PI);
          m.disc.material.opacity = pulse;
          m.beacon.material.opacity = pulse * 0.8;
        } else {
          m.disc.material.opacity = 0;
          m.beacon.material.opacity = 0;
        }
      });
    });
  }

  function showFeedback(correct, text) {
    var el = document.getElementById('sim-feedback');
    document.getElementById('feedback-icon').textContent = correct ? '✅' : '❌';
    document.getElementById('feedback-text').textContent = text;
    el.className = 'sim-feedback ' + (correct ? 'correct' : 'wrong');
    el.classList.remove('hidden');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.add('hidden'); }, 3500);
  }

  // ─── Result UI ────────────────────────────────────────
  function showResultUI(result) {
    var pct = Math.round((result.score / result.maxScore) * 100);
    if (!result.survived) {
      document.getElementById('result-icon').textContent = '💀';
      document.getElementById('result-title').textContent = 'Drowned! Move faster next time.';
    } else {
      document.getElementById('result-icon').textContent = pct >= 75 ? '🏆' : pct >= 50 ? '⚠️' : '❌';
      document.getElementById('result-title').textContent =
        pct >= 75 ? 'Excellent! You Survived!' : pct >= 50 ? 'Survived — Needs Improvement' : 'Barely Made It';
    }
    document.getElementById('result-score').textContent = result.score + ' / ' + result.maxScore;

    var listEl = document.getElementById('result-decisions-list');
    listEl.innerHTML = '';
    if (result.decisions.length === 0) {
      listEl.innerHTML = '<p style="color:#8b949e;font-size:13px">No decisions encountered — explore the environment, react to alarms, road signs, and people in distress.</p>';
    }
    result.decisions.forEach(function (d) {
      var item = document.createElement('div');
      item.className = 'result-decision-item ' + (d.correct ? 'correct' : 'wrong');
      item.innerHTML = '<span>' + (d.correct ? '✅' : '❌') + '</span>' +
        '<div><strong>' + d.choice + '</strong><br><small style="color:#8b949e">' + d.feedback + '</small></div>' +
        '<span style="margin-left:auto;font-weight:800;color:' + (d.correct ? '#27ae60' : '#e74c3c') + '">+' + d.points + '</span>';
      listEl.appendChild(item);
    });

    document.getElementById('sim-result-overlay').classList.remove('hidden');
    if (window.App) App.saveSession(result);

    // Auto-restart countdown
    startAutoRestart(10);
  }

  // ─── Auto-restart ─────────────────────────────────────
  var _autoRestartTimer = null;
  function startAutoRestart(seconds) {
    cancelAutoRestart();
    var secEl = document.getElementById('result-autorestart-sec');
    var wrapEl = document.getElementById('result-autorestart');
    if (wrapEl) wrapEl.style.display = 'block';
    var remaining = seconds;
    if (secEl) secEl.textContent = remaining;
    _autoRestartTimer = setInterval(function () {
      remaining -= 1;
      if (secEl) secEl.textContent = remaining;
      if (remaining <= 0) {
        cancelAutoRestart();
        restart();
      }
    }, 1000);
  }
  function cancelAutoRestart() {
    if (_autoRestartTimer) { clearInterval(_autoRestartTimer); _autoRestartTimer = null; }
    var wrapEl = document.getElementById('result-autorestart');
    if (wrapEl) wrapEl.style.display = 'none';
  }

  // ─── Resize ───────────────────────────────────────────
  function onResize() {
    var c = document.getElementById('sim-container');
    if (!c || !renderer) return;
    camera.aspect = c.clientWidth / c.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(c.clientWidth, c.clientHeight);
  }

  // ─── Public API ───────────────────────────────────────
  function restart() {
    cancelAutoRestart();
    document.getElementById('sim-result-overlay').classList.add('hidden');
    document.getElementById('sim-feedback').classList.add('hidden');
    hideDecisionHUD();
    state.gameOver = false;
    startSimulation();
  }

  return {
    init: function () { if (!renderer) init(); },
    restart: restart,
    cancelAutoRestart: cancelAutoRestart,
    getState: function () { return state; }
  };

})();
