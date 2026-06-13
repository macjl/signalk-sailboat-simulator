# Signal K Sailboat Simulator

Signal K plugin that simulates a sailing boat by integrating a virtual position from data already present in Signal K: target heading, weather and polar performance.

The design goal is to keep this plugin small. It publishes only the simulated vessel state and expects specialised plugins to provide autopilot intent, weather and polar calculations.

## Published paths

By default the plugin publishes:

- `navigation.position`
- `navigation.headingTrue`
- `navigation.courseOverGroundTrue`
- `navigation.speedOverGround`
- `navigation.speedThroughWater`

All values are published with `$source: signalk-sailboat-simulator`.

## Input contract

Default input paths:

- `steering.autopilot.target.headingTrue`: desired true heading in radians
- `steering.autopilot.target.headingMagnetic`: desired magnetic heading in radians
- `steering.autopilot.mode`: autopilot mode; when it is `wind`, wind steering is enabled
- `steering.autopilot.target.windAngleApparent`: desired apparent wind angle in radians
- `navigation.magneticVariation`: magnetic variation in radians, added to magnetic heading to derive true heading
- `performance.polarSpeed`: boat speed from the active polar in m/s
- `navigation.distanceToShore`: optional distance to the nearest coast in m, used for grounding protection
- `navigation.shore.bearingTrue`: optional bearing from the vessel to the nearest coast in radians, used to allow recovery headings away from shore
- `environment.wind.speedTrue`: true wind speed in m/s
- `environment.wind.directionTrue`: true wind direction in radians

When Weather API reading is enabled, `environment.wind.speedTrue` and `environment.wind.directionTrue` are populated from Signal K Weather API data at the simulated position. The simulator first tries observations, then falls back to the closest point forecast when no usable observation is available. The direct input paths are only used when Weather API reading is disabled, so the simulator does not fall back to wind values it published itself.

By default the simulator uses the Signal K default weather provider. Set `weather.providerId` to a registered provider id, for example `open-meteo` or `signalk-grib-weather-provider`, to use that provider explicitly.

When no usable weather data is available yet, for example while a GRIB provider is still indexing files during startup, the simulator retries with `weather.retryIntervalSeconds` instead of waiting for the normal polling interval.

If `steering.autopilot.target.headingTrue` is missing, the simulator derives the true heading from the autopilot magnetic target:

```text
headingTrue = steering.autopilot.target.headingMagnetic + navigation.magneticVariation
```

For the current Signal K autopilot emulator, `steering.autopilot.target` is also read as a fallback because the target value may be exposed there.

When the autopilot mode is `wind`, the simulator ignores stale heading targets and derives the boat heading from `steering.autopilot.target.windAngleApparent`, true wind speed/direction, and boat speed. This lets the virtual boat hold the requested apparent wind angle.

The simulator publishes virtual wind for the rest of the Signal K stack:

- `environment.wind.speedTrue`
- `environment.wind.directionTrue`
- `environment.wind.angleTrueWater`
- `environment.wind.speedApparent`
- `environment.wind.angleApparent`
- `environment.wind.gust`

This gives `signalk-polar-performance-plugin` the `environment.wind.speedTrue` and `environment.wind.angleTrueWater` inputs it needs to calculate `performance.polarSpeed`.

The first version uses `performance.polarSpeed` as the boat speed and integrates the position along the target heading. Current, leeway, route following and manoeuvre rules are intentionally left as separate steps.

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

## Prerequisites

Minimum capabilities to configure in the Signal K sandbox:

- A heading source. Prefer a Signal K autopilot provider or a small control plugin that publishes `steering.autopilot.target.headingTrue`.
- A weather source. Prefer a Signal K Weather API provider, or any plugin/integration that publishes `environment.wind.speedTrue` and `environment.wind.directionTrue`.
- A polar/performance source. `signalk-polar-performance-plugin` is the likely first candidate because it publishes `performance.polarSpeed` from a polar CSV.
- A true wind angle source if the polar plugin requires it. This can be provided by a derived-data or advanced wind plugin that calculates `environment.wind.angleTrueWater` from wind direction and the simulated heading.

Useful existing building blocks:

- Signal K Weather Providers: https://demo.signalk.org/documentation/Developing/Plugins/Weather_Providers.html
- Signal K Weather API: https://demo.signalk.org/documentation/Developing/REST_APIs/Weather_API.html
- Signal K Autopilot Providers: https://demo.signalk.org/documentation/develop/plugins/autopilot_provider_plugins.html
- Signal K Course Providers: https://demo.signalk.org/documentation/Developing/Plugins/Course_Providers.html
- `signalk-polar-performance-plugin`: https://www.npmjs.com/package/signalk-polar-performance-plugin
- `advancedwind`: https://www.npmjs.com/package/advancedwind
- `polar-recorder`: https://www.npmjs.com/package/polar-recorder

## Development

Run tests with:

```sh
npm test
```

The core simulator is in `lib/simulation-engine.js`. Keep physics and navigation calculations there so behaviour can be tested without a Signal K server.
