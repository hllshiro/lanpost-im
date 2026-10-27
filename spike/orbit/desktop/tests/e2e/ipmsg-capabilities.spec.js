const { test, expect } = require('@playwright/test');
const { tmpUserDataDir, launchApp } = require('./helpers');

let app;

test.afterEach(async () => {
  if (app) await app.close().catch(() => {});
});

test('marks IPMSG contacts and hides Orbit-only actions', async () => {
  let page;
  ({ app, page } = await launchApp(tmpUserDataDir('ipmsg-cap')));

  await page.evaluate(() => {
    const userId = 'ipmsg:10.0.0.9|peer';
    window.store.addOrUpdatePeer({
      userId,
      username: 'IPMSG Peer',
      usertag: 'IPMSG',
      status: 'online',
      avatar: null,
      bio: '',
      transport: 'ipmsg',
      ipmsgAccount: 'peer',
      ipmsgHost: 'peer-host',
      lastIp: '10.0.0.9',
      lastSeen: Date.now()
    });
    window.store.addMessage(userId, {
      id: 'ipmsg-msg-1',
      sender: userId,
      text: 'hello',
      timestamp: new Date().toISOString(),
      transport: 'ipmsg'
    });
    window.store.setState({ activeChatId: userId });
    window.ChatPanel.renderChat(window.store.getState());
  });

  const row = page.locator('.list-row[data-id="ipmsg:10.0.0.9|peer"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText('IPMSG');
  await expect(page.locator('.msg-react-btn')).toHaveCount(0);
  await expect(page.locator('.msg-edit-btn')).toHaveCount(0);
  await expect(page.locator('.msg-reply-btn')).toHaveCount(1);

  await page.evaluate(() => window.SidebarMiddle.showCreateGroupModal());
  await expect(page.locator('.friend-picker-option input[value="ipmsg:10.0.0.9|peer"]')).toHaveCount(0);
});
