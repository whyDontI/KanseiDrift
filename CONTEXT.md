# Drifting Game

A top-down 2D drift game where the player drives a car around a closed circuit, earning points for sliding and racing lap times.

## Language

### Driving

**Drift**:
The state of the car sliding sideways: the angle between heading and velocity is above an entry threshold at sufficient speed, and it stays on until the angle falls below a lower exit threshold or the car has nearly stopped.
_Avoid_: Slide, skid (a skid is the mark left on the ground, not the state)

**Slip Angle**:
The angle between where the car points and where it is travelling; a Drift starts when it passes the entry angle and ends when it falls below the lower exit angle.
_Avoid_: Drift angle, side angle

**Respawn**:
Pressing R puts the car back, stationary, at the last passed Checkpoint (or the start if none), ending any pending Drift Chain without Banking it while the lap timer keeps running.
_Avoid_: Reset (that is the Tuning Panel's button), restart

**Tuning Panel**:
The floating overlay of sliders that changes the car's handling values live while driving. It is for developers only: Players never see it, and it is only available in Dev Mode.
_Avoid_: Settings, debug menu

**Dev Mode**:
A way for the developers to switch on the Tuning Panel for their own testing; everyone else always gets the standard handling.
_Avoid_: Debug mode, admin mode

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

### Multiplayer

**Landing Page**:
The first screen of the game, with a Play button for Single Player and a button to create or join a Room.
_Avoid_: Home screen, main menu

**Room**:
A private online session that people join with a short room code, shared as a Join Link.
_Avoid_: Lobby (that is the waiting screen), game, server

**Host**:
The Player who created a Room; chooses the number of Laps and starts the Race.
_Avoid_: Owner, admin

**Player**:
A person in a Room, with a typed name and an automatically assigned car colour. Players have no accounts.
_Avoid_: User, client, racer

**Join Link**:
A web address that carries a Room's code, so opening it puts the person straight into that Room.
_Avoid_: Invite, room URL

**Lobby**:
The waiting screen of a Room before the Race starts, listing its Players.
_Avoid_: Waiting room

**Race**:
One contest in a Room over a set number of Laps, starting from a shared countdown. Each Player still earns their own Total Score while racing.
_Avoid_: Match, round, session

**Rival Car**:
Another Player's car as seen on your screen. Cars never collide with each other.
_Avoid_: Ghost (a ghost is a replay of a past lap), opponent, remote car

**Standings**:
The ranking of Players in a Race by Laps completed and then time, shown with each Player's Total Score alongside.
_Avoid_: Leaderboard, results table

**Single Player**:
Playing alone on a device with no Room; works offline from the plain file.
_Avoid_: Offline mode, practice
