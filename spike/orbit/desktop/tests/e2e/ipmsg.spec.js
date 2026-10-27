const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { tmpUserDataDir, launchApp } = require('./helpers');
const { IpmsgTransport } = require('../../lib/ipmsg/dist/index.js');

let app;
let page;
let transport;
let receiveDir;

test.beforeEach(async () => {
  ({ app, page } = await launchApp(tmpUserDataDir('ipmsg')));
  await page.waitForFunction(() => {
    const user = window.store && window.store.getState().currentUser;
    return !!(user && user.userId);
  }, { timeout: 15000 });
});

test.afterEach(async () => {
  if (transport) {
    await transport.stop().catch(() => {});
    transport = null;
  }
  if (app) await app.close().catch(() => {});
  if (receiveDir) {
    fs.rmSync(receiveDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    receiveDir = null;
  }
});

test('discovers, displays and exchanges text with an IPMSG peer', async () => {
  const identity = await page.evaluate(() => window.store.getState().currentUser);
  receiveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-ipmsg-e2e-'));

  const texts = [];
  transport = new IpmsgTransport(
    {
      name: 'IPMSG Test Peer',
      account: 'ipmsg-test',
      host: 'ipmsg-test-host',
      port: 2426,
      bindAddr: '127.0.0.1',
      seeds: ['127.0.0.1:2425'],
      broadcastInterval: 3600,
      receiveDir,
      autoAccept: true
    },
    {
      onPeers: () => {},
      onText: (text) => texts.push(text),
      onTextStatus: () => {},
      onFile: () => {},
      onLog: () => {},
      onError: (error) => { throw error; }
    }
  );
  await transport.start();

  const appPeer = await waitFor(() => transport.getPeers().find((peer) => peer.account === identity.userId) || null);
  expect(appPeer).toBeTruthy();

  const ipmsgFriend = await (await page.waitForFunction(() => {
    const friend = window.store.getState().friends.find((f) => f.transport === 'ipmsg' && f.ipmsgAccount === 'ipmsg-test');
    return friend ? friend.userId : null;
  }, { timeout: 15000 })).jsonValue();
  expect(ipmsgFriend).toBe('ipmsg:127.0.0.1|ipmsg-test');

  transport.sendText(appPeer.key, 'hello from ipmsg');
  await page.waitForFunction(() => {
    const messages = Object.values(window.store.getState().messages).flat();
    return messages.some((message) => message.text === 'hello from ipmsg');
  }, { timeout: 15000 });

  await page.evaluate(() => {
    return window.orbitAPI.ipmsgSendText('127.0.0.1|ipmsg-test', 'hello from orbit');
  });
  await expect.poll(() => texts.some((item) => item.text === 'hello from orbit'), { timeout: 15000 }).toBe(true);
});

async function waitFor(probe, timeout = 15000) {
  const started = Date.now();
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() - started > timeout) throw new Error('waitFor timeout');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
