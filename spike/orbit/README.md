# Orbit desktop spike

Source: [D4niel-dev/Orbit-beta](https://github.com/D4niel-dev/Orbit-beta), commit `e947539` (v0.9.0-beta), MIT.

Phase 0: Orbit desktop + minimal IPMSG transport.
No mobile, no i18n, no data migration.

Run:

```bash
cd spike/orbit/desktop
npm install
npm start
```

The optional profile-frame PNGs under `desktop/src/icons/frames/` are kept locally
but excluded from git to keep the spike branch small; they are not part of Phase 0.
