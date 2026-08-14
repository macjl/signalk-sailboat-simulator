# Changelog

## [0.1.0] - 2026-08-14

- Initial public release.
- Add a testable sailing simulation engine driven by autopilot targets and `performance.polarSpeed`.
- Read true wind from the Signal K Weather API at the simulated position, with observation-first and closest-forecast fallback.
- Publish true and apparent wind values for polar performance calculations.
- Add optional grounding protection from `navigation.distanceToShore` and `navigation.shore.bearingTrue`.
- Add persisted runtime state so the simulated vessel resumes after Signal K restarts.
- Keep configuration focused on initial state, wind publishing, navigation publishing, grounding protection and persistence.
- Recommend the companion plugins used for a complete simulation setup.
