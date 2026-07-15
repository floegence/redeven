# Redeven OKF Update Log

## 2026-07-16
* **Fix**: Documented Floret v0.7.0 running live projections so Flower tool activity is visible before turn completion.
* **Refactor**: Moved Floret projection, stream, activity, event, and availability validation ownership to Floret public validators while retaining only Redeven run identity association and Flower block mapping.

## 2026-07-15
* **Breaking**: Documented Flower live `turn_projection_unavailable` decorations and the strict timeline decoration union shared by bootstrap, history, and replacement snapshots.
* **Breaking**: Advanced Runtime Service compatibility epoch to 7 with matched Desktop and Runtime minimum versions at `v0.9.0`.
* **Update**: Documented published Floret title ownership and typed lifecycle-reason contracts.
* **Update**: Added persistent Flower thread deletion coordination, fixed replay order, restart recovery, and DELETE operation outcomes.
