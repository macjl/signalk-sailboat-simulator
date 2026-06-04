'use strict'

const { createInitialState, stepSimulation } = require('./lib/simulation-engine')
const { buildSchema } = require('./lib/plugin-schema')
const { degToRad, radToDeg } = require('./lib/angles')
const { apparentWindFromTrue, trueWindFromDirection, windSnapshotFromObservation } = require('./lib/wind')
const { applyPersistedState, createStateStore, stateFromSimulation } = require('./lib/state-store')

const PLUGIN_ID = 'sailboat-simulator'
const PUBLISH_SOURCE = 'signalk-sailboat-simulator'

const DEFAULT_OPTIONS = {
  enabled: true,
  tickIntervalMs: 1000,
  maxStepSeconds: 5,
  initialState: {
    latitude: 43.63278,
    longitude: 7.14287,
    headingTrueDeg: 270
  },
  inputs: {
    autopilotModePath: 'steering.autopilot.mode',
    targetHeadingTruePath: 'steering.autopilot.target.headingTrue',
    targetHeadingMagneticPath: 'steering.autopilot.target.headingMagnetic',
    targetHeadingMagneticFallbackPath: 'steering.autopilot.target',
    targetWindAngleApparentPath: 'steering.autopilot.target.windAngleApparent',
    magneticVariationPath: 'navigation.magneticVariation',
    performanceSpeedPath: 'performance.polarSpeed',
    windSpeedTruePath: 'environment.wind.speedTrue',
    windDirectionTruePath: 'environment.wind.directionTrue',
    distanceToShorePath: 'navigation.distanceToShore',
    shoreBearingTruePath: 'navigation.shore.bearingTrue'
  },
  weather: {
    enabled: true,
    pollIntervalSeconds: 600,
    maxAgeSeconds: 1800
  },
  fallback: {
    speedThroughWater: 0
  },
  dynamics: {
    maxTurnRateDegPerSecond: 3
  },
  grounding: {
    enabled: true,
    minimumDistanceToShore: 20
  },
  persistence: {
    enabled: true,
    saveIntervalSeconds: 10
  },
  publishing: {
    source: PUBLISH_SOURCE,
    position: true,
    headingMagnetic: true,
    headingTrue: true,
    courseOverGroundTrue: true,
    speedOverGround: true,
    speedThroughWater: true
  },
  windPublishing: {
    enabled: true,
    speedTrue: true,
    directionTrue: true,
    angleTrueWater: true,
    speedApparent: true,
    angleApparent: true,
    gust: true
  }
}

module.exports = function createPlugin (app) {
  let options = DEFAULT_OPTIONS
  let timer = null
  let state = null
  let runtime = inactiveRuntime()
  let tickRunning = false
  let lastWeatherFetchAt = 0
  let lastStateSaveAt = 0
  let weatherSnapshot = null
  let stateStore = null

  const plugin = {
    id: PLUGIN_ID,
    name: 'Sailboat Simulator',
    description: 'Simulates a sailing boat position from Signal K heading, weather and polar performance data.',
    schema: buildSchema,
    start,
    stop,
    registerWithRouter
  }

  return plugin

  function start (pluginOptions) {
    options = normalizeOptions(mergeOptions(DEFAULT_OPTIONS, pluginOptions || {}))
    stateStore = createStateStore(app, PLUGIN_ID)
    state = createInitialState(options)
    if (options.persistence.enabled) {
      state = applyPersistedState(state, stateStore.load())
    }
    runtime = inactiveRuntime()

    if (!options.enabled) {
      runtime.status = 'disabled'
      setStatus()
      return
    }

    tick()
    timer = setInterval(() => { tick() }, options.tickIntervalMs)
    setStatus()
  }

  function stop () {
    if (timer) clearInterval(timer)
    timer = null
    runtime.status = 'inactive'
    setStatus()
  }

  async function tick () {
    if (tickRunning) return
    tickRunning = true
    const now = Date.now()
    try {
      await refreshWeather(now)
      const inputs = readInputs()
      state = stepSimulation(state, inputs, options, now)
      publishState(inputs)
      persistState(now)
      updateRuntime(inputs)
      setStatus()
    } catch (error) {
      runtime.status = 'error'
      runtime.error = error.message
      app.error && app.error(`Sailboat simulator tick failed: ${error.message}`)
      setStatus()
    } finally {
      tickRunning = false
    }
  }

  function persistState (now) {
    if (!options.persistence.enabled || !stateStore) return
    if (now - lastStateSaveAt < options.persistence.saveIntervalSeconds * 1000) return
    const persisted = stateFromSimulation(state)
    if (stateStore.save(persisted)) lastStateSaveAt = now
  }

  function readInputs () {
    const weatherWind = freshWeatherWind()
    return {
      autopilotMode: readString(options.inputs.autopilotModePath) || readString('steering.autopilot.state'),
      targetHeadingTrue: readNumber(options.inputs.targetHeadingTruePath),
      targetHeadingMagnetic: readFirstNumber([
        options.inputs.targetHeadingMagneticPath,
        options.inputs.targetHeadingMagneticFallbackPath
      ]),
      targetWindAngleApparent: readNumber(options.inputs.targetWindAngleApparentPath),
      magneticVariation: readNumber(options.inputs.magneticVariationPath),
      polarSpeed: readNumber(options.inputs.performanceSpeedPath),
      windSpeedTrue: weatherWind && weatherWind.speedTrue != null
        ? weatherWind.speedTrue
        : readNumber(options.inputs.windSpeedTruePath),
      windDirectionTrue: weatherWind && weatherWind.directionTrue != null
        ? weatherWind.directionTrue
        : readNumber(options.inputs.windDirectionTruePath),
      distanceToShore: readNumber(options.inputs.distanceToShorePath),
      shoreBearingTrue: readNumber(options.inputs.shoreBearingTruePath),
      windGust: weatherWind && weatherWind.gust != null ? weatherWind.gust : null,
      weatherObservedAt: weatherWind ? weatherWind.observedAt : null,
      weatherDescription: weatherWind ? weatherWind.description : ''
    }
  }

  function readNumber (path) {
    if (!path || typeof app.getSelfPath !== 'function') return null
    const value = app.getSelfPath(`${path}.value`)
    return Number.isFinite(value) ? value : null
  }

  function readString (path) {
    if (!path || typeof app.getSelfPath !== 'function') return null
    const value = app.getSelfPath(`${path}.value`)
    return typeof value === 'string' ? value : null
  }

  function readFirstNumber (paths) {
    for (const path of paths) {
      const value = readNumber(path)
      if (Number.isFinite(value)) return value
    }
    return null
  }

  function publishState (inputs) {
    if (!state || !app.handleMessage) return

    const values = []
    if (options.publishing.position) {
      values.push({
        path: 'navigation.position',
        value: {
          latitude: state.position.latitude,
          longitude: state.position.longitude
        }
      })
    }
    if (options.publishing.headingTrue) {
      values.push({ path: 'navigation.headingTrue', value: state.headingTrue })
    }
    if (options.publishing.headingMagnetic && Number.isFinite(state.headingMagnetic)) {
      values.push({ path: 'navigation.headingMagnetic', value: state.headingMagnetic })
    }
    if (options.publishing.courseOverGroundTrue) {
      values.push({ path: 'navigation.courseOverGroundTrue', value: state.courseOverGroundTrue })
    }
    if (options.publishing.speedOverGround) {
      values.push({ path: 'navigation.speedOverGround', value: state.speedOverGround })
    }
    if (options.publishing.speedThroughWater) {
      values.push({ path: 'navigation.speedThroughWater', value: state.speedThroughWater })
    }
    values.push(...buildWindValues(inputs))

    if (values.length === 0) return
    app.handleMessage(PLUGIN_ID, {
      updates: [
        {
          $source: options.publishing.source,
          values
        }
      ]
    })
  }

  function buildWindValues (inputs) {
    if (!options.windPublishing.enabled) return []
    if (!Number.isFinite(inputs.windSpeedTrue) || !Number.isFinite(inputs.windDirectionTrue)) return []

    const windValues = []
    const angleTrueWater = trueWindFromDirection(inputs.windDirectionTrue, state.headingTrue)
    const apparent = apparentWindFromTrue({
      trueWindSpeed: inputs.windSpeedTrue,
      trueWindAngle: angleTrueWater,
      boatSpeed: state.speedThroughWater
    })

    if (options.windPublishing.speedTrue) {
      windValues.push({ path: 'environment.wind.speedTrue', value: inputs.windSpeedTrue })
    }
    if (options.windPublishing.directionTrue) {
      windValues.push({ path: 'environment.wind.directionTrue', value: inputs.windDirectionTrue })
    }
    if (options.windPublishing.angleTrueWater && Number.isFinite(angleTrueWater)) {
      windValues.push({ path: 'environment.wind.angleTrueWater', value: angleTrueWater })
    }
    if (options.windPublishing.speedApparent && apparent) {
      windValues.push({ path: 'environment.wind.speedApparent', value: apparent.speed })
    }
    if (options.windPublishing.angleApparent && apparent) {
      windValues.push({ path: 'environment.wind.angleApparent', value: apparent.angle })
    }
    if (options.windPublishing.gust && Number.isFinite(inputs.windGust)) {
      windValues.push({ path: 'environment.wind.gust', value: inputs.windGust })
    }

    return windValues
  }

  async function refreshWeather (now) {
    if (!options.weather.enabled) return
    if (now - lastWeatherFetchAt < options.weather.pollIntervalSeconds * 1000) return
    lastWeatherFetchAt = now

    const position = state && state.position ? state.position : options.initialState
    const observation = await fetchWeatherObservation(position)
    const snapshot = windSnapshotFromObservation(observation)
    if (snapshot) {
      weatherSnapshot = {
        ...snapshot,
        fetchedAt: now
      }
    }
  }

  async function fetchWeatherObservation (position) {
    if (!app.weatherApi || typeof app.weatherApi.getObservations !== 'function') return null
    const observations = await app.weatherApi.getObservations(position, { maxCount: 1 })
    return Array.isArray(observations) && observations.length > 0 ? observations[0] : null
  }

  function freshWeatherWind () {
    if (!weatherSnapshot) return null
    const ageSeconds = (Date.now() - weatherSnapshot.fetchedAt) / 1000
    return ageSeconds <= options.weather.maxAgeSeconds ? weatherSnapshot : null
  }

  function updateRuntime (inputs) {
    runtime = {
      status: state.groundingProtectionActive
        ? 'groundingProtection'
        : Number.isFinite(state.speedThroughWater) && state.speedThroughWater > 0 ? 'sailing' : 'waitingForPerformance',
      position: state.position,
      headingTrueDeg: radToDeg(state.headingTrue),
      headingMagneticDeg: Number.isFinite(state.headingMagnetic) ? radToDeg(state.headingMagnetic) : null,
      magneticVariationDeg: Number.isFinite(state.magneticVariation) ? radToDeg(state.magneticVariation) : null,
      courseOverGroundTrueDeg: radToDeg(state.courseOverGroundTrue),
      speedOverGround: state.speedOverGround,
      speedThroughWater: state.speedThroughWater,
      distanceToShore: Number.isFinite(inputs.distanceToShore) ? inputs.distanceToShore : null,
      groundingProtectionActive: Boolean(state.groundingProtectionActive),
      windAngleTrueWaterDeg: Number.isFinite(state.windAngleTrueWater) ? radToDeg(state.windAngleTrueWater) : null,
      weather: weatherSnapshot
        ? {
            status: freshWeatherWind() ? 'fresh' : 'stale',
            observedAt: weatherSnapshot.observedAt,
            fetchedAt: new Date(weatherSnapshot.fetchedAt).toISOString(),
            description: weatherSnapshot.description
          }
        : { status: options.weather.enabled ? 'missing' : 'disabled' },
      inputs: {
        autopilotMode: inputs.autopilotMode || null,
        targetHeadingTrue: valueStatus(inputs.targetHeadingTrue),
        targetHeadingMagnetic: valueStatus(inputs.targetHeadingMagnetic),
        targetWindAngleApparent: valueStatus(inputs.targetWindAngleApparent),
        magneticVariation: valueStatus(inputs.magneticVariation),
        performanceSpeed: valueStatus(inputs.polarSpeed),
        distanceToShore: valueStatus(inputs.distanceToShore),
        shoreBearingTrue: valueStatus(inputs.shoreBearingTrue),
        windSpeedTrue: valueStatus(inputs.windSpeedTrue),
        windDirectionTrue: valueStatus(inputs.windDirectionTrue),
        windGust: valueStatus(inputs.windGust)
      },
      updatedAt: new Date(state.updatedAt).toISOString()
    }
  }

  function setStatus () {
    if (!app.setPluginStatus) return
    if (runtime.status === 'sailing') {
      app.setPluginStatus(`Sailing at ${runtime.speedOverGround.toFixed(2)} m/s, heading ${runtime.headingTrueDeg.toFixed(1)} deg`)
    } else if (runtime.status === 'groundingProtection') {
      app.setPluginStatus(`Stopped: distance to shore ${runtime.distanceToShore.toFixed(1)} m`)
    } else {
      app.setPluginStatus(runtime.status)
    }
  }

  function registerWithRouter (router) {
    router.get('/api/status', (req, res) => {
      res.json({
        plugin: PLUGIN_ID,
        runtime,
        options: {
          tickIntervalMs: options.tickIntervalMs,
          inputs: options.inputs,
          weather: options.weather,
          dynamics: options.dynamics,
          grounding: options.grounding,
          persistence: options.persistence,
          publishing: options.publishing,
          windPublishing: options.windPublishing
        }
      })
    })
  }
}

function normalizeOptions (options) {
  const normalized = mergeOptions(DEFAULT_OPTIONS, options || {})
  normalized.initialState.headingTrue = degToRad(normalized.initialState.headingTrueDeg)
  return normalized
}

function inactiveRuntime () {
  return {
    status: 'inactive',
    position: null,
    headingTrueDeg: null,
    headingMagneticDeg: null,
    magneticVariationDeg: null,
    courseOverGroundTrueDeg: null,
    speedOverGround: null,
    speedThroughWater: null,
    distanceToShore: null,
    groundingProtectionActive: false,
    windAngleTrueWaterDeg: null,
    inputs: {},
    updatedAt: null
  }
}

function valueStatus (value) {
  return Number.isFinite(value) ? 'present' : 'missing'
}

function mergeOptions (base, override) {
  if (!override || typeof override !== 'object') return clone(base)
  const result = clone(base)
  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = mergeOptions(result[key], value)
    } else {
      result[key] = value
    }
  }
  return result
}

function isPlainObject (value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function clone (value) {
  return JSON.parse(JSON.stringify(value))
}
