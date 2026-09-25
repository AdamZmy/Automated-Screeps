# Offline planner fixtures

These fixtures are committed so `verify-planner.cjs` works in a fresh checkout
without Steam, a live API response, the ignored `state/` directory, or `/tmp`
files. They are historical regression inputs, not current game observations.

- `room-plans-before.json`: the `plan` field only from each of the 11 rooms in
  the previously captured local `state/room-plans-before.json`. Every plan field,
  coordinate, road route, ordering, and creation tick is retained without
  modification so the test can compare the static archive losslessly against an
  independent golden fixture. Live economy and economy-control fields were
  omitted; the test uses synthetic metadata for the ownership-preservation check.
- `terrain-W21N26.json`: only the room name and 2,500-character terrain string
  from the previously captured official terrain response. Response IDs and other
  API envelope fields were omitted. Sources, controller, mineral, and spawn
  positions remain the fixed test inputs in `verify-planner.cjs`.

No account credential, live telemetry, creep state, or HTTP authentication data
is included. The tests never refresh these files from the API. When deliberately
changing an archived plan, review the golden fixture and archive change together;
do not regenerate the fixture from `plans.js`, which would defeat the independent
lossless check.

Initial fixture SHA-256:

```text
c58a831ac350f429c23c7612dab5901c9ab98dea4162a5aa4125fd8b8bb8ae17  room-plans-before.json
c17c7a718c300371dd4af133e08d41d819fe4c562a244c6fe70253dcb80be1a7  terrain-W21N26.json
```
