'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const createPlugin = require('../index')
const { degToRad } = require('../lib/angles')

test('does not fall back to self-published wind paths when Weather API is enabled', async () => {
  const messages = []
  const app = makeApp({
    selfPaths: windPaths(),
    observations: [],
    messages
  })
  const plugin = createPlugin(app)

  plugin.start(makeOptions({ weather: { enabled: true } }))
  await waitForTick()
  plugin.stop()

  assert.deepEqual(publishedWindValues(messages), [])
})

test('uses configured wind input paths when Weather API is disabled', async () => {
  const messages = []
  const app = makeApp({ selfPaths: windPaths(), messages })
  const plugin = createPlugin(app)

  plugin.start(makeOptions({ weather: { enabled: false } }))
  await waitForTick()
  plugin.stop()

  const values = publishedWindValues(messages)
  assert.equal(values.find(value => value.path === 'environment.wind.speedTrue')?.value, 4)
  assert.equal(values.find(value => value.path === 'environment.wind.directionTrue')?.value, degToRad(180))
})

test('uses the configured Weather API provider when providerId is set', async () => {
  const messages = []
  const app = makeApp({
    providers: new Map([
      ['preferred-weather', {
        methods: providerMethods({
          observations: [weatherData({ speedTrue: 5, directionTrue: degToRad(220) })]
        })
      }]
    ]),
    messages
  })
  const plugin = createPlugin(app)

  plugin.start(makeOptions({ weather: { enabled: true, providerId: 'preferred-weather' } }))
  await waitForTick()
  plugin.stop()

  const values = publishedWindValues(messages)
  assert.equal(values.find(value => value.path === 'environment.wind.speedTrue')?.value, 5)
  assert.equal(values.find(value => value.path === 'environment.wind.directionTrue')?.value, degToRad(220))
})

test('reports an unknown configured provider without stopping simulation', async () => {
  const messages = []
  const errors = []
  const app = makeApp({ providers: new Map(), messages, errors })
  const plugin = createPlugin(app)

  plugin.start(makeOptions({ weather: { enabled: true, providerId: 'missing-provider' } }))
  await waitForTick()
  plugin.stop()

  assert.deepEqual(errors, ['Weather provider not found: missing-provider'])
  assert.ok(publishedValues(messages).some(value => value.path === 'navigation.position'))
})

test('follows the current default Weather API provider when providerId is empty', async () => {
  const messages = []
  const providers = new Map([
    ['open-meteo', { methods: providerMethods({ observations: [weatherData({ speedTrue: 5, directionTrue: degToRad(170) })] }) }],
    ['gfs-025', { methods: providerMethods({ forecasts: [weatherData({ speedTrue: 12, directionTrue: degToRad(275) })] }) }]
  ])
  const app = makeApp({ defaultProviderId: 'open-meteo', providers, messages })
  const plugin = createPlugin(app)

  plugin.start(makeOptions({
    tickIntervalMs: 20,
    weather: { enabled: true, retryIntervalSeconds: 0.03, pollIntervalSeconds: 0.03 }
  }))
  await waitForTick()
  app.weatherApi.defaultProviderId = 'gfs-025'
  app.weatherApi.getObservations = providers.get('gfs-025').methods.getObservations
  app.weatherApi.getForecasts = providers.get('gfs-025').methods.getForecasts
  await wait(80)
  plugin.stop()

  const values = publishedWindValues(messages)
  assert.equal(values.findLast(value => value.path === 'environment.wind.speedTrue')?.value, 12)
  assert.equal(values.findLast(value => value.path === 'environment.wind.directionTrue')?.value, degToRad(275))
})

test('uses the closest forecast when observations are unavailable', async () => {
  const messages = []
  const now = Date.now()
  const app = makeApp({
    forecasts: [
      weatherData({ date: new Date(now + 2 * 60 * 60 * 1000).toISOString(), speedTrue: 9, directionTrue: degToRad(40) }),
      weatherData({ date: new Date(now + 20 * 60 * 1000).toISOString(), speedTrue: 6, directionTrue: degToRad(130) }),
      weatherData({ date: new Date(now - 90 * 60 * 1000).toISOString(), speedTrue: 4, directionTrue: degToRad(280) })
    ],
    messages
  })
  const plugin = createPlugin(app)

  plugin.start(makeOptions({ weather: { enabled: true } }))
  await waitForTick()
  plugin.stop()

  const values = publishedWindValues(messages)
  assert.equal(values.find(value => value.path === 'environment.wind.speedTrue')?.value, 6)
  assert.equal(values.find(value => value.path === 'environment.wind.directionTrue')?.value, degToRad(130))
})

test('continues simulation when both observation and forecast providers throw', async () => {
  const messages = []
  const app = makeApp({ messages })
  app.weatherApi.getObservations = async () => { throw new Error('observations unavailable') }
  app.weatherApi.getForecasts = async () => { throw new Error('forecasts unavailable') }
  const plugin = createPlugin(app)

  plugin.start(makeOptions({ weather: { enabled: true } }))
  await waitForTick()
  plugin.stop()

  assert.ok(publishedValues(messages).some(value => value.path === 'navigation.position'))
  assert.deepEqual(publishedWindValues(messages), [])
})

test('retries weather quickly while no weather snapshot is available', async () => {
  const messages = []
  let forecastCalls = 0
  const app = makeApp({ messages })
  app.weatherApi.getForecasts = async () => {
    forecastCalls += 1
    return forecastCalls < 2
      ? []
      : [weatherData({ speedTrue: 7, directionTrue: degToRad(260) })]
  }
  const plugin = createPlugin(app)

  plugin.start(makeOptions({
    tickIntervalMs: 20,
    weather: { enabled: true, retryIntervalSeconds: 0.03, pollIntervalSeconds: 600 }
  }))
  await wait(90)
  plugin.stop()

  assert.ok(forecastCalls >= 2)
  const values = publishedWindValues(messages)
  assert.equal(values.find(value => value.path === 'environment.wind.speedTrue')?.value, 7)
})

function makeOptions (override = {}) {
  return {
    enabled: true,
    tickIntervalMs: override.tickIntervalMs || 60_000,
    maxStepSeconds: 5,
    initialState: { latitude: 43.63278, longitude: 7.14287, headingTrueDeg: 270 },
    weather: override.weather,
    persistence: { enabled: false },
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
}

function makeApp ({
  selfPaths = { 'performance.polarSpeed.value': 1 },
  observations = [],
  forecasts = [],
  providers,
  defaultProviderId,
  messages,
  errors = []
}) {
  return {
    getSelfPath: path => selfPaths[path],
    handleMessage: (_pluginId, message) => { messages.push(message) },
    setPluginStatus: () => {},
    error: message => { errors.push(message) },
    weatherApi: {
      defaultProviderId,
      weatherProviders: providers,
      ...providerMethods({ observations, forecasts })
    }
  }
}

function providerMethods ({ observations = [], forecasts = [] }) {
  return {
    getObservations: async () => observations,
    getForecasts: async () => forecasts
  }
}

function windPaths () {
  return {
    'environment.wind.speedTrue.value': 4,
    'environment.wind.directionTrue.value': degToRad(180),
    'performance.polarSpeed.value': 1
  }
}

function weatherData ({ date = '2026-05-31T21:00:00.000Z', speedTrue, directionTrue, gust = null }) {
  return { date, description: 'Weather', wind: { speedTrue, directionTrue, gust } }
}

function publishedValues (messages) {
  return messages.flatMap(message => message.updates.flatMap(update => update.values))
}

function publishedWindValues (messages) {
  return publishedValues(messages).filter(value => value.path.startsWith('environment.wind.'))
}

function waitForTick () {
  return wait(20)
}

function wait (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
