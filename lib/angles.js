'use strict'

const TWO_PI = Math.PI * 2

function degToRad (degrees) {
  return degrees * Math.PI / 180
}

function radToDeg (radians) {
  return radians * 180 / Math.PI
}

function wrap360Rad (radians) {
  const wrapped = radians % TWO_PI
  return wrapped < 0 ? wrapped + TWO_PI : wrapped
}

function wrap180Rad (radians) {
  const wrapped = wrap360Rad(radians + Math.PI) - Math.PI
  return wrapped === -Math.PI ? Math.PI : wrapped
}

module.exports = {
  degToRad,
  radToDeg,
  wrap180Rad,
  wrap360Rad
}
