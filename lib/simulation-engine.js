'use strict'

const { wrap180Rad, wrap360Rad } = require('./angles')
const { destinationPoint } = require('./geo')
const { apparentWindFromTrue, trueWindFromDirection } = require('./wind')

function createInitialState (options) {
  return {
    position: {
      latitude: options.initialState.latitude,
      longitude: options.initialState.longitude
    },
    headingTrue: wrap360Rad(options.initialState.headingTrue),
    headingMagnetic: null,
    magneticVariation: null,
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
  const windSteerHeadingTrue = inputs.autopilotMode === 'wind'
    ? trueHeadingFromApparentWind({
        targetWindAngleApparent: inputs.targetWindAngleApparent,
        windDirectionTrue: inputs.windDirectionTrue,
        trueWindSpeed: inputs.windSpeedTrue,
        boatSpeed: requestedSpeedThroughWater
      })
    : null
  const targetHeadingTrue = firstFinite(
    windSteerHeadingTrue,
    inputs.targetHeadingTrue,
    trueHeadingFromMagnetic(inputs.targetHeadingMagnetic, inputs.magneticVariation),
    state.headingTrue,
    options.initialState.headingTrue
  )
  const headingTrue = approachHeading(
    state.headingTrue,
    targetHeadingTrue,
    turnRateRadPerSecond(options),
    stepSeconds
  )
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
    headingMagnetic: magneticHeadingFromTrue(headingTrue, inputs.magneticVariation),
    magneticVariation: Number.isFinite(inputs.magneticVariation) ? inputs.magneticVariation : null,
    courseOverGroundTrue: wrap360Rad(headingTrue),
    speedOverGround: speedThroughWater,
    speedThroughWater,
    groundingProtectionActive,
    windAngleTrueWater: deriveWindAngleTrueWater(inputs.windDirectionTrue, headingTrue),
    updatedAt: now
  }
}

function approachHeading (currentHeading, targetHeading, maxTurnRate, stepSeconds) {
  if (!Number.isFinite(currentHeading) || !Number.isFinite(targetHeading)) return targetHeading
  if (!Number.isFinite(maxTurnRate)) return wrap360Rad(targetHeading)
  if (maxTurnRate <= 0 || stepSeconds <= 0) return wrap360Rad(currentHeading)

  const delta = wrap180Rad(targetHeading - currentHeading)
  const maxDelta = maxTurnRate * stepSeconds
  if (Math.abs(delta) <= maxDelta) return wrap360Rad(targetHeading)

  return wrap360Rad(currentHeading + Math.sign(delta) * maxDelta)
}

function turnRateRadPerSecond (options) {
  if (!options.dynamics) return Infinity
  if (Number.isFinite(options.dynamics.maxTurnRate)) return Math.max(0, options.dynamics.maxTurnRate)
  if (Number.isFinite(options.dynamics.maxTurnRateDegPerSecond)) {
    return Math.max(0, options.dynamics.maxTurnRateDegPerSecond) * Math.PI / 180
  }
  return Infinity
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

function trueHeadingFromMagnetic (headingMagnetic, magneticVariation) {
  if (!Number.isFinite(headingMagnetic) || !Number.isFinite(magneticVariation)) return null
  return wrap360Rad(headingMagnetic + magneticVariation)
}

function magneticHeadingFromTrue (headingTrue, magneticVariation) {
  if (!Number.isFinite(headingTrue) || !Number.isFinite(magneticVariation)) return null
  return wrap360Rad(headingTrue - magneticVariation)
}

function trueHeadingFromApparentWind ({
  targetWindAngleApparent,
  windDirectionTrue,
  trueWindSpeed,
  boatSpeed
}) {
  if (
    !Number.isFinite(targetWindAngleApparent) ||
    !Number.isFinite(windDirectionTrue) ||
    !Number.isFinite(trueWindSpeed)
  ) return null

  const trueWindAngle = trueWindAngleFromApparent({
    targetWindAngleApparent,
    trueWindSpeed,
    boatSpeed: Number.isFinite(boatSpeed) ? boatSpeed : 0
  })
  if (!Number.isFinite(trueWindAngle)) return null

  return wrap360Rad(windDirectionTrue - trueWindAngle)
}

function trueWindAngleFromApparent ({
  targetWindAngleApparent,
  trueWindSpeed,
  boatSpeed
}) {
  const awa = wrap180Rad(targetWindAngleApparent)
  const tws = Math.max(0, trueWindSpeed)
  const stw = Math.max(0, Number.isFinite(boatSpeed) ? boatSpeed : 0)

  if (tws === 0) return null
  if (stw === 0) return awa

  const crosswind = stw * Math.sin(awa)
  const discriminant = (tws * tws) - (crosswind * crosswind)
  if (discriminant < 0) return awa

  const apparentSpeed = (stw * Math.cos(awa)) + Math.sqrt(discriminant)
  if (apparentSpeed <= 0) return awa

  const trueForward = (apparentSpeed * Math.cos(awa)) - stw
  const trueStarboard = apparentSpeed * Math.sin(awa)
  const twa = Math.atan2(trueStarboard, trueForward)

  const apparent = apparentWindFromTrue({
    trueWindSpeed: tws,
    trueWindAngle: twa,
    boatSpeed: stw
  })
  if (!apparent) return awa

  return twa
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
  magneticHeadingFromTrue,
  stepSimulation,
  trueHeadingFromApparentWind,
  trueHeadingFromMagnetic
}
