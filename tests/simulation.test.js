// Headless tests for the simulation. Run with: node tests/simulation.test.js
// Pulls every @sim-begin ... @sim-end block out of index.html and runs it with no DOM.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const code = [...html.matchAll(/\/\/ @sim-begin([\s\S]*?)\/\/ @sim-end/g)].map(m => m[1]).join('\n');
const sim = new Function(code + '\nreturn { CONFIG, DEFAULT_CONFIG, CONFIG_META, PRESETS, createGameState, step, CIRCUIT, createCircuit, circuitQuery, SKID_LIFE, SKID_MAX, currentLapTime, createRecords, parseRecords };')();

const DT = 1 / 60;
const idle = { gas: false, brake: false, left: false, right: false, handbrake: false };

// Physics tests run on open ground: a circuit so large the car never meets a Wall.
const OPEN_GROUND = sim.createCircuit(
  Array.from({ length: 12 }, (_, i) => ({ x: 1e6 * Math.cos(i / 12 * 2 * Math.PI), y: 1e6 * Math.sin(i / 12 * 2 * Math.PI) })),
  1e5, 1e5, 4);
function fresh(overrides = {}, onRealCircuit = false) {
  const config = { ...sim.CONFIG, ...overrides };
  const state = sim.createGameState(config);
  if (!onRealCircuit) {
    state.circuit = OPEN_GROUND;
    state.car.x = OPEN_GROUND.start.x; state.car.y = OPEN_GROUND.start.y;
    state.car.heading = Math.atan2(OPEN_GROUND.start.ty, OPEN_GROUND.start.tx);
    state.lap.lastX = state.car.x; state.lap.lastY = state.car.y;
  }
  return { config, state };
}
function run(state, config, inp, seconds, dt = DT) {
  for (let t = 0; t < seconds - 1e-9; t += dt) sim.step(state, inp, dt, config);
}
// Forward and sideways speed relative to where the car points.
function localSpeeds(car) {
  const c = Math.cos(car.heading), s = Math.sin(car.heading);
  return { fwd: car.vx * c + car.vy * s, lat: -car.vx * s + car.vy * c };
}

const tests = {
  'a hard turn at speed makes the car travel in a different direction from where it points'() {
    const { config, state } = fresh();
    run(state, config, { ...idle, gas: true }, 5);
    run(state, config, { ...idle, gas: true, left: true }, 0.5);
    const car = state.car;
    const gap = Math.abs(Math.atan2(car.vy, car.vx) - car.heading) * 180 / Math.PI;
    assert(gap > 8, 'expected a visible slide angle, got ' + gap.toFixed(1) + ' degrees');
    assert(Math.hypot(car.vx, car.vy) > config.maxSpeed * 0.5, 'a slide should not scrub off most of the speed');
  },
  'driving straight has no slide'() {
    const { config, state } = fresh();
    run(state, config, { ...idle, gas: true }, 5);
    const car = state.car;
    assert(Math.abs(localSpeeds(car).lat) < 1);
  },
  'gas accelerates forward and never exceeds maxSpeed'() {
    const { config, state } = fresh();
    run(state, config, { ...idle, gas: true }, 10);
    const { fwd } = localSpeeds(state.car);
    assert(fwd > config.maxSpeed * 0.8, 'should reach most of top speed');
    assert(fwd <= config.maxSpeed + 1, 'must not exceed maxSpeed');
  },
  'top speed is the lower of maxSpeed and what drag allows (about acceleration / friction)'() {
    const topSpeed = overrides => {
      const { config, state } = fresh(overrides);
      let best = 0;
      for (let t = 0; t < 25; t += DT) { sim.step(state, { ...idle, gas: true }, DT, config); best = Math.max(best, Math.hypot(state.car.vx, state.car.vy)); }
      return best;
    };
    assert(Math.abs(topSpeed({ maxSpeed: 300 }) - 300) < 10, 'a low maxSpeed is the limit');
    const dragLimit = sim.CONFIG.acceleration / sim.CONFIG.friction;
    assert(Math.abs(topSpeed({ maxSpeed: 1200 }) - dragLimit) < 10, 'a very high maxSpeed is limited by drag');
    assert(topSpeed({ maxSpeed: 1200, acceleration: 1000 }) > dragLimit * 1.4, 'more acceleration lifts that limit');
  },
  'car cannot turn while stationary'() {
    const { config, state } = fresh();
    const before = state.car.heading;
    run(state, config, { ...idle, left: true }, 1);
    assert.strictEqual(state.car.heading, before);
  },
  'brake slows the car and then reverses it'() {
    const { config, state } = fresh();
    run(state, config, { ...idle, gas: true }, 3);
    run(state, config, { ...idle, brake: true }, 1.5);
    assert(localSpeeds(state.car).fwd < 0 || Math.hypot(state.car.vx, state.car.vy) < 5, 'should have stopped or be reversing');
    run(state, config, { ...idle, brake: true }, 3);
    assert(localSpeeds(state.car).fwd < -50, 'should be reversing');
  },
  'handbrake lets the rear slide (more sideways speed than without)'() {
    const slide = lat => {
      // High maxSpeed keeps the speed share low, so steering alone does not cut grip.
      const { config, state } = fresh({ maxSpeed: 3000 });
      run(state, config, { ...idle, gas: true }, 3);
      run(state, config, { ...idle, gas: true, left: true, handbrake: lat }, 0.5);
      return Math.abs(localSpeeds(state.car).lat);
    };
    assert(slide(true) > slide(false) * 2, 'handbrake should leave far more sideways speed');
  },
  'grip recovers slowly, not instantly, after the handbrake is released'() {
    const { config, state } = fresh();
    run(state, config, { ...idle, gas: true }, 4);
    run(state, config, { ...idle, gas: true, handbrake: true }, 0.5);
    const low = state.car.grip;
    run(state, config, { ...idle, gas: true }, 0.2);
    assert(state.car.grip > low, 'grip should start recovering');
    assert(state.car.grip < config.normalGrip - 1, 'grip should not have snapped back');
    run(state, config, { ...idle, gas: true }, 5);
    assert.strictEqual(state.car.grip, config.normalGrip);
  },
  'lower driftGrip gives a bigger slide when steering hard at speed'() {
    const slide = driftGrip => {
      const { config, state } = fresh({ driftGrip });
      run(state, config, { ...idle, gas: true }, 5);
      run(state, config, { ...idle, gas: true, left: true }, 0.7);
      return Math.abs(localSpeeds(state.car).lat);
    };
    assert(slide(0.5) > slide(9) * 2);
  },
  'changing CONFIG takes effect on the very next step'() {
    const a = fresh(), b = fresh();
    run(a.state, a.config, { ...idle, gas: true }, 0.5);
    run(b.state, b.config, { ...idle, gas: true }, 0.5);
    b.config.acceleration *= 2;
    run(a.state, a.config, { ...idle, gas: true }, 0.3);
    run(b.state, b.config, { ...idle, gas: true }, 0.3);
    assert(localSpeeds(b.state.car).fwd > localSpeeds(a.state.car).fwd * 1.2);
  },
  'speed is the same at 60Hz and 144Hz'() {
    const run1 = dt => {
      const { config, state } = fresh();
      run(state, config, { ...idle, gas: true }, 2, dt);
      run(state, config, { ...idle, gas: true, right: true }, 1, dt);
      return state.car;
    };
    const a = run1(1 / 60), b = run1(1 / 144);
    assert(Math.abs(Math.hypot(a.vx, a.vy) - Math.hypot(b.vx, b.vy)) < 15, 'speeds should match');
    assert(Math.hypot(a.x - b.x, a.y - b.y) < 40, 'positions should match');
  }
};

// ---- Circuit, Walls and grass -------------------------------------------
// Put the car on the centreline at sample `i`, offset sideways by `offset`, with given local velocity.
function placeOnCircuit(state, i, offset, headingRelative, fwd, lat = 0) {
  const c = sim.CIRCUIT, p = c.pts[i], q = c.pts[(i + 1) % c.pts.length];
  const tx = q.x - p.x, ty = q.y - p.y, len = Math.hypot(tx, ty);
  const ux = tx / len, uy = ty / len;           // along the road
  const nx = -uy, ny = ux;                      // sideways (left of travel)
  const car = state.car;
  car.x = p.x + nx * offset; car.y = p.y + ny * offset;
  car.heading = Math.atan2(uy, ux) + headingRelative;
  const hx = Math.cos(car.heading), hy = Math.sin(car.heading);
  car.vx = hx * fwd - hy * lat; car.vy = hy * fwd + hx * lat;
  car.grip = state.config ? state.config.normalGrip : sim.CONFIG.normalGrip;
  return { nx, ny, ux, uy };
}
const dist = car => sim.circuitQuery(sim.CIRCUIT, car.x, car.y).dist;
const wallLimit = () => sim.CIRCUIT.halfWall;

Object.assign(tests, {
  'the circuit is a closed loop wide enough that its walls never overlap or pinch'() {
    const pts = sim.CIRCUIT.pts, n = pts.length, outer = sim.CIRCUIT.halfWall + 10;
    for (let i = 0; i < n; i++) {                       // no corner tighter than the wall radius
      const a = pts[i], b = pts[(i + 1) % n], c = pts[(i + 2) % n];
      const ab = Math.hypot(b.x - a.x, b.y - a.y), bc = Math.hypot(c.x - b.x, c.y - b.y), ca = Math.hypot(a.x - c.x, a.y - c.y);
      const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
      const radius = area2 < 1e-9 ? Infinity : (ab * bc * ca) / (2 * area2);
      assert(radius >= outer, `corner ${i} radius ${radius.toFixed(0)} < ${outer}`);
    }
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {   // separate stretches stay apart
      if (Math.min(j - i, n - (j - i)) < 24) continue;
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      assert(d >= 2 * outer, `stretches ${i} and ${j} only ${d.toFixed(0)} apart`);
    }
  },
  'the car spawns on the road, behind the start line, facing forward'() {
    const { state } = fresh({}, true), car = state.car, c = sim.CIRCUIT;
    assert(sim.circuitQuery(c, car.x, car.y).dist < c.halfRoad * 0.2, 'should start near the centreline');
    const ahead = (c.start.x - car.x) * c.start.tx + (c.start.y - car.y) * c.start.ty;
    assert(ahead > 20, 'start line should be ahead of the car');
    assert(Math.cos(car.heading) * c.start.tx + Math.sin(car.heading) * c.start.ty > 0.99, 'should face along the road');
  },
  'on the road the surface is road and on the verge it is grass'() {
    const { config, state } = fresh({}, true);
    sim.step(state, idle, DT, config);
    assert.strictEqual(state.car.surface, 'road');
    placeOnCircuit(state, 5, sim.CIRCUIT.halfRoad + 20, 0, 0);
    sim.step(state, idle, DT, config);
    assert.strictEqual(state.car.surface, 'grass');
  },
  'grass slows the car more than road, and grassDrag controls how much'() {
    const coast = (offset, grassDrag) => {
      const { config, state } = fresh({ grassDrag }, true);
      placeOnCircuit(state, 5, offset, 0, 300);
      run(state, config, idle, 0.4);
      return localSpeeds(state.car).fwd;
    };
    const road = coast(0, 2), grass = coast(sim.CIRCUIT.halfRoad + 15, 2);
    assert(grass < road * 0.8, 'grass should slow the car');
    assert(coast(sim.CIRCUIT.halfRoad + 15, 0) > coast(sim.CIRCUIT.halfRoad + 15, 4), 'bigger grassDrag, slower car');
  },
  'a low-speed wall hit is a Scrape: it slows the car but is not a Crash'() {
    const { config, state } = fresh({}, true);
    placeOnCircuit(state, 20, wallLimit() - 40, Math.PI / 2, 120);
    run(state, config, idle, 1);
    assert.strictEqual(state.lastImpact.type, 'scrape');
    assert.strictEqual(state.crashCount, 0);
  },
  'a hard head-on wall hit above crashSpeed is a Crash'() {
    const { config, state } = fresh({}, true);
    placeOnCircuit(state, 20, wallLimit() - 60, Math.PI / 2, config.crashSpeed + 150);
    run(state, config, idle, 0.5);
    assert.strictEqual(state.lastImpact.type, 'crash');
    assert.strictEqual(state.crashCount, 1);
  },
  'a fast glancing hit is a Scrape because the impact along the wall normal is small'() {
    const { config, state } = fresh({}, true);
    // Aimed a few degrees at the wall: about 500 along it, about 100 into it.
    placeOnCircuit(state, 20, wallLimit() - 30, Math.atan2(100, 500), Math.hypot(500, 100));
    run(state, config, idle, 0.5);
    assert.strictEqual(state.crashCount, 0);
    assert.strictEqual(state.lastImpact.type, 'scrape');
  },
  'both a Scrape and a Crash slow the car'() {
    for (const inward of [120, 500]) {
      const { config, state } = fresh({}, true);
      placeOnCircuit(state, 20, wallLimit() - 30, Math.atan2(inward, 400), Math.hypot(400, inward));
      const car = state.car, before = Math.hypot(car.vx, car.vy);
      run(state, config, idle, 0.6);
      assert(Math.hypot(car.vx, car.vy) < before * 0.8, `inward ${inward} should have slowed the car`);
    }
  },
  'the car can never leave the Circuit through a Wall'() {
    const { config, state } = fresh({}, true);
    placeOnCircuit(state, 40, 0, Math.PI / 2, 0);
    let worst = 0;
    for (let t = 0; t < 8; t += DT) {
      sim.step(state, { ...idle, gas: true }, DT, config);
      worst = Math.max(worst, dist(state.car));
    }
    assert(worst <= wallLimit(), `car reached ${worst.toFixed(1)} from the centreline, wall is at ${wallLimit()}`);
    assert(state.lastImpact, 'should have hit the wall');
  },
  'a gentle graze is not recorded, and a Crash right after a Scrape still counts'() {
    const { config, state } = fresh({}, true);
    placeOnCircuit(state, 20, wallLimit() - 40, Math.atan2(20, 300), Math.hypot(300, 20));
    run(state, config, idle, 0.4);
    assert.strictEqual(state.lastImpact, null, 'a 20 px/s touch should not register');
    placeOnCircuit(state, 20, wallLimit() - 40, Math.PI / 2, 120);
    run(state, config, idle, 0.4);
    assert.strictEqual(state.lastImpact.type, 'scrape');
    placeOnCircuit(state, 20, wallLimit() - 25, Math.PI / 2, config.crashSpeed + 150);
    run(state, config, idle, 0.15);
    assert.strictEqual(state.crashCount, 1, 'a hard hit straight after a Scrape must be a Crash');
  },
  'a Crash is only counted once per impact, not every frame'() {
    const { config, state } = fresh({}, true);
    placeOnCircuit(state, 20, wallLimit() - 60, Math.PI / 2, config.crashSpeed + 150);
    run(state, config, { ...idle, gas: true }, 3);
    assert.strictEqual(state.crashCount, 1);
  }
});

// ---- Tuning Panel data ----------------------------------------------------
Object.assign(tests, {
  'every CONFIG value has a slider definition with a sensible range, and nothing else does'() {
    const keys = Object.keys(sim.CONFIG).sort(), meta = Object.keys(sim.CONFIG_META).sort();
    assert.deepStrictEqual(meta, keys);
    for (const k of keys) {
      const m = sim.CONFIG_META[k];
      assert(['Speed', 'Steering', 'Grip', 'Drift Score'].includes(m.group), k + ' has an unknown group');
      assert(m.min < m.max && m.step > 0, k + ' has a bad range');
      assert(sim.DEFAULT_CONFIG[k] >= m.min && sim.DEFAULT_CONFIG[k] <= m.max, k + ' default is outside its slider range');
    }
  },
  'DEFAULT_CONFIG is a frozen copy of the starting CONFIG'() {
    assert(Object.isFrozen(sim.DEFAULT_CONFIG));
    assert.deepStrictEqual({ ...sim.DEFAULT_CONFIG }, { ...sim.CONFIG });
  },
  'the three presets exist and only set known values inside their slider ranges'() {
    assert.deepStrictEqual(Object.keys(sim.PRESETS).sort(), ['Arcade', 'Realistic', 'Sideways Mode']);
    for (const [name, values] of Object.entries(sim.PRESETS)) {
      for (const [k, v] of Object.entries(values)) {
        const m = sim.CONFIG_META[k];
        assert(m, name + ' sets unknown value ' + k);
        assert(v >= m.min && v <= m.max, `${name}.${k}=${v} is outside its slider range`);
      }
    }
  },
  'presets rank by sideways grip: Sideways Mode slidiest, Realistic grippiest'() {
    const g = n => ({ ...sim.DEFAULT_CONFIG, ...sim.PRESETS[n] }).driftGrip;
    assert(g('Sideways Mode') < g('Arcade') && g('Arcade') < g('Realistic'));
  }
});

// ---- Drift detection, smoke and skid marks --------------------------------
// Give the car a speed and a slip angle (degrees between where it points and where it travels), then take one tiny step.
function setSlip(state, config, speed, slipDeg, dt = 1 / 240) {
  const car = state.car, a = car.heading + slipDeg * Math.PI / 180;
  car.vx = Math.cos(a) * speed; car.vy = Math.sin(a) * speed;
  sim.step(state, idle, dt, config);
}

Object.assign(tests, {
  'a Drift starts above driftEnterAngle at or above minDriftSpeed'() {
    const { config, state } = fresh();
    setSlip(state, config, 400, config.driftEnterAngle + 8);
    assert.strictEqual(state.car.drifting, true);
  },
  'no Drift below minDriftSpeed, however sideways the car is'() {
    const { config, state } = fresh();
    setSlip(state, config, config.minDriftSpeed * 0.5, 40);
    assert.strictEqual(state.car.drifting, false);
  },
  'no Drift at a small slip angle'() {
    const { config, state } = fresh();
    setSlip(state, config, 400, config.driftExitAngle * 0.4);
    assert.strictEqual(state.car.drifting, false);
  },
  'a Drift ends below driftExitAngle'() {
    const { config, state } = fresh();
    setSlip(state, config, 400, config.driftEnterAngle + 10);
    assert.strictEqual(state.car.drifting, true);
    setSlip(state, config, 400, config.driftExitAngle * 0.4);
    assert.strictEqual(state.car.drifting, false);
  },
  'between the two angles the Drift flag holds its state (hysteresis, no flicker)'() {
    const mid = c => (c.driftEnterAngle + c.driftExitAngle) / 2;
    for (const startDrifting of [true, false]) {
      const { config, state } = fresh();
      setSlip(state, config, 400, startDrifting ? config.driftEnterAngle + 10 : 0);
      assert.strictEqual(state.car.drifting, startDrifting);
      let flips = 0, last = state.car.drifting;
      for (let i = 0; i < 100; i++) {
        setSlip(state, config, 400, mid(config) + (i % 2 ? 1 : -1));
        if (state.car.drifting !== last) { flips++; last = state.car.drifting; }
      }
      assert.strictEqual(flips, 0, `flag flickered (started ${startDrifting})`);
      assert.strictEqual(state.car.drifting, startDrifting);
    }
  },
  'a Drift also ends when the car has nearly stopped'() {
    const { config, state } = fresh();
    setSlip(state, config, 400, config.driftEnterAngle + 10);
    setSlip(state, config, config.minDriftSpeed * 0.2, config.driftEnterAngle + 10);
    assert.strictEqual(state.car.drifting, false);
  },
  'an exit angle set above the enter angle cannot trap the car in a Drift'() {
    const { config, state } = fresh({ driftEnterAngle: 12, driftExitAngle: 30 });
    setSlip(state, config, 400, 20);
    assert.strictEqual(state.car.drifting, true);
    setSlip(state, config, 400, 4);
    assert.strictEqual(state.car.drifting, false);
  },
  'lower driftGrip produces a Drift where normalGrip does not'() {
    const everDrifts = driftGrip => {
      const { config, state } = fresh({ driftGrip });
      run(state, config, { ...idle, gas: true }, 5);
      let drifted = false;
      for (let t = 0; t < 2; t += DT) {
        sim.step(state, { ...idle, gas: true, left: true }, DT, config);
        drifted = drifted || state.car.drifting;
      }
      return drifted;
    };
    assert.strictEqual(everDrifts(sim.CONFIG.normalGrip), false, 'driftGrip equal to normalGrip should not drift');
    assert.strictEqual(everDrifts(1.5), true, 'a slidier driftGrip should drift');
  },
  'driving straight never Drifts and makes no smoke or skid marks'() {
    const { config, state } = fresh();
    run(state, config, { ...idle, gas: true }, 5);
    assert.strictEqual(state.car.drifting, false);
    assert.strictEqual(state.effects.smoke.length, 0);
    assert.strictEqual(state.effects.skids.length, 0);
  },
  'smoke and skid marks appear while Drifting'() {
    const { config, state } = fresh();
    for (let i = 0; i < 30; i++) setSlip(state, config, 400, 30, DT);
    assert(state.car.drifting);
    assert(state.effects.smoke.length > 5, 'expected smoke');
    assert(state.effects.skids.length > 5, 'expected skid marks');
  },
  'smoke dies away once the Drift ends, but skid marks stay and then fade slowly'() {
    const { config, state } = fresh();
    for (let i = 0; i < 30; i++) setSlip(state, config, 400, 30, DT);
    const marks = state.effects.skids.length;
    state.car.vx = state.car.vy = 0;
    run(state, config, idle, 2);
    assert.strictEqual(state.car.drifting, false);
    assert.strictEqual(state.effects.smoke.length, 0, 'smoke should be gone');
    assert.strictEqual(state.effects.skids.length, marks, 'skid marks should still be there');
    run(state, config, idle, sim.SKID_LIFE + 2);
    assert.strictEqual(state.effects.skids.length, 0, 'skid marks should have faded away');
  },
  'skid marks are capped so a long Drift cannot grow without limit'() {
    const { config, state } = fresh();
    for (let i = 0; i < 60 * 40; i++) setSlip(state, config, 400, 30, DT);
    assert(state.effects.skids.length <= sim.SKID_MAX);
    assert(state.effects.skids.length > 100);
  }
});

// ---- Drift scoring ---------------------------------------------------------
// Hold a Drift for `seconds` (slip set every step), then return the scoring state.
function driftFor(state, config, seconds, dt = DT) {
  for (let t = 0; t < seconds - 1e-9; t += dt) setSlip(state, config, 400, 30, dt);
}
function coastFor(state, config, seconds) {   // stop drifting and wait
  state.car.vx = state.car.vy = 0;
  run(state, config, idle, seconds);
}

Object.assign(tests, {
  'pending points rise during a Drift, at driftScoreRate with a multiplier of 1 at first'() {
    const { config, state } = fresh();
    driftFor(state, config, 1);
    const sc = state.scoring;
    assert(Math.abs(sc.pending - config.driftScoreRate) < 1.5, 'pending was ' + sc.pending);
    assert.strictEqual(sc.multiplier, 1);
    assert.strictEqual(sc.total, 0, 'nothing is banked while the chain runs');
  },
  'the Combo Multiplier grows with the length of the Drift Chain'() {
    const { config, state } = fresh();
    driftFor(state, config, config.comboStepTime * 0.5);
    assert.strictEqual(state.scoring.multiplier, 1);
    driftFor(state, config, config.comboStepTime * 0.6);
    assert.strictEqual(state.scoring.multiplier, 2);
    driftFor(state, config, config.comboStepTime * 1);
    assert.strictEqual(state.scoring.multiplier, 3);
  },
  'a longer chain earns more per second than a short one'() {
    const { config, state } = fresh();
    driftFor(state, config, 1);
    const first = state.scoring.pending;
    driftFor(state, config, config.comboStepTime * 2);   // now into a higher multiplier
    const later = state.scoring.pending;
    driftFor(state, config, 1);
    assert((state.scoring.pending - later) > first * 1.5, 'a second at a higher multiplier should score more');
  },
  'not drifting for comboTimeout banks the pending points and resets the multiplier'() {
    const { config, state } = fresh();
    driftFor(state, config, config.comboStepTime * 1.5);
    const earned = state.scoring.pending;
    assert(earned > 0 && state.scoring.multiplier === 2);
    coastFor(state, config, config.comboTimeout * 0.5);
    assert.strictEqual(state.scoring.total, 0, 'not banked before the timeout');
    assert(state.scoring.pending > 0);
    coastFor(state, config, config.comboTimeout);
    assert(Math.abs(state.scoring.total - earned) < 1e-6, 'pending should be banked in full');
    assert.strictEqual(state.scoring.pending, 0);
    assert.strictEqual(state.scoring.multiplier, 1);
  },
  'drifting again before the timeout continues the same chain'() {
    const { config, state } = fresh();
    driftFor(state, config, 1);
    const before = state.scoring.pending;
    coastFor(state, config, config.comboTimeout * 0.5);
    driftFor(state, config, 0.5);
    assert(state.scoring.pending > before, 'the same chain should keep growing');
    assert.strictEqual(state.scoring.total, 0);
  },
  'best chain is the biggest single banked chain'() {
    const { config, state } = fresh();
    driftFor(state, config, 2); coastFor(state, config, config.comboTimeout + 0.2);
    const first = state.scoring.total;
    driftFor(state, config, 0.5); coastFor(state, config, config.comboTimeout + 0.2);
    driftFor(state, config, 4); coastFor(state, config, config.comboTimeout + 0.2);
    const sc = state.scoring;
    assert(sc.bestChain > first, 'the longest chain should be the best');
    assert(sc.total > sc.bestChain, 'total adds up all the chains');
  },
  'a Crash loses the pending points'() {
    const { config, state } = fresh();
    driftFor(state, config, 1);
    assert(state.scoring.pending > 5);
    state.circuit = sim.CIRCUIT;   // now meet a real Wall
    placeOnCircuit(state, 20, wallLimit() - 40, Math.PI / 2, config.crashSpeed + 150);
    run(state, config, idle, 0.4);
    assert.strictEqual(state.crashCount, 1);
    assert.strictEqual(state.scoring.pending, 0);
    assert.strictEqual(state.scoring.total, 0, 'a lost chain is not banked');
    assert.strictEqual(state.scoring.multiplier, 1);
  },
  'a Crash deep into a long chain loses it all, and the multiplier starts again at 1'() {
    const { config, state } = fresh();
    driftFor(state, config, 3);
    assert(state.scoring.multiplier >= 2, 'the chain should have built a multiplier');
    state.circuit = sim.CIRCUIT;
    placeOnCircuit(state, 20, wallLimit() - 40, Math.PI / 2, config.crashSpeed + 150);
    run(state, config, idle, 0.3);
    assert.strictEqual(state.crashCount, 1);
    assert.strictEqual(state.scoring.total, 0, 'the lost chain is not banked');
    assert.strictEqual(state.scoring.pending, 0);
    assert.strictEqual(state.scoring.multiplier, 1);
    assert.strictEqual(state.scoring.bestChain, 0, 'a lost chain is not a best chain');
  },
  'a Scrape keeps the chain alive'() {
    const { config, state } = fresh();
    driftFor(state, config, 1);
    const pending = state.scoring.pending;
    state.circuit = sim.CIRCUIT;   // now meet a real Wall
    placeOnCircuit(state, 20, wallLimit() - 40, Math.PI / 2, 120);
    run(state, config, idle, 0.4);
    assert.strictEqual(state.lastImpact.type, 'scrape');
    assert.strictEqual(state.crashCount, 0);
    assert(state.scoring.pending >= pending, 'a Scrape must not cost points');
  },
  'driftScoreRate and comboTimeout take effect live'() {
    const earn = rate => { const { config, state } = fresh({ driftScoreRate: rate }); driftFor(state, config, 1); return state.scoring.pending; };
    assert(Math.abs(earn(40) / earn(20) - 2) < 0.1);
    const { config, state } = fresh({ comboTimeout: 0.3 });
    driftFor(state, config, 1); coastFor(state, config, 0.5);
    assert(state.scoring.total > 0, 'a shorter comboTimeout should have banked already');
  },
  'the new scoring value has a slider definition'() {
    assert(sim.CONFIG_META.comboStepTime && sim.CONFIG_META.comboStepTime.group === 'Drift Score');
  }
});

// ---- Checkpoints and Laps ---------------------------------------------------
const N = () => sim.CIRCUIT.pts.length;
const centre = (i, offset = 0) => {
  const c = sim.CIRCUIT, n = N(), p = c.pts[((i % n) + n) % n], q = c.pts[(((i + 1) % n) + n) % n];
  const len = Math.hypot(q.x - p.x, q.y - p.y);
  return { x: p.x - (q.y - p.y) / len * offset, y: p.y + (q.x - p.x) / len * offset };
};
// Move the car through the given points one step at a time (so crossings are seen), `dt` seconds apart.
function walk(state, config, points, dt = DT) {
  for (const p of points) { state.car.x = p.x; state.car.y = p.y; state.car.vx = state.car.vy = 0; sim.step(state, idle, dt, config); }
}
const indices = (from, to) => { const out = []; if (from <= to) for (let i = from; i <= to; i++) out.push(i); else for (let i = from; i >= to; i--) out.push(i); return out; };
const along = (from, to, offset = 0) => indices(from, to).map(i => centre(i, offset));
const spawnPoint = () => { const s = sim.CIRCUIT.start; return { x: s.x - s.tx * 80, y: s.y - s.ty * 80 }; };
// A full forward Lap starting just before the line: spawn, then every sample, then back over the line.
const fullLap = (offset = 0) => [...along(0, N() - 1, offset), ...along(N(), N() + 2, offset)];

Object.assign(tests, {
  'the Circuit has ordered Checkpoints spread around the Circuit, away from the start line'() {
    const cps = sim.CIRCUIT.checkpoints;
    assert(cps.length >= 4, 'expected several Checkpoints');
    const gaps = cps.map((c, i) => Math.hypot(c.x - (cps[i + 1] || sim.CIRCUIT.start).x, c.y - (cps[i + 1] || sim.CIRCUIT.start).y));
    for (const g of gaps) assert(g > 150, 'Checkpoints should be well apart');
  },
  'the lap timer does not run until the first forward crossing of the line'() {
    const { config, state } = fresh({}, true);
    run(state, config, idle, 2);
    assert.strictEqual(state.lap.started, false);
    assert.strictEqual(sim.currentLapTime(state), 0);
    walk(state, config, [spawnPoint(), centre(0), centre(2)]);
    assert.strictEqual(state.lap.started, true);
  },
  'the timer starts at the first forward crossing, so lap 1 is a flying lap'() {
    const { config, state } = fresh({}, true);
    run(state, config, idle, 5);
    walk(state, config, [spawnPoint(), centre(2)]);
    const startedAt = state.lap.startTime;
    walk(state, config, along(3, 40));
    assert(Math.abs(sim.currentLapTime(state) - (state.time - startedAt)) < 1e-9);
    assert(sim.currentLapTime(state) < 2, 'time spent sitting on the grid must not count');
  },
  'driving forward through every Checkpoint and over the line completes a Lap'() {
    const { config, state } = fresh({}, true);
    walk(state, config, [spawnPoint()]);
    walk(state, config, fullLap());
    assert.strictEqual(state.lap.count, 1);
    assert(state.lap.lastLapTime > 0 && state.lap.lastLapTime === state.lap.bestLapTime);
    assert.strictEqual(state.lap.nextCheckpoint, 0, 'Checkpoints reset for the next lap');
  },
  'skipping a Checkpoint means no Lap, even after crossing the line'() {
    const { config, state } = fresh({}, true);
    walk(state, config, [spawnPoint(), ...along(0, 5)]);
    const n = N(), cp = sim.CIRCUIT.checkpoints.length;
    assert.strictEqual(state.lap.started, true);
    // Cut straight from just before the line back to just after it, skipping every Checkpoint.
    walk(state, config, [...along(n - 3, n - 1), ...along(n, n + 2)]);
    assert.strictEqual(state.lap.count, 0);
    assert(state.lap.nextCheckpoint < cp);
  },
  'Checkpoints out of order do not count'() {
    const { config, state } = fresh({}, true);
    walk(state, config, [spawnPoint(), ...along(0, 5)]);
    const c = sim.CIRCUIT, second = c.checkpoints[1];
    const idx = c.pts.findIndex(p => Math.hypot(p.x - second.x, p.y - second.y) < 1);
    walk(state, config, [centre(idx - 2), centre(idx + 2)]);   // cross the second Checkpoint while the first is still due
    assert.strictEqual(state.lap.nextCheckpoint, 0, 'the second Checkpoint must not count before the first');
    // finish the loop without the first Checkpoint: crossing back over the line gives no Lap
    walk(state, config, [...along(idx + 3, N() - 1), ...along(N(), N() + 2)]);
    assert.strictEqual(state.lap.count, 0);
  },
  'backward crossings of a Checkpoint or the line count for nothing'() {
    const { config, state } = fresh({}, true);
    walk(state, config, [spawnPoint(), ...along(0, 3)]);
    // drive backward over the line, and forward again: no Lap, still started, no double counting
    walk(state, config, [...along(3, -3), ...along(-3, 3)]);
    assert.strictEqual(state.lap.count, 0);
    assert.strictEqual(state.lap.started, true);
    // collect the first Checkpoint, then reverse over it
    const first = sim.CIRCUIT.checkpoints[0];
    const idx = sim.CIRCUIT.pts.findIndex(p => Math.hypot(p.x - first.x, p.y - first.y) < 1);
    walk(state, config, along(3, idx + 3));
    assert.strictEqual(state.lap.nextCheckpoint, 1);
    walk(state, config, along(idx + 3, idx - 3));          // back over it
    assert.strictEqual(state.lap.nextCheckpoint, 1, 'reversing over a Checkpoint must not un-collect it or count again');
    walk(state, config, along(idx - 3, idx + 3));          // forward over it again
    assert.strictEqual(state.lap.nextCheckpoint, 1, 'the same Checkpoint does not count twice');
  },
  'reversing over the line before the timer has started does nothing'() {
    const { config, state } = fresh({}, true);
    walk(state, config, [spawnPoint(), ...along(-1, -6)]);
    assert.strictEqual(state.lap.started, false);
    assert.strictEqual(state.lap.count, 0);
  },
  'driving a lap on the grass verge still counts, because only Checkpoints guard the lap'() {
    const { config, state } = fresh({}, true);
    walk(state, config, [spawnPoint()]);
    walk(state, config, fullLap(sim.CIRCUIT.halfRoad + 30));
    assert.strictEqual(state.lap.count, 1);
  },
  'best lap is the quickest lap, last lap is the most recent'() {
    const { config, state } = fresh({}, true);
    walk(state, config, [spawnPoint()]);
    walk(state, config, fullLap(), 1 / 30);           // slow lap
    const slow = state.lap.lastLapTime;
    walk(state, config, along(3, N() - 1), 1 / 120);  // quick lap
    walk(state, config, along(N(), N() + 2), 1 / 120);
    assert.strictEqual(state.lap.count, 2);
    assert(state.lap.lastLapTime < slow);
    assert.strictEqual(state.lap.bestLapTime, state.lap.lastLapTime);
    walk(state, config, along(3, N() - 1), 1 / 15);   // a slower third lap must not replace the best
    walk(state, config, along(N(), N() + 2), 1 / 15);
    assert.strictEqual(state.lap.count, 3);
    assert(state.lap.lastLapTime > state.lap.bestLapTime);
    assert.strictEqual(state.lap.bestLapTime, Math.min(slow, state.lap.bestLapTime));
  },
  'laps do not affect Drift scoring'() {
    const { config, state } = fresh({}, true);
    state.scoring.total = 123;
    walk(state, config, [spawnPoint()]);
    walk(state, config, fullLap());
    assert.strictEqual(state.lap.count, 1);
    assert.strictEqual(state.scoring.total, 123);
  }
});

// ---- Records and the R reset -------------------------------------------------
const pressR = { ...idle, respawn: true };
// Drive Checkpoints 0..k-1 (so k have been passed), staying on the centreline.
function passCheckpoints(state, config, k) {
  const idx = i => sim.CIRCUIT.pts.findIndex(p => Math.hypot(p.x - sim.CIRCUIT.checkpoints[i].x, p.y - sim.CIRCUIT.checkpoints[i].y) < 1);
  walk(state, config, [spawnPoint(), ...along(0, 3)]);
  for (let i = 0; i < k; i++) walk(state, config, along(i === 0 ? 3 : idx(i - 1) + 1, idx(i) + 2));
}

Object.assign(tests, {
  'R puts the car back at the last passed Checkpoint, stationary and facing along the road'() {
    const { config, state } = fresh({}, true);
    passCheckpoints(state, config, 3);
    assert.strictEqual(state.lap.nextCheckpoint, 3);
    state.car.vx = 300; state.car.vy = -200; state.car.drifting = true;
    state.car.x += 400;                                   // somewhere else entirely
    sim.step(state, pressR, DT, config);
    const cp = sim.CIRCUIT.checkpoints[2], car = state.car;
    assert(Math.hypot(car.x - cp.x, car.y - cp.y) < 5, 'should be at the third Checkpoint');
    assert(Math.hypot(car.vx, car.vy) < 1, 'should be stationary');
    assert(Math.cos(car.heading) * cp.tx + Math.sin(car.heading) * cp.ty > 0.99, 'should face forward');
    assert.strictEqual(car.drifting, false);
  },
  'R with no Checkpoint passed puts the car back at the start'() {
    const { config, state } = fresh({}, true);
    walk(state, config, [spawnPoint(), ...along(0, 3)]);
    assert.strictEqual(state.lap.nextCheckpoint, 0);
    sim.step(state, pressR, DT, config);
    const s = spawnPoint();
    assert(Math.hypot(state.car.x - s.x, state.car.y - s.y) < 5);
  },
  'R ends the pending Drift Chain without banking it'() {
    const { config, state } = fresh();
    driftFor(state, config, 2);
    const pending = state.scoring.pending;
    assert(pending > 0);
    state.circuit = sim.CIRCUIT;
    sim.step(state, pressR, DT, config);
    assert.strictEqual(state.scoring.pending, 0);
    assert.strictEqual(state.scoring.multiplier, 1);
    assert.strictEqual(state.scoring.total, 0, 'a reset chain is not banked');
    run(state, config, idle, config.comboTimeout + 1);
    assert.strictEqual(state.scoring.total, 0, 'and nothing banks afterwards either');
  },
  'R keeps the lap timer running and the Checkpoint progress'() {
    const { config, state } = fresh({}, true);
    passCheckpoints(state, config, 2);
    const startTime = state.lap.startTime, lapTimeBefore = sim.currentLapTime(state);
    sim.step(state, pressR, DT, config);
    assert.strictEqual(state.lap.started, true);
    assert.strictEqual(state.lap.startTime, startTime, 'the timer must not restart');
    assert.strictEqual(state.lap.nextCheckpoint, 2);
    run(state, config, idle, 1);
    assert(sim.currentLapTime(state) > lapTimeBefore + 0.9, 'the lap time keeps counting up');
  },
  'the jump back is not mistaken for driving across a line'() {
    const { config, state } = fresh({}, true);
    passCheckpoints(state, config, sim.CIRCUIT.checkpoints.length);
    assert.strictEqual(state.lap.nextCheckpoint, sim.CIRCUIT.checkpoints.length);
    sim.step(state, pressR, DT, config);                  // jumps back from near the line to the last Checkpoint
    assert.strictEqual(state.lap.count, 0, 'jumping must not finish or start anything');
    walk(state, config, [...along(N() - 20, N() - 1), ...along(N(), N() + 2)]);   // now really drive to the line
    assert.strictEqual(state.lap.count, 1);
  },
  'holding R respawns once, not over and over'() {
    const { config, state } = fresh({}, true);
    passCheckpoints(state, config, 1);
    sim.step(state, pressR, DT, config);
    state.car.x += 120; state.car.y += 120;
    const moved = { x: state.car.x, y: state.car.y };
    sim.step(state, pressR, DT, config);                  // key still held
    assert(Math.hypot(state.car.x - moved.x, state.car.y - moved.y) < 5, 'a held key must not respawn again');
    sim.step(state, idle, DT, config);                    // release
    state.car.x += 50;
    sim.step(state, pressR, DT, config);                  // press again
    const cp = sim.CIRCUIT.checkpoints[0];
    assert(Math.hypot(state.car.x - cp.x, state.car.y - cp.y) < 5);
  },
  'R does not touch Total Score, best chain, or crash counts'() {
    const { config, state } = fresh({}, true);
    state.scoring.total = 500; state.scoring.bestChain = 120; state.crashCount = 2;
    sim.step(state, pressR, DT, config);
    assert.strictEqual(state.scoring.total, 500);
    assert.strictEqual(state.scoring.bestChain, 120);
    assert.strictEqual(state.crashCount, 2);
  },
  'Records keep the best lap and the best score, and only ever improve'() {
    const { config, state } = fresh({}, true);
    walk(state, config, [spawnPoint()]);
    walk(state, config, fullLap(), 1 / 30);
    const first = state.lap.bestLapTime;
    assert.strictEqual(state.records.bestLap, first);
    walk(state, config, [...along(3, N() - 1), ...along(N(), N() + 2)], 1 / 15);   // a slower lap
    assert.strictEqual(state.records.bestLap, first, 'a slower lap is not a Record');
    state.scoring.total = 900; sim.step(state, idle, DT, config);
    state.scoring.total = 400; sim.step(state, idle, DT, config);
    assert.strictEqual(state.records.bestScore, 900);
  },
  'a new game starts from saved Records, and only a faster lap beats the saved best lap'() {
    const config = { ...sim.CONFIG };
    const saved = { bestLap: 5, bestScore: 777 };
    const state = sim.createGameState(config, { ...saved });
    assert.strictEqual(state.records.bestScore, 777);
    assert.strictEqual(state.lap.bestLapTime, 5);
    walk(state, config, [spawnPoint()]);
    walk(state, config, fullLap(), 1 / 30);               // far slower than 5 s
    assert.strictEqual(state.records.bestLap, 5, 'the saved best lap must stand');
    assert.strictEqual(state.lap.bestLapTime, 5);
  },
  'saved Records are read back safely, whatever is in storage'() {
    const empty = sim.createRecords();
    assert.deepStrictEqual(sim.parseRecords(JSON.stringify({ bestLap: 61.234, bestScore: 4321 })), { bestLap: 61.234, bestScore: 4321 });
    for (const bad of [null, '', 'not json', '[]', '{}', '{"bestLap":"fast","bestScore":"lots"}', '{"bestLap":-4,"bestScore":-9}', '{"bestLap":null,"bestScore":null}', '{"bestLap":1e999,"bestScore":NaN}', '{"bestLap":1e-9,"bestScore":1e300}', '{"bestLap":0.2,"bestScore":0}']) {
      assert.deepStrictEqual(sim.parseRecords(bad), empty, 'bad data should give empty Records: ' + bad);
    }
    assert.deepStrictEqual(sim.parseRecords('{"bestLap":42,"bestScore":"x"}'), { bestLap: 42, bestScore: 0 });
  }
});

// ---- Whole-game check: can the Circuit actually be driven? -------------------
const wrapAngle = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

// A simple autopilot: steer toward a point ahead on the centreline, slow down for bends.
function autopilot(state, config) {
  const pts = state.circuit.pts, n = pts.length, car = state.car;
  const start = sim.circuitQuery(state.circuit, car.x, car.y).index;
  const ahead = distance => {
    let i = start, travelled = 0;
    while (travelled < distance) { const a = pts[i % n], b = pts[(i + 1) % n]; travelled += Math.hypot(b.x - a.x, b.y - a.y); i++; }
    return pts[i % n];
  };
  const aim = ahead(160), near = ahead(40), far = ahead(350);
  const steerError = wrapAngle(Math.atan2(aim.y - car.y, aim.x - car.x) - car.heading);
  const bend = Math.abs(wrapAngle(Math.atan2(far.y - near.y, far.x - near.x) - Math.atan2(near.y - car.y, near.x - car.x)));
  const wanted = Math.max(200, config.maxSpeed - bend * 500), speed = Math.hypot(car.vx, car.vy);
  return { gas: speed < wanted, brake: speed > wanted + 40, left: steerError < -0.04, right: steerError > 0.04, handbrake: false, respawn: false };
}

Object.assign(tests, {
  'the Circuit can be driven: an autopilot completes a Lap through every Checkpoint without hitting a Wall'() {
    const { config, state } = fresh({}, true);
    let seconds = 0;
    while (seconds < 120 && state.lap.count < 1) { sim.step(state, autopilot(state, config), DT, config); seconds += DT; }
    assert.strictEqual(state.lap.count, 1, 'the autopilot should finish a Lap within two minutes');
    assert.strictEqual(state.crashCount, 0, 'a careful driver should not crash');
    assert(state.lap.lastLapTime > 8 && state.lap.lastLapTime < 60, 'lap time ' + state.lap.lastLapTime);
    assert.strictEqual(state.records.bestLap, state.lap.lastLapTime, 'the lap becomes the Record');
  },
  'driving across the infield instead of round the Circuit never completes a Lap'() {
    const { config, state } = fresh({}, true);
    // Always aim at the start line from wherever the car is: a straight-line shortcut, never passing Checkpoints.
    const c = state.circuit;
    for (let t = 0; t < 60; t += DT) {
      const err = wrapAngle(Math.atan2(c.start.y - state.car.y, c.start.x - state.car.x) - state.car.heading);
      sim.step(state, { ...idle, gas: true, left: err < -0.05, right: err > 0.05 }, DT, config);
    }
    assert.strictEqual(state.lap.count, 0);
  }
});

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log('ok   - ' + name); }
  catch (e) { failed++; console.log('FAIL - ' + name + '\n       ' + e.message); }
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
