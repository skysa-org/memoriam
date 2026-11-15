---
'@memoriam/api': minor
'@memoriam/web': minor
---

The kit's change relay, connect gate and connect codes, in memoriam. An operator can turn on the
relay with `RELAY = "true"`: the Worker binds the kit's `ConnectionRelay` as `RELAY_HUB`, declared
in `wrangler.toml`, and refuses to boot where `RELAY` is on and the binding is gone. A device that
has sent its changes then says so, and the account's other devices sync within a second or two;
polling goes on as before. `@memoriam/api` now offers the entitlement seam's types for an
operator's own entry, and `@memoriam/api/relay` the relay's Durable Object. Where that entry's
policy has a gate, Settings shows its message and link where the connect buttons are, with a field
for the code it asks for, which the policy is asked about as it is used and which is sent with each
connect while it is held. A connect the policy refuses is said by the kind of no it gave, and a
library the policy stops minting tokens for says why, with the policy's reason and the gate's
link, and offers to connect it again behind the gate. `docs/self-hosting.md` has "Restricting who
can sync" and "Instant updates between devices". A deployment that set `RELAY` to `true`, which
until now did nothing, needs the `RELAY_HUB` binding the stock `wrangler.toml` declares, or the
Worker will not boot. `pnpm dev` passes the relay's socket to `wrangler dev`.
