// Headless tests for the simulation. Run with: node tests/simulation.test.js
// Pulls every @sim-begin ... @sim-end block out of index.html and runs it with no DOM.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const code = [...html.matchAll(/\/\/ @sim-begin([\s\S]*?)\/\/ @sim-end/g)].map(m => m[1]).join('\n');
const sim = new Function(code + '\nreturn { CONFIG, createGameState, step };')();

const DT = 1 / 60;
const idle = { gas: false, brake: false, left: false, right: false, handbrake: false };

function fresh(overrides = {}) {
  const config = { ...sim.CONFIG, ...overrides };
  return { config, state: sim.createGameState(config) };
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

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log('ok   - ' + name); }
  catch (e) { failed++; console.log('FAIL - ' + name + '\n       ' + e.message); }
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
