'use strict'

function buildSchema () {
  return {
    type: 'object',
    title: 'Sailboat Simulator',
    description: 'Simulates a virtual sailboat from autopilot turn-rate output, an active polar resource, weather and optional shore-distance data already present in Signal K.',
    properties: {
      initialState: {
        type: 'object',
        title: 'Initial state',
        description: 'What it does: sets the starting position and heading for a new simulation. Requires: nothing else. These values are only used when persistence is disabled or no previous runtime state has been saved.',
        properties: {
          latitude: {
            type: 'number',
            title: 'Initial latitude',
            default: 43.63278,
            minimum: -90,
            maximum: 90
          },
          longitude: {
            type: 'number',
            title: 'Initial longitude',
            default: 7.14287,
            minimum: -180,
            maximum: 180
          },
          headingTrueDeg: {
            type: 'number',
            title: 'Initial true heading in degrees',
            default: 180,
            minimum: 0,
            maximum: 360
          }
        }
      },
      wind: {
        type: 'object',
        title: 'Wind',
        description: 'What it does: reads wind at the simulated boat position from the Signal K Weather API and publishes the selected wind values. The simulator also uses this wind with the active polar resource to calculate boat speed. Requires: a Weather API provider, preferably @signalk/open-meteo-provider. Options: publish true wind, publish apparent wind, optionally force a provider id instead of the Signal K default, and choose the polling interval.',
        properties: {
          trueWind: {
            type: 'boolean',
            title: 'Publish true wind',
            description: 'Publishes environment.wind.speedTrue, environment.wind.directionTrue and environment.wind.angleTrueWater. These are also the true wind values used for the internal polar speed calculation.',
            default: true
          },
          apparentWind: {
            type: 'boolean',
            title: 'Publish apparent wind',
            description: 'Publishes environment.wind.speedApparent and environment.wind.angleApparent as seen from the simulated boat.',
            default: true
          },
          providerId: {
            type: 'string',
            title: 'Weather provider id',
            description: 'Leave empty to use the Signal K default Weather API provider. Use open-meteo to force @signalk/open-meteo-provider.',
            default: ''
          },
          pollIntervalSeconds: {
            type: 'number',
            title: 'Weather polling interval in seconds',
            description: 'How often the simulator refreshes wind from the Weather API for its speed calculation and optional wind publication.',
            default: 60,
            minimum: 30
          }
        }
      },
      publishing: {
        type: 'object',
        title: 'Navigation output',
        description: 'What it does: publishes the simulated boat navigation state. Requires steering.autopilot.output.turnRate to steer, an active polar from signalk-polar-management, and weather wind to calculate boat speed. If navigation.magneticVariation is available, navigation.headingMagnetic is also published. Recommended providers: signalk-autopilot-emulator-v2, signalk-polar-management and signalk-derived-data with navigation.magneticVariation publishing enabled.',
        properties: {
          navigation: {
            type: 'boolean',
            title: 'Publish navigation state',
            description: 'Publishes navigation.position, navigation.headingTrue, navigation.headingMagnetic when magnetic variation is available, navigation.courseOverGroundTrue, navigation.speedOverGround and navigation.speedThroughWater.',
            default: true
          }
        }
      },
      grounding: {
        type: 'object',
        title: 'Grounding protection',
        description: 'What it does: stops the simulated boat when it gets too close to shore, while still allowing headings that move away from the nearest shore. Requires: navigation.distanceToShore, and for recovery-heading detection navigation.shore.bearingTrue. Install signalk-distance-to-shore to provide these paths.',
        properties: {
          enabled: {
            type: 'boolean',
            title: 'Stop when too close to shore',
            description: 'Enables the shore-distance stop logic.',
            default: true
          },
          minimumDistanceToShore: {
            type: 'number',
            title: 'Minimum distance to shore in meters',
            description: 'The simulator stops when navigation.distanceToShore is less than or equal to this value.',
            default: 20,
            minimum: 0
          }
        }
      },
      persistence: {
        type: 'object',
        title: 'Persistence',
        description: 'What it does: restores the last simulated position, heading and speed after Signal K restarts. Requires: writable plugin data storage in Signal K.',
        properties: {
          enabled: {
            type: 'boolean',
            title: 'Restore last simulated state on startup',
            description: 'When enabled, the simulator resumes from its saved runtime state instead of returning to the initial state.',
            default: true
          }
        }
      }
    }
  }
}

module.exports = {
  buildSchema
}
