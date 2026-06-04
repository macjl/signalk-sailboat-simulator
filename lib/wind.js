'use strict'

const { wrap180Rad } = require('./angles')

function trueWindFromDirection (windDirectionTrue, headingTrue) {
  if (!Number.isFinite(windDirectionTrue) || !Number.isFinite(headingTrue)) return null
  return wrap180Rad(windDirectionTrue - headingTrue)
}

function apparentWindFromTrue ({ trueWindSpeed, trueWindAngle, boatSpeed }) {
  if (!Number.isFinite(trueWindSpeed) || !Number.isFinite(trueWindAngle)) return null

  const speed = Number.isFinite(boatSpeed) ? boatSpeed : 0
  const forward = trueWindSpeed * Math.cos(trueWindAngle) + speed
  const starboard = trueWindSpeed * Math.sin(trueWindAngle)

  return {
    speed: Math.hypot(forward, starboard),
    angle: wrap180Rad(Math.atan2(starboard, forward))
  }
}

function windSnapshotFromObservation (observation) {
  if (!observation || !observation.wind) return null

  const speedTrue = observation.wind.speedTrue
  const directionTrue = observation.wind.directionTrue
  if (!Number.isFinite(speedTrue) || !Number.isFinite(directionTrue)) return null

  return {
    speedTrue,
    directionTrue,
    gust: Number.isFinite(observation.wind.gust) ? observation.wind.gust : null,
    observedAt: observation.date || null,
    description: observation.description || ''
  }
}

module.exports = {
  apparentWindFromTrue,
  trueWindFromDirection,
  windSnapshotFromObservation
}
