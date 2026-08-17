'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { degToRad, radToDeg } = require('../lib/angles')
const {
  createInitialState,
  deriveWindAngleTrueWater,
  stepSimulation
} = require('../lib/simulation-engine')
const { apparentWindFromTrue, windSnapshotFromObservation } = require('../lib/wind')
const { applyPersistedState, stateFromSimulation } = require('../lib/state-store')

test('simulation advances east at the polar speed', () => {
  const options = makeOptions({
    initialState: {
      latitude: 0,
      longitude: 0,
      headingTrue: degToRad(90)
    }
  })
  let state = createInitialState(options)
  state = stepSimulation(state, { polarSpeed: 10 }, options, 0)
  state = stepSimulation(state, { polarSpeed: 10 }, options, 1000)

  assert.equal(state.speedOverGround, 10)
  assert.ok(Math.abs(state.position.latitude) < 0.000001)
  assert.ok(state.position.longitude > 0.00008)
  assert.ok(state.position.longitude < 0.0001)
})

test('turn rate output rotates the simulated heading directly', () => {
  const options = makeOptions()
  let state = createInitialState(options)
  state = stepSimulation(state, { turnRate: degToRad(90), polarSpeed: 2 }, options, 0)
  state = stepSimulation(state, { turnRate: degToRad(90), polarSpeed: 2 }, options, 1000)

  assert.equal(radToDeg(state.headingTrue), 90)
  assert.equal(radToDeg(state.courseOverGroundTrue), 90)
  assert.ok(state.position.longitude > 0)
})

test('turn rate output is integrated without simulator-side rate limiting', () => {
  const options = makeOptions({ maxStepSeconds: 10 })
  let state = createInitialState(options)
  state = stepSimulation(state, { turnRate: degToRad(180), polarSpeed: 0 }, options, 0)
  state = stepSimulation(state, { turnRate: degToRad(180), polarSpeed: 0 }, options, 1000)
  assert.ok(Math.abs(radToDeg(state.headingTrue) - 180) < 0.000001)

  state = stepSimulation(state, { turnRate: degToRad(180), polarSpeed: 0 }, options, 2000)
  assert.ok(Math.abs(radToDeg(state.headingTrue) - 0) < 0.000001)
})

test('heading is held when turn rate output is missing', () => {
  const options = makeOptions({
    initialState: {
      latitude: 0,
      longitude: 0,
      headingTrue: degToRad(45)
    }
  })
  let state = createInitialState(options)
  state = stepSimulation(state, { polarSpeed: 0 }, options, 0)
  state = stepSimulation(state, { polarSpeed: 0 }, options, 1000)

  assert.equal(radToDeg(state.headingTrue), 45)
})

test('grounding protection stops movement inside the minimum shore distance', () => {
  const options = makeOptions({
    initialState: {
      latitude: 0,
      longitude: 0,
      headingTrue: degToRad(90)
    },
    grounding: {
      enabled: true,
      minimumDistanceToShore: 20
    }
  })
  let state = createInitialState(options)
  state = stepSimulation(state, { polarSpeed: 10, distanceToShore: 10 }, options, 0)
  state = stepSimulation(state, { polarSpeed: 10, distanceToShore: 10 }, options, 1000)

  assert.equal(state.speedOverGround, 0)
  assert.equal(state.speedThroughWater, 0)
  assert.equal(state.position.longitude, 0)
})

test('grounding protection stops movement when heading toward shore', () => {
  const options = makeOptions({
    initialState: {
      latitude: 0,
      longitude: 0,
      headingTrue: degToRad(90)
    },
    grounding: {
      enabled: true,
      minimumDistanceToShore: 20
    }
  })
  let state = createInitialState(options)
  state = stepSimulation(state, {
    polarSpeed: 10,
    distanceToShore: 10,
    shoreBearingTrue: degToRad(90)
  }, options, 0)
  state = stepSimulation(state, {
    polarSpeed: 10,
    distanceToShore: 10,
    shoreBearingTrue: degToRad(90)
  }, options, 1000)

  assert.equal(state.speedOverGround, 0)
  assert.equal(state.groundingProtectionActive, true)
  assert.equal(state.position.longitude, 0)
})

test('grounding protection allows movement when heading away from shore', () => {
  const options = makeOptions({
    initialState: {
      latitude: 0,
      longitude: 0,
      headingTrue: degToRad(270)
    },
    grounding: {
      enabled: true,
      minimumDistanceToShore: 20
    }
  })
  let state = createInitialState(options)
  state = stepSimulation(state, {
    polarSpeed: 10,
    distanceToShore: 10,
    shoreBearingTrue: degToRad(90)
  }, options, 0)
  state = stepSimulation(state, {
    polarSpeed: 10,
    distanceToShore: 10,
    shoreBearingTrue: degToRad(90)
  }, options, 1000)

  assert.equal(state.speedOverGround, 10)
  assert.equal(state.groundingProtectionActive, false)
  assert.ok(state.position.longitude < -0.00008)
})

test('true wind angle is relative to heading and negative to port', () => {
  assert.equal(radToDeg(deriveWindAngleTrueWater(degToRad(270), degToRad(0))), -90)
  assert.equal(radToDeg(deriveWindAngleTrueWater(degToRad(90), degToRad(0))), 90)
})

test('apparent wind includes boat speed along the bow axis', () => {
  const headwind = apparentWindFromTrue({
    trueWindSpeed: 10,
    trueWindAngle: 0,
    boatSpeed: 5
  })
  assert.equal(headwind.speed, 15)
  assert.equal(headwind.angle, 0)

  const tailwind = apparentWindFromTrue({
    trueWindSpeed: 10,
    trueWindAngle: Math.PI,
    boatSpeed: 5
  })
  assert.ok(Math.abs(tailwind.speed - 5) < 0.000001)
  assert.ok(Math.abs(Math.abs(tailwind.angle) - Math.PI) < 0.000001)
})

test('weather observations are converted to simulator wind snapshots', () => {
  const snapshot = windSnapshotFromObservation({
    date: '2026-05-31T21:00:00.000Z',
    description: 'Overcast',
    wind: {
      speedTrue: 2.45,
      directionTrue: 4.5
    }
  })

  assert.equal(snapshot.speedTrue, 2.45)
  assert.equal(snapshot.directionTrue, 4.5)
  assert.equal(snapshot.observedAt, '2026-05-31T21:00:00.000Z')
})

test('persisted simulator state restores position and heading', () => {
  const options = makeOptions()
  let state = createInitialState(options)
  state = stepSimulation(state, { turnRate: degToRad(90), polarSpeed: 10 }, options, 0)
  state = stepSimulation(state, { turnRate: degToRad(90), polarSpeed: 10 }, options, 1000)

  const persisted = stateFromSimulation(state)
  const restored = applyPersistedState(createInitialState(options), persisted)

  assert.equal(restored.position.latitude, state.position.latitude)
  assert.equal(restored.position.longitude, state.position.longitude)
  assert.equal(restored.headingTrue, state.headingTrue)
  assert.equal(restored.updatedAt, null)
})

test('integration step is capped after long pauses', () => {
  const options = makeOptions({ maxStepSeconds: 2 })
  let state = createInitialState(options)
  state = stepSimulation(state, { polarSpeed: 5 }, options, 0)
  state = stepSimulation(state, { polarSpeed: 5 }, options, 10_000)

  assert.ok(state.position.latitude > 0.00008)
  assert.ok(state.position.latitude < 0.0001)
})

function makeOptions (override = {}) {
  return Object.assign({
    maxStepSeconds: 5,
    initialState: {
      latitude: 0,
      longitude: 0,
      headingTrue: degToRad(0)
    },
    fallback: {
      speedThroughWater: 0
    }
  }, override)
}
