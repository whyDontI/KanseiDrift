# Drift

A top-down 2D drift game. One file, no libraries, no build step.

## Play

Double-click `index.html`. It opens in your browser and you can drive straight away.

| Key | Does |
| --- | --- |
| W or Up | Gas |
| S or Down | Brake, then reverse |
| A / D or Left / Right | Steer |
| Space | Handbrake (kicks the back end out) |
| R | Respawn: put the car back at the last Checkpoint you passed (your Drift Chain is lost, the lap timer keeps running) |
| H | Show or hide the Tuning Panel |

Drift the car to earn points. Keep Drifting and the Combo Multiplier climbs; stop Drifting for a moment and the points from that Drift Chain are banked into your Total Score. Crash into a Wall hard and you lose the Drift Chain's points that you had not banked yet. A gentle scrape along a Wall does not cost you anything.

Cross the chequered line to start the lap timer. Pass all the Checkpoints in order, then cross the line again to complete a lap. Your Records, the best lap and best score, are remembered between visits.

## The Tuning Panel

The gear in the top-right corner (or the **H** key) opens and hides the panel. Drag it by its title bar, and collapse it with the minus button. Every handling number has a slider, with its smallest and largest values shown underneath. Changes happen while you drive, with no restart.

- **Reset** puts all the sliders back to their starting values (it never erases your Records).
- **Copy Config** copies the current numbers so you can paste them over `CONFIG` at the top of `index.html`.
- **Presets**: Arcade (easy drifts), Realistic (grippy), Sideways Mode (very slidey).

## If the car feels wrong, change these three first

"Too slippery" means the back of the car swings out more than you want. "Too stiff" means the car grips and turns like it is on rails and will not slide.

| If it feels | Number | Try |
| --- | --- | --- |
| **Too slippery** | `driftGrip` | Raise it (for example 4.5 to 7). The car slides less when you steer hard. |
| | `steerSpeed` | Lower it (2.6 to 1.8). The car turns less sharply, so it slides less. |
| | `handbrakeGrip` | Raise it (2.5 to 5). Space kicks the back end out less. |
| **Too stiff** | `driftGrip` | Lower it (4.5 to 3). The car slides more when you steer hard. |
| | `steerSpeed` | Raise it (2.6 to 3.5). The car turns more sharply and slides sooner. |
| | `handbrakeGrip` | Lower it (2.5 to 1). Space throws the back end out further. |

For a sense of scale, in a standard hard-turn test: `driftGrip` 7 means no real slide at all, `driftGrip` 3 gives a long slide of about 30 degrees, and `steerSpeed` 1.8 or 3.5 changes how far the car turns in one second from about 70 to about 150 degrees.

`driftGrip` only matters once you are going fairly fast (roughly half of top speed or more). If the car feels the same when you change it, you are probably driving too slowly for it to have any effect.

Two things worth knowing:

- The car's real top speed is the lower of `maxSpeed` and roughly `acceleration` divided by `friction`. With the starting numbers that second figure is about 740, so raising `maxSpeed` past that does nothing unless you also raise `acceleration`.
- The starting numbers are in the `CONFIG` object at the top of `index.html`, each with a one-line comment.

## For the code

`CONTEXT.md` explains the words the game uses (Drift, Drift Chain, Banking, Checkpoint, Lap and so on). To run the checks, use `node tests/simulation.test.js` (no installs needed).
