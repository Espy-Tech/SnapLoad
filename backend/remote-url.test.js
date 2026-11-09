const assert = require('node:assert/strict');
const test = require('node:test');
const { isPublicAddress, isSafeRemoteUrl, resolveSafeRemoteUrl } = require('./remote-url');

test('only globally routable IP addresses are accepted', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.1.1', '100.64.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPublicAddress(address), false, `${address} must be blocked`);
  }

  for (const address of ['8.8.8.8', '1.1.1.1', '2001:4860:4860::8888']) {
    assert.equal(isPublicAddress(address), true, `${address} must be accepted`);
  }
});

test('rejects unsafe URLs before DNS resolution', () => {
  for (const url of ['http://localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'http://192.168.1.1/', 'file:///etc/passwd']) {
    assert.equal(isSafeRemoteUrl(url), false, `${url} must be blocked`);
  }
});

test('rejects hostnames resolving to any non-public address', async () => {
  const lookup = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '127.0.0.1', family: 4 }
  ];

  await assert.rejects(
    resolveSafeRemoteUrl('https://media.example/video.mp4', lookup),
    /URL non autorisée/
  );
});

test('pins requests to a validated public DNS result', async () => {
  const lookupHost = async (hostname, options) => {
    assert.equal(hostname, 'media.example');
    assert.equal(options.all, true);
    return [
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }
    ];
  };

  const destination = await resolveSafeRemoteUrl('https://media.example/video.mp4', lookupHost);

  await new Promise((resolve, reject) => {
    destination.lookup('media.example', {}, (error, address, family) => {
      if (error) return reject(error);
      assert.equal(address, '93.184.216.34');
      assert.equal(family, 4);
      resolve();
    });
  });
});
