// Headless tests for the simulation. Run with: node tests/simulation.test.js
// Pulls every @sim-begin ... @sim-end block out of index.html and runs it with no DOM.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const code = [...html.matchAll(/\/\/ @sim-begin([\s\S]*?)\/\/ @sim-end/g)].map(m => m[1]).join('\n');
const sim = new Function(code + '\nreturn { CONFIG, createGameState, step, CIRCUIT, createCircuit, circuitQuery };')();

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

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log('ok   - ' + name); }
  catch (e) { failed++; console.log('FAIL - ' + name + '\n       ' + e.message); }
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
