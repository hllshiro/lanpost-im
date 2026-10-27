# Minimal IPMSG transport

Extracted from the lanpost 0.1.x IPMSG implementation for the Orbit Phase 0 spike.

- `IpmsgTransport` composes `ProtocolEngine` and `FileManager`.
- Scope: discovery, 1:1 text, 1:1 file. Extra protocol modules are present
  because they are reused from the tested implementation; they are not wired
  into the Orbit bridge.
- Build: `npm run build:ipmsg` (TypeScript -> CommonJS `dist/`).
- Test: `npm run test:ipmsg`.

The generated `dist/` directory is intentionally git-ignored; build scripts run
`build:ipmsg` before packaging.
