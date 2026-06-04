'use strict'

function buildSchema () {
  return {
    type: 'object',
    title: 'Sailboat Simulator',
    description: 'Simulates navigation.position, heading and speed from a target heading plus polar performance data already published in Signal K.',
    properties: {
      enabled: {
        type: 'boolean',
        title: 'Enable simulator',
        default: true
      },
      tickIntervalMs: {
        type: 'number',
        title: 'Simulation tick interval in milliseconds',
        default: 1000,
        minimum: 200
      },
      maxStepSeconds: {
        type: 'number',
        title: 'Maximum integration step in seconds',
        default: 5,
        minimum: 1
      },
      initialState: {
        type: 'object',
        title: 'Initial state',
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
            default: 270,
            minimum: 0,
            maximum: 360
          }
        }
      },
      inputs: {
        type: 'object',
        title: 'Input paths',
        properties: {
          autopilotModePath: {
            type: 'string',
            title: 'Autopilot mode path',
            default: 'steering.autopilot.mode'
          },
          targetHeadingTruePath: {
            type: 'string',
            title: 'Target true heading path',
            default: 'steering.autopilot.target.headingTrue'
          },
          targetHeadingMagneticPath: {
            type: 'string',
            title: 'Target magnetic heading path',
            default: 'steering.autopilot.target.headingMagnetic'
          },
          targetHeadingMagneticFallbackPath: {
            type: 'string',
            title: 'Fallback target magnetic heading path',
            default: 'steering.autopilot.target'
          },
          targetWindAngleApparentPath: {
            type: 'string',
            title: 'Target apparent wind angle path',
            default: 'steering.autopilot.target.windAngleApparent'
          },
          magneticVariationPath: {
            type: 'string',
            title: 'Magnetic variation path',
            default: 'navigation.magneticVariation'
          },
          performanceSpeedPath: {
            type: 'string',
            title: 'Polar boat speed path',
            default: 'performance.polarSpeed'
          },
          windSpeedTruePath: {
            type: 'string',
            title: 'True wind speed path',
            default: 'environment.wind.speedTrue'
          },
          windDirectionTruePath: {
            type: 'string',
            title: 'True wind direction path',
            default: 'environment.wind.directionTrue'
          },
          distanceToShorePath: {
            type: 'string',
            title: 'Distance to shore path',
            default: 'navigation.distanceToShore'
          },
          shoreBearingTruePath: {
            type: 'string',
            title: 'Bearing to closest shore path',
            default: 'navigation.shore.bearingTrue'
          }
        }
      },
      weather: {
        type: 'object',
        title: 'Weather API',
        properties: {
          enabled: {
            type: 'boolean',
            title: 'Read wind from Signal K Weather API',
            default: true
          },
          pollIntervalSeconds: {
            type: 'number',
            title: 'Weather polling interval in seconds',
            default: 600,
            minimum: 30
          },
          maxAgeSeconds: {
            type: 'number',
            title: 'Maximum weather age in seconds',
            default: 1800,
            minimum: 60
          }
        }
      },
      fallback: {
        type: 'object',
        title: 'Fallbacks',
        properties: {
          speedThroughWater: {
            type: 'number',
            title: 'Fallback boat speed in m/s when polar speed is missing',
            default: 0,
            minimum: 0
          }
        }
      },
      dynamics: {
        type: 'object',
        title: 'Boat dynamics',
        properties: {
          maxTurnRateDegPerSecond: {
            type: 'number',
            title: 'Maximum heading turn rate in degrees per second',
            default: 3,
            minimum: 0
          }
        }
      },
      grounding: {
        type: 'object',
        title: 'Grounding protection',
        properties: {
          enabled: {
            type: 'boolean',
            title: 'Stop when too close to shore',
            default: true
          },
          minimumDistanceToShore: {
            type: 'number',
            title: 'Minimum distance to shore in meters',
            default: 20,
            minimum: 0
          }
        }
      },
      persistence: {
        type: 'object',
        title: 'Persistence',
        properties: {
          enabled: {
            type: 'boolean',
            title: 'Restore last simulated state on startup',
            default: true
          },
          saveIntervalSeconds: {
            type: 'number',
            title: 'Save interval in seconds',
            default: 10,
            minimum: 1
          }
        }
      },
      publishing: {
        type: 'object',
        title: 'Published paths',
        properties: {
          source: {
            type: 'string',
            title: 'Signal K source label',
            default: 'signalk-sailboat-simulator'
          },
          position: {
            type: 'boolean',
            title: 'Publish navigation.position',
            default: true
          },
          headingTrue: {
            type: 'boolean',
            title: 'Publish navigation.headingTrue',
            default: true
          },
          headingMagnetic: {
            type: 'boolean',
            title: 'Publish navigation.headingMagnetic',
            default: true
          },
          courseOverGroundTrue: {
            type: 'boolean',
            title: 'Publish navigation.courseOverGroundTrue',
            default: true
          },
          speedOverGround: {
            type: 'boolean',
            title: 'Publish navigation.speedOverGround',
            default: true
          },
          speedThroughWater: {
            type: 'boolean',
            title: 'Publish navigation.speedThroughWater',
            default: true
          }
        }
      },
      windPublishing: {
        type: 'object',
        title: 'Published wind paths',
        properties: {
          enabled: {
            type: 'boolean',
            title: 'Publish virtual wind',
            default: true
          },
          speedTrue: {
            type: 'boolean',
            title: 'Publish environment.wind.speedTrue',
            default: true
          },
          directionTrue: {
            type: 'boolean',
            title: 'Publish environment.wind.directionTrue',
            default: true
          },
          angleTrueWater: {
            type: 'boolean',
            title: 'Publish environment.wind.angleTrueWater',
            default: true
          },
          speedApparent: {
            type: 'boolean',
            title: 'Publish environment.wind.speedApparent',
            default: true
          },
          angleApparent: {
            type: 'boolean',
            title: 'Publish environment.wind.angleApparent',
            default: true
          },
          gust: {
            type: 'boolean',
            title: 'Publish environment.wind.gust',
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
