'use strict'

const EARTH_RADIUS_METERS = 6371008.8

function destinationPoint (position, bearingRad, distanceMeters) {
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS
  const lat1 = toRad(position.latitude)
  const lon1 = toRad(position.longitude)

  const sinLat1 = Math.sin(lat1)
  const cosLat1 = Math.cos(lat1)
  const sinDistance = Math.sin(angularDistance)
  const cosDistance = Math.cos(angularDistance)

  const lat2 = Math.asin(
    sinLat1 * cosDistance +
    cosLat1 * sinDistance * Math.cos(bearingRad)
  )
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearingRad) * sinDistance * cosLat1,
    cosDistance - sinLat1 * Math.sin(lat2)
  )

  return {
    latitude: toDeg(lat2),
    longitude: normalizeLongitude(toDeg(lon2))
  }
}

function normalizeLongitude (longitude) {
  return ((longitude + 540) % 360) - 180
}

function toRad (degrees) {
  return degrees * Math.PI / 180
}

function toDeg (radians) {
  return radians * 180 / Math.PI
}

module.exports = {
  EARTH_RADIUS_METERS,
  destinationPoint
}
