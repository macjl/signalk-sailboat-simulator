'use strict'

const { createInitialState, stepSimulation } = require('./lib/simulation-engine')
const { buildSchema } = require('./lib/plugin-schema')
const { degToRad, radToDeg } = require('./lib/angles')
const { apparentWindFromTrue, trueWindFromDirection, windSnapshotFromObservation } = require('./lib/wind')
const { applyPersistedState, createStateStore, stateFromSimulation } = require('./lib/state-store')

const PLUGIN_ID = 'sailboat-simulator'
const PUBLISH_SOURCE = 'signalk-sailboat-simulator'

const INPUT_PATHS = {
  autopilotModePath: 'steering.autopilot.mode',
  targetHeadingTruePath: 'steering.autopilot.target.headingTrue',
  targetHeadingMagneticPath: 'steering.autopilot.target.headingMagnetic',
  targetHeadingMagneticFallbackPath: 'steering.autopilot.target',
  targetWindAngleApparentPath: 'steering.autopilot.target.windAngleApparent',
  magneticVariationPath: 'navigation.magneticVariation',
  performanceSpeedPath: 'performance.polarSpeed',
  distanceToShorePath: 'navigation.distanceToShore',
  shoreBearingTruePath: 'navigation.shore.bearingTrue'
}

const DEFAULT_OPTIONS = {
  tickIntervalMs: 1000,
  maxStepSeconds: 5,
  initialState: {
    latitude: 43.63278,
    longitude: 7.14287,
    headingTrueDeg: 180
  },
  wind: {
    trueWind: true,
    apparentWind: true,
    providerId: '',
    retryIntervalSeconds: 30,
    pollIntervalSeconds: 60,
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
    navigation: true
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
    options = normalizeOptions(pluginOptions || {})
    lastWeatherFetchAt = 0
    lastStateSaveAt = 0
    weatherSnapshot = null
    stateStore = createStateStore(app, PLUGIN_ID)
    state = createInitialState(options)
    if (options.persistence.enabled) {
      state = applyPersistedState(state, stateStore.load())
    }
    runtime = inactiveRuntime()

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
      autopilotMode: readString(INPUT_PATHS.autopilotModePath) || readString('steering.autopilot.state'),
      targetHeadingTrue: readNumber(INPUT_PATHS.targetHeadingTruePath),
      targetHeadingMagnetic: readFirstNumber([
        INPUT_PATHS.targetHeadingMagneticPath,
        INPUT_PATHS.targetHeadingMagneticFallbackPath
      ]),
      targetWindAngleApparent: readNumber(INPUT_PATHS.targetWindAngleApparentPath),
      magneticVariation: readNumber(INPUT_PATHS.magneticVariationPath),
      polarSpeed: readNumber(INPUT_PATHS.performanceSpeedPath),
      windSpeedTrue: weatherWind && weatherWind.speedTrue != null
        ? weatherWind.speedTrue
        : null,
      windDirectionTrue: weatherWind && weatherWind.directionTrue != null
        ? weatherWind.directionTrue
        : null,
      distanceToShore: readNumber(INPUT_PATHS.distanceToShorePath),
      shoreBearingTrue: readNumber(INPUT_PATHS.shoreBearingTruePath),
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
    if (publishNavigation()) {
      values.push({
        path: 'navigation.position',
        value: {
          latitude: state.position.latitude,
          longitude: state.position.longitude
        }
      })
      values.push({ path: 'navigation.headingTrue', value: state.headingTrue })
      values.push({ path: 'navigation.courseOverGroundTrue', value: state.courseOverGroundTrue })
      values.push({ path: 'navigation.speedOverGround', value: state.speedOverGround })
      values.push({ path: 'navigation.speedThroughWater', value: state.speedThroughWater })
      if (Number.isFinite(state.headingMagnetic)) {
        values.push({ path: 'navigation.headingMagnetic', value: state.headingMagnetic })
      }
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
    if (!publishTrueWind() && !publishApparentWind()) return []
    if (!Number.isFinite(inputs.windSpeedTrue) || !Number.isFinite(inputs.windDirectionTrue)) return []

    const windValues = []
    const angleTrueWater = trueWindFromDirection(inputs.windDirectionTrue, state.headingTrue)
    const apparent = apparentWindFromTrue({
      trueWindSpeed: inputs.windSpeedTrue,
      trueWindAngle: angleTrueWater,
      boatSpeed: state.speedThroughWater
    })

    if (publishTrueWind()) {
      windValues.push({ path: 'environment.wind.speedTrue', value: inputs.windSpeedTrue })
      windValues.push({ path: 'environment.wind.directionTrue', value: inputs.windDirectionTrue })
      if (Number.isFinite(angleTrueWater)) {
        windValues.push({ path: 'environment.wind.angleTrueWater', value: angleTrueWater })
      }
    }
    if (publishApparentWind() && apparent) {
      windValues.push({ path: 'environment.wind.speedApparent', value: apparent.speed })
      windValues.push({ path: 'environment.wind.angleApparent', value: apparent.angle })
    }

    return windValues
  }

  function publishNavigation () {
    return options.publishing.navigation !== false
  }

  function publishTrueWind () {
    return options.wind.trueWind !== false
  }

  function publishApparentWind () {
    return options.wind.apparentWind !== false
  }

  function publishesAnyWind () {
    return publishTrueWind() || publishApparentWind()
  }

  async function refreshWeather (now) {
    if (!publishesAnyWind()) return
    const intervalSeconds = freshWeatherWind()
      ? options.wind.pollIntervalSeconds
      : options.wind.retryIntervalSeconds
    if (now - lastWeatherFetchAt < intervalSeconds * 1000) return
    lastWeatherFetchAt = now

    const position = state && state.position ? state.position : options.initialState
    const weatherData = await fetchWeatherData(position, now)
    if (weatherData) {
      weatherSnapshot = {
        ...weatherData.snapshot,
        type: weatherData.type,
        providerId: weatherData.providerId,
        fetchedAt: now
      }
    }
  }

  async function fetchWeatherData (position, now) {
    const provider = getWeatherProvider()
    if (!provider) return null

    const observation = await fetchWeatherObservation(provider, position)
    const observationSnapshot = windSnapshotFromObservation(observation)
    if (observationSnapshot) {
      return {
        type: 'observation',
        providerId: provider.id,
        snapshot: observationSnapshot
      }
    }

    const forecast = await fetchClosestWeatherForecast(provider, position, now)
    if (forecast) {
      return {
        type: 'forecast',
        providerId: provider.id,
        snapshot: forecast.snapshot
      }
    }

    return null
  }

  function getWeatherProvider () {
    if (!app.weatherApi) return null

    const providerId = options.wind.providerId
    if (!providerId) {
      const defaultProviderId = currentWeatherProviderId()
      const registeredProvider = registeredWeatherProvider(defaultProviderId)
      if (registeredProvider) return registeredProvider

      return {
        id: defaultProviderId,
        methods: app.weatherApi
      }
    }

    const configuredProvider = registeredWeatherProvider(providerId)
    if (configuredProvider) return configuredProvider

    app.error && app.error(`Weather provider not found: ${providerId}`)
    return null
  }

  function registeredWeatherProvider (providerId) {
    const providers = app.weatherApi.weatherProviders
    if (providers && typeof providers.get === 'function' && providers.has(providerId)) {
      return {
        id: providerId,
        methods: providers.get(providerId).methods
      }
    }
    return null
  }

  async function fetchWeatherObservation (provider, position) {
    if (!provider.methods || typeof provider.methods.getObservations !== 'function') return null
    try {
      const observations = await provider.methods.getObservations(position)
      return Array.isArray(observations) && observations.length > 0 ? observations[0] : null
    } catch (error) {
      app.debug && app.debug(`Weather observations unavailable: ${error.message}`)
      return null
    }
  }

  async function fetchClosestWeatherForecast (provider, position, now) {
    if (!provider.methods || typeof provider.methods.getForecasts !== 'function') return null
    try {
      const forecasts = await provider.methods.getForecasts(position, 'point', { maxCount: 24 })
      if (!Array.isArray(forecasts) || forecasts.length === 0) return null

      return forecasts
        .map(forecast => ({
          snapshot: windSnapshotFromObservation(forecast),
          distanceMs: dateDistanceMs(forecast.date, now)
        }))
        .filter(forecast => forecast.snapshot && Number.isFinite(forecast.distanceMs))
        .sort((a, b) => a.distanceMs - b.distanceMs)[0] || null
    } catch (error) {
      app.debug && app.debug(`Weather forecasts unavailable: ${error.message}`)
      return null
    }
  }

  function freshWeatherWind () {
    if (!weatherSnapshot) return null
    if (weatherSnapshot.providerId !== currentWeatherProviderId()) return null
    const ageSeconds = (Date.now() - weatherSnapshot.fetchedAt) / 1000
    return ageSeconds <= options.wind.maxAgeSeconds ? weatherSnapshot : null
  }

  function currentWeatherProviderId () {
    if (options.wind.providerId) return options.wind.providerId
    const defaultProviderId = app.weatherApi && app.weatherApi.defaultProviderId
    return typeof defaultProviderId === 'string' && defaultProviderId.trim()
      ? defaultProviderId.trim()
      : 'default'
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
            type: weatherSnapshot.type,
            providerId: weatherSnapshot.providerId,
            description: weatherSnapshot.description
          }
        : { status: publishesAnyWind() ? 'missing' : 'disabled' },
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
        windDirectionTrue: valueStatus(inputs.windDirectionTrue)
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
        options: publicOptions()
      })
    })
  }

  function publicOptions () {
    return {
      wind: {
        trueWind: options.wind.trueWind,
        apparentWind: options.wind.apparentWind,
        providerId: options.wind.providerId,
        pollIntervalSeconds: options.wind.pollIntervalSeconds
      },
      grounding: options.grounding,
      persistence: { enabled: options.persistence.enabled },
      publishing: { navigation: options.publishing.navigation }
    }
  }
}

function normalizeOptions (options) {
  const normalized = mergeOptions(DEFAULT_OPTIONS, options || {})
  normalized.initialState.headingTrue = degToRad(normalized.initialState.headingTrueDeg)
  normalized.wind.providerId = typeof normalized.wind.providerId === 'string'
    ? normalized.wind.providerId.trim()
    : ''
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

function dateDistanceMs (date, now) {
  const time = new Date(date).getTime()
  if (!Number.isFinite(time)) return null
  return Math.abs(time - now)
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
