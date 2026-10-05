Build a top-down 2D drift game for the web. Use only plain HTML, CSS and
JavaScript with HTML5 Canvas. No libraries, no build tools. Put everything
in ONE file called index.html so I can double click to play.

## 1. CAR AND CONTROLS

- Keyboard: W/Up = gas, S/Down = brake and reverse, A/D or Left/Right =
  steer, Space = handbrake.
- Car physics: use velocity, heading angle, and lateral (sideways) grip.
  When I steer hard at speed or hit the handbrake, reduce sideways grip so
  the rear slides out. Grip should come back slowly when I straighten up.
- The car must feel fun and controllable, not like it is on ice.

## 2. CONFIG OBJECT

- At the very top of the file, make a CONFIG object with clearly named
  numbers and a one line comment on each.
- Include at least: maxSpeed, acceleration, brakePower, friction,
  steerSpeed, normalGrip, driftGrip, handbrakeGrip, gripRecoverySpeed,
  driftScoreRate, comboTimeout.
- All physics code must read values from CONFIG every frame, so changing a
  value takes effect immediately.

## 3. TUNING PANEL (hideable, live)

- A floating panel in the top right corner, built with HTML/CSS on top of
  the canvas (not drawn inside the canvas).
- A small gear button is always visible. Clicking it, or pressing the H
  key, shows or hides the panel. The panel starts open the first time.
- The panel can be dragged by its title bar and has a collapse button.
- Semi transparent dark background so I can still see the game behind it.
- One slider for every value in CONFIG. Each slider shows the name, the
  current number, and a sensible min and max.
- Group sliders under small headings: Speed, Steering, Grip, Drift Score.
- Moving a slider changes the game instantly while I drive. No restart.
- Buttons:
  a) Reset: restores the default values.
  b) Copy Config: copies the current values as a JavaScript object to my
  clipboard so I can paste them back into the code.
- Presets dropdown with: "Arcade" (easy drifts), "Realistic" (grippy),
  "Sideways Mode" (very slidey). Each one just sets the sliders.
- Save slider values in localStorage so they stay after a refresh.

BUGS TO AVOID IN THE PANEL

- After I click or drag a slider, blur it so the arrow keys keep driving
  the car instead of moving the slider.
- Mouse clicks on the panel must not trigger anything in the game.
- Pressing H must not type or move anything else.
- Keyboard keys used for driving must call preventDefault so the page
  does not scroll.

## 4. VISUALS

- Tire smoke particles when drifting.
- Skid marks that stay on the ground and slowly fade.
- Camera follows the car smoothly.
- Simple clean look: a road, grass, and a colored car made from shapes.

## 5. GAME RULES

- A looping circuit track with walls. Hitting a wall slows the car down.
- Drift score: points build up while sliding, with a combo multiplier.
  If I crash or stop drifting for too long, the combo banks or resets.
- Lap timer, best lap, and checkpoints so I cannot cheat across the grass.
- HUD showing speed, drift score, combo, and lap time.

## 6. CODE QUALITY

- Keep the code in clearly commented sections: CONFIG, INPUT, PHYSICS,
  RENDERING, GAME LOGIC, TUNING PANEL.
- Use requestAnimationFrame with delta time so speed is the same on any
  screen.
- Do not use any external files or libraries.

## 7. WHEN YOU ARE DONE

- Tell me in simple English which 3 CONFIG numbers to change first if the
  car feels too slippery or too stiff.
- Tell me how to open the game and how to open and hide the panel.
