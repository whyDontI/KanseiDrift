# Drifting Game

A top-down 2D drift game where the player drives a car around a closed circuit, earning points for sliding and racing lap times.

## Language

### Driving

**Drift**:
The state of the car sliding sideways: the angle between heading and velocity is above an entry threshold at sufficient speed, and it stays on until the angle falls below a lower exit threshold.
_Avoid_: Slide, skid (a skid is the mark left on the ground, not the state)

**Tuning Panel**:
The floating overlay of sliders that changes the car's handling values live while driving.
_Avoid_: Settings, debug menu

### Scoring

**Drift Chain**:
A continuous run of drifting whose points accumulate in a pending pool.
_Avoid_: Streak, combo (the combo is the multiplier, not the run)

**Combo Multiplier**:
The factor applied to points in a Drift Chain; it grows with the chain's duration and resets when the chain ends.
_Avoid_: Combo, bonus

**Banking**:
Moving a Drift Chain's pending points into the total score, triggered by not drifting for the combo timeout.
_Avoid_: Cashing out, saving

**Total Score**:
The sum of all banked Drift Chains over the session; independent of laps.
_Avoid_: Points (points are the pending amount within a chain)

### Track

**Circuit**:
The fixed, hand-authored closed loop of road, with a grass Verge on each side, bounded by Walls.
_Avoid_: Course, map

**Wall**:
The boundary enclosing the Circuit, standing just beyond the grass verge that borders the road; the car collides with it.
_Avoid_: Barrier, fence

**Verge**:
The strip of grass between the road edge and the Wall; driving on it slows the car.
_Avoid_: Shoulder, off-road

**Scrape**:
A low-speed or glancing wall hit that only slows the car and keeps the Drift Chain alive.
_Avoid_: Bump, touch

**Crash**:
A wall hit above the crash speed threshold; it slows the car and loses the pending Drift Chain points.
_Avoid_: Collision, wipeout

**Checkpoint**:
An ordered gate along the Circuit that must be passed for a lap to count.
_Avoid_: Waypoint, gate

**Lap**:
One forward crossing of the start/finish line after passing all Checkpoints in order. The timer starts on the first forward crossing, so the first Lap is a flying lap.
_Avoid_: Round, loop

**Records**:
The persisted best lap time and best score, stored separately from tuning values and untouched by the Tuning Panel's Reset.
_Avoid_: High scores (when meaning lap time too)
