# Signal K Sailboat Simulator

Signal K plugin that simulates a sailing boat by integrating a virtual position from data already present in Signal K: target heading, weather and polar performance.

The design goal is to keep this plugin small. It publishes only the simulated vessel state and expects specialised plugins to provide autopilot intent, weather and polar calculations.

## Quick Start

The easiest setup is to use the Signal K App Store:

1. Install these recommended plugins:
   - `@signalk/open-meteo-provider`
   - `@signalk/signalk-autopilot`
   - `signalk-polar-performance-plugin`
   - `signalk-derived-data`
   - `signalk-distance-to-shore`
2. Configure `@signalk/open-meteo-provider` and make it the default Signal K Weather API provider. You can also leave the Signal K default as-is and set `wind.providerId` to `open-meteo` in this plugin.
3. Configure `signalk-polar-performance-plugin` with a polar file for the simulated boat.
4. Configure `signalk-derived-data` to publish `navigation.magneticVariation`. This is needed by the autopilot plugin when magnetic headings are involved, and lets the simulator publish `navigation.headingMagnetic`.
5. Install and enable `signalk-sailboat-simulator`.
6. Keep the default simulator options for a first run.
7. Open the Signal K Data Browser or Freeboard and check that the simulated vessel position, wind and boat speed are updating.

CLI installation is also possible from the Signal K settings directory:

```sh
cd ~/.signalk
npm install signalk-sailboat-simulator
```

Then restart Signal K and enable the plugin from the Server > Plugin Config page.

## Recommended Setup

Minimum capabilities for a useful simulation:

- Autopilot intent: `@signalk/signalk-autopilot` can provide heading and wind-mode targets under `steering.autopilot.*`.
- Weather: `@signalk/open-meteo-provider` can provide Weather API observations or forecasts at the simulated position.
- Polar performance: `signalk-polar-performance-plugin` uses the published true wind values to calculate `performance.polarSpeed`, which the simulator uses as boat speed.
- Derived data: enable the `signalk-derived-data` option that publishes `navigation.magneticVariation`. The autopilot plugin needs it for magnetic heading handling, and the simulator uses it to derive or publish magnetic headings.
- Shore distance: `signalk-distance-to-shore` can provide `navigation.distanceToShore` and `navigation.shore.bearingTrue` for grounding protection.

## Verify It Works

After enabling the plugin, these paths should update:

Navigation:

- `navigation.position`
- `navigation.headingTrue`
- `navigation.headingMagnetic` when magnetic variation is available
- `navigation.courseOverGroundTrue`
- `navigation.speedOverGround`
- `navigation.speedThroughWater`

Wind:

- `environment.wind.speedTrue`
- `environment.wind.directionTrue`
- `environment.wind.angleTrueWater`
- `environment.wind.speedApparent`
- `environment.wind.angleApparent`

Performance input expected by the simulator:

- `performance.polarSpeed`

All values are published with `$source: signalk-sailboat-simulator`.

The plugin status will show `waitingForPerformance` until `performance.polarSpeed` is available. If grounding protection is enabled and `navigation.distanceToShore` is below the configured minimum, the status will show `groundingProtection` and the simulated boat will stop.

## Input contract

The simulator reads these fixed Signal K input paths:

- `steering.autopilot.target.headingTrue`: desired true heading in radians
- `steering.autopilot.target.headingMagnetic`: desired magnetic heading in radians
- `steering.autopilot.mode`: autopilot mode; when it is `wind`, wind steering is enabled
- `steering.autopilot.target.windAngleApparent`: desired apparent wind angle in radians
- `navigation.magneticVariation`: magnetic variation in radians, added to magnetic heading to derive true heading
- `performance.polarSpeed`: boat speed from the active polar in m/s
- `navigation.distanceToShore`: optional distance to the nearest coast in m, used for grounding protection
- `navigation.shore.bearingTrue`: optional bearing from the vessel to the nearest coast in radians, used to allow recovery headings away from shore

When true or apparent wind publishing is enabled, wind is read from Signal K Weather API data at the simulated position. The simulator first tries observations, then falls back to the closest point forecast when no usable observation is available.

By default the simulator uses the Signal K default weather provider. Set `wind.providerId` to a registered provider id, for example `open-meteo`, to use that provider explicitly.

When no usable weather data is available yet, for example while the weather provider is still starting up, the simulator retries faster instead of waiting for the normal polling interval.

If `steering.autopilot.target.headingTrue` is missing, the simulator derives the true heading from the autopilot magnetic target:

```text
headingTrue = steering.autopilot.target.headingMagnetic + navigation.magneticVariation
```

For the current Signal K autopilot emulator, `steering.autopilot.target` is also read as a fallback because the target value may be exposed there.

When the autopilot mode is `wind`, the simulator ignores stale heading targets and derives the boat heading from `steering.autopilot.target.windAngleApparent`, true wind speed/direction, and boat speed. This lets the virtual boat hold the requested apparent wind angle.

The simulator publishes virtual wind for the rest of the Signal K stack. The publish options are grouped as true wind and apparent wind:

- `environment.wind.speedTrue`
- `environment.wind.directionTrue`
- `environment.wind.angleTrueWater`
- `environment.wind.speedApparent`
- `environment.wind.angleApparent`

This gives `signalk-polar-performance-plugin` the `environment.wind.speedTrue` and `environment.wind.angleTrueWater` inputs it needs to calculate `performance.polarSpeed`.

The first version uses `performance.polarSpeed` as the boat speed and integrates the position along the target heading. Current, leeway, route following and manoeuvre rules are intentionally left as separate steps.

## Configuration

The plugin intentionally keeps its configuration surface small:

- `initialState`
  What it does: sets the starting latitude, longitude and true heading for a new simulation.
  Requires: nothing else.
  Options: latitude, longitude and heading in degrees. These values are only used when persistence is disabled or no previous runtime state has been saved.

- `wind`
  What it does: reads wind at the simulated position from the Signal K Weather API and publishes the selected wind values.
  Goal: feed `signalk-polar-performance-plugin` with wind data so it can calculate `performance.polarSpeed`, which the simulator then uses as boat speed.
  Requires: a Weather API provider. The recommended provider is `@signalk/open-meteo-provider`; the recommended polar plugin is `signalk-polar-performance-plugin`.
  Options: publish true wind, publish apparent wind, optional provider id, and polling interval.
  Published true wind paths: `environment.wind.speedTrue`, `environment.wind.directionTrue`, `environment.wind.angleTrueWater`.
  Published apparent wind paths: `environment.wind.speedApparent`, `environment.wind.angleApparent`.

- `publishing`
  What it does: publishes the simulated navigation state.
  Requires: `steering.autopilot.*` target data to steer and `performance.polarSpeed` to move. Recommended providers are `@signalk/signalk-autopilot` and `signalk-polar-performance-plugin`.
  Options: publish navigation state.
  Published paths: `navigation.position`, `navigation.headingTrue`, `navigation.headingMagnetic` when available, `navigation.courseOverGroundTrue`, `navigation.speedOverGround`, `navigation.speedThroughWater`.

- `grounding`
  What it does: stops the simulated boat when it gets too close to shore, while still allowing headings that move away from the nearest shore.
  Requires: `navigation.distanceToShore`; for recovery-heading detection, also `navigation.shore.bearingTrue`.
  Recommended provider: install `signalk-distance-to-shore`.
  Options: enable grounding protection and minimum distance to shore in meters.

- `persistence`
  What it does: restores the last simulated position, heading and speed after Signal K restarts.
  Requires: writable plugin data storage in Signal K.
  Options: restore last simulated state on startup.

Signal K input paths, simulation tick timing, turn rate and persistence save timing are fixed defaults rather than UI options.

## Boat Dynamics

The simulator does not instantly snap to the autopilot target heading. It turns the virtual boat toward the target at `dynamics.maxTurnRateDegPerSecond`, which defaults to 3 degrees per second.

## Grounding Protection

When `grounding.enabled` is true, the simulator reads `navigation.distanceToShore` and stops the virtual boat when the value is less than or equal to `grounding.minimumDistanceToShore`, which defaults to 20 meters. If `navigation.shore.bearingTrue` is available, the simulator still allows movement when the selected heading points away from the nearest shore.

The companion [`signalk-distance-to-shore`](https://github.com/macjl/signalk-distance-to-shore) plugin publishes `navigation.distanceToShore`, `navigation.shore.closestPoint` and `navigation.shore.bearingTrue` from a separately installed coastline chart.

## Persistence

The simulator saves its latest runtime state every 10 seconds by default and restores it on startup, so restarting Signal K does not move the virtual boat back to the configured initial position.

Persisted values include:

- position
- true and magnetic heading
- magnetic variation
- COG, SOG and STW

## Uninstall

From the Signal K App Store, uninstall or disable `Sailboat Simulator`.

From the CLI:

```sh
cd ~/.signalk
npm uninstall signalk-sailboat-simulator
```

Then restart Signal K.

## Useful Links

- Signal K Weather Providers: https://demo.signalk.org/documentation/Developing/Plugins/Weather_Providers.html
- Signal K Weather API: https://demo.signalk.org/documentation/Developing/REST_APIs/Weather_API.html
- Signal K Autopilot Providers: https://demo.signalk.org/documentation/develop/plugins/autopilot_provider_plugins.html
- `@signalk/open-meteo-provider`: https://www.npmjs.com/package/@signalk/open-meteo-provider
- `@signalk/signalk-autopilot`: https://www.npmjs.com/package/@signalk/signalk-autopilot
- `signalk-polar-performance-plugin`: https://www.npmjs.com/package/signalk-polar-performance-plugin
- `signalk-derived-data`: https://www.npmjs.com/package/signalk-derived-data
- `signalk-distance-to-shore`: https://www.npmjs.com/package/signalk-distance-to-shore

## Development

Run tests with:

```sh
npm test
```

The core simulator is in `lib/simulation-engine.js`. Keep physics and navigation calculations there so behaviour can be tested without a Signal K server.
