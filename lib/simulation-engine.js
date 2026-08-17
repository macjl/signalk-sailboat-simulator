'use strict'

const { wrap180Rad, wrap360Rad } = require('./angles')
const { destinationPoint } = require('./geo')
const { trueWindFromDirection } = require('./wind')

function createInitialState (options) {
  return {
    position: {
      latitude: options.initialState.latitude,
      longitude: options.initialState.longitude
    },
    headingTrue: wrap360Rad(options.initialState.headingTrue),
    courseOverGroundTrue: wrap360Rad(options.initialState.headingTrue),
    speedOverGround: 0,
    speedThroughWater: 0,
    groundingProtectionActive: false,
    windAngleTrueWater: null,
    updatedAt: null
  }
}

function stepSimulation (state, inputs, options, now) {
  const previousUpdatedAt = state.updatedAt == null ? now : state.updatedAt
  const rawStepSeconds = Math.max(0, (now - previousUpdatedAt) / 1000)
  const stepSeconds = Math.min(rawStepSeconds, options.maxStepSeconds)
  const requestedSpeedThroughWater = Math.max(0, firstFinite(
    inputs.polarSpeed,
    options.fallback.speedThroughWater,
    0
  ))
  const turnRate = Number.isFinite(inputs.turnRate) ? inputs.turnRate : 0
  const headingTrue = wrap360Rad(state.headingTrue + turnRate * stepSeconds)
  const groundingProtectionActive = shouldStopForGrounding(inputs, options, headingTrue)
  const speedThroughWater = groundingProtectionActive
    ? 0
    : requestedSpeedThroughWater
  const distanceMeters = speedThroughWater * stepSeconds
  const position = distanceMeters > 0
    ? destinationPoint(state.position, headingTrue, distanceMeters)
    : state.position

  return {
    position,
    headingTrue: wrap360Rad(headingTrue),
    courseOverGroundTrue: wrap360Rad(headingTrue),
    speedOverGround: speedThroughWater,
    speedThroughWater,
    groundingProtectionActive,
    windAngleTrueWater: deriveWindAngleTrueWater(inputs.windDirectionTrue, headingTrue),
    updatedAt: now
  }
}

function shouldStopForGrounding (inputs, options, headingTrue) {
  const tooClose = Boolean(
    options.grounding &&
    options.grounding.enabled &&
    Number.isFinite(inputs.distanceToShore) &&
    inputs.distanceToShore <= options.grounding.minimumDistanceToShore
  )
  if (!tooClose) return false
  if (!Number.isFinite(inputs.shoreBearingTrue) || !Number.isFinite(headingTrue)) return true

  return !isHeadingAwayFromShore(headingTrue, inputs.shoreBearingTrue)
}

function isHeadingAwayFromShore (headingTrue, shoreBearingTrue) {
  return Math.abs(wrap180Rad(headingTrue - shoreBearingTrue)) > Math.PI / 2
}

function deriveWindAngleTrueWater (windDirectionTrue, headingTrue) {
  return trueWindFromDirection(windDirectionTrue, headingTrue)
}

function firstFinite (...values) {
  return values.find(Number.isFinite)
}

module.exports = {
  createInitialState,
  deriveWindAngleTrueWater,
  stepSimulation
}
