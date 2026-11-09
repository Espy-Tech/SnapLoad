const dns = require('node:dns').promises;
const { isIP } = require('node:net');
const ipaddr = require('ipaddr.js');

function isPublicAddress(address) {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}

function isSafeRemoteUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) return false;

  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;

    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!hostname || hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || hostname.endsWith('.internal')
      || hostname.endsWith('.local')) return false;

    return !isIP(hostname) || isPublicAddress(hostname);
  } catch {
    return false;
  }
}

async function resolveSafeRemoteUrl(value, lookupHost = dns.lookup) {
  if (!isSafeRemoteUrl(value)) throw new Error('URL non autorisée');

  const url = new URL(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const family = isIP(hostname);
  const addresses = family
    ? [{ address: hostname, family }]
    : await lookupHost(hostname, { all: true, verbatim: true });

  if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address))) {
    throw new Error('URL non autorisée');
  }

  const address = addresses[0];
  const pinnedLookup = (_hostname, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }

    if (options && options.all) {
      callback(null, [{ address: address.address, family: address.family }]);
    } else {
      callback(null, address.address, address.family);
    }
  };

  return { url, lookup: pinnedLookup };
}

module.exports = { isPublicAddress, isSafeRemoteUrl, resolveSafeRemoteUrl };
