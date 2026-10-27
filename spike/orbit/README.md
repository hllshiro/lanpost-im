# Orbit desktop spike

Source: [D4niel-dev/Orbit-beta](https://github.com/D4niel-dev/Orbit-beta), commit `e947539` (v0.9.0-beta), MIT.

Phase 0: Orbit desktop + minimal IPMSG transport.
No mobile, no i18n, no data migration.

Run:

```bash
cd spike/orbit/desktop
npm install
npx electron-rebuild -f -w better-sqlite3
npm start
```

## Phase 0 result (2026-10-27)

Validated on Windows:

- Orbit desktop starts with the original Orbit UI.
- IPMSG peer discovery works through UDP 2425; an IPMSG contact appears as
  `ipmsg:<ip>|<account>` with an `IPMSG` badge.
- Bidirectional text works; the Orbit contact stores and renders the message.
- Bidirectional single-file transfer works; incoming IPMSG files are
  auto-accepted into `Downloads/Orbit IPMSG` and appear as Orbit attachment
  messages.
- Orbit-only message actions (reactions/edit) are hidden for IPMSG contacts;
  IPMSG contacts are excluded from the group member picker.
- Existing Orbit navigation E2E tests still pass.

Commands used:

```bash
npm run test:ipmsg
node tests/unit/ipmsg-bridge.test.js
node tests/unit/ipmsg-map.test.js
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron tests/unit/ipmsg-store.test.js
npx playwright test tests/e2e/navigation.spec.js tests/e2e/ipmsg.spec.js tests/e2e/ipmsg-capabilities.spec.js
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --win --dir --config.win.signAndEditExecutable=false
```

Known limitations / issues:

- Linux runtime smoke was not completed locally: the WSL Ubuntu environment
  timed out downloading the Electron binary. The Linux build target remains in
  `electron-builder.yml`; it needs CI/a real Linux host.
- Full NSIS packaging currently fails on this Windows machine while extracting
  `winCodeSign` symlinks without the required privilege. `--dir` packaging and
  launching the unpacked app succeeded.
- IPMSG files are auto-accepted in Phase 0; manual accept is deferred.
- IPMSG contacts do not participate in groups.
- Full Chinese i18n is deferred to Phase 1; Orbit UI remains English.
- `docs/3rd/LANChat`, `docs/3rd/blip`, and `docs/3rd/Orbit-beta` are local
  research clones and are git-ignored.
