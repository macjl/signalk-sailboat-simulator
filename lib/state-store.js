'use strict'

const fs = require('fs')
const path = require('path')

function createStateStore (app, pluginId) {
  const baseDir = app && typeof app.getDataDirPath === 'function'
    ? app.getDataDirPath()
    : path.join(process.cwd(), 'plugin-config-data')
  const dirPath = baseDir.endsWith(pluginId) ? baseDir : path.join(baseDir, pluginId)
  const filePath = path.join(dirPath, 'runtime-state.json')

  return {
    load,
    save,
    filePath
  }

  function load () {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      return isValidPersistedState(parsed) ? parsed : null
    } catch (error) {
      if (error.code !== 'ENOENT' && app && app.debug) {
        app.debug(`Sailboat simulator state load failed: ${error.message}`)
      }
      return null
    }
  }

  function save (state) {
    if (!isValidPersistedState(state)) return false
    fs.mkdirSync(dirPath, { recursive: true })
    const tmpPath = `${filePath}.tmp`
    fs.writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`)
    fs.renameSync(tmpPath, filePath)
    return true
  }
}

function stateFromSimulation (state) {
  if (!state || !state.position) return null
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    position: {
      latitude: state.position.latitude,
      longitude: state.position.longitude
    },
    headingTrue: state.headingTrue,
    headingMagnetic: state.headingMagnetic,
    magneticVariation: state.magneticVariation,
    courseOverGroundTrue: state.courseOverGroundTrue,
    speedOverGround: state.speedOverGround,
    speedThroughWater: state.speedThroughWater
  }
}

function applyPersistedState (state, persisted) {
  if (!state || !isValidPersistedState(persisted)) return state
  return {
    ...state,
    position: {
      latitude: persisted.position.latitude,
      longitude: persisted.position.longitude
    },
    headingTrue: numberOr(persisted.headingTrue, state.headingTrue),
    headingMagnetic: numberOr(persisted.headingMagnetic, state.headingMagnetic),
    magneticVariation: numberOr(persisted.magneticVariation, state.magneticVariation),
    courseOverGroundTrue: numberOr(persisted.courseOverGroundTrue, state.courseOverGroundTrue),
    speedOverGround: numberOr(persisted.speedOverGround, 0),
    speedThroughWater: numberOr(persisted.speedThroughWater, 0),
    updatedAt: null
  }
}

function isValidPersistedState (state) {
  return Boolean(
    state &&
    state.position &&
    Number.isFinite(state.position.latitude) &&
    Number.isFinite(state.position.longitude)
  )
}

function numberOr (value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

module.exports = {
  applyPersistedState,
  createStateStore,
  stateFromSimulation
}
