RACE CONTROL – SETTINGS
=======================

Every value here changes how the simulation behaves. One file per topic:

  simulation.js      step size of the simulation, frame budget
  cars.js            top speed, braking, fuel, DRS / Straight Mode / Overtake Mode
  tyres.js           compounds (grip, wear), cold tyres, graining, track temperature, tyre sets
  track.js           rubber on the track over a weekend
  pitlane.js         pit lane speed, stop times, slow stops, releases, double stacks
  neutralisation.js  VSC / Safety Car speed and delta time
  incidents.js       spins, crashes, track limits, failures, number of offences
  marshals.js        recovery crews, how long the work takes, medical car and checks
  weather.js         lightning distance
  sessions.js        session lengths, practice, rookies
  stewards.js        penalties, co-stewards, precedents
  controls.js        default keyboard shortcuts (each user can change them in the app: "⌨")

How to change a value: open the file in a text editor, change the number, save, reload the
page. Keep the format (a dot as decimal sign, commas between the entries of a list).
The files are loaded before the rest of the program (index.html), so every part of the
simulation sees the new value.
