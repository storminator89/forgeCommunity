import 'server-only';

import { lookup } from 'dns/promises';
import net from 'net';

const PRIVATE_IPV4_PATTERNS = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
];

export class HttpUrlValidationError extends Error {}

function isPrivateIpv4(address: string) {
  return PRIVATE_IPV4_PATTERNS.some((pattern) => pattern.test(address));
}

function isPrivateIpv6(address: string) {
  const normalized = address.toLowerCase();

  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  );
}

function isPrivateAddress(address: string) {
  const ipVersion = net.isIP(address);

  if (ipVersion === 4) {
    return isPrivateIpv4(address);
  }

  if (ipVersion === 6) {
    return isPrivateIpv6(address);
  }

  return false;
}

export async function assertSafePublicUrl(rawUrl: string) {
  const url = new URL(normalizeHttpUrl(rawUrl));

  if (url.username || url.password) {
    throw new Error('URLs mit eingebetteten Zugangsdaten sind nicht erlaubt.');
  }

  if (url.port && !['80', '443'].includes(url.port)) {
    throw new Error('Nur Standard-Ports werden unterstützt.');
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.localhost')
  ) {
    throw new Error('Lokale Ziele sind nicht erlaubt.');
  }

  const addresses = net.isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });

  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error('Private oder lokale Netzwerkziele sind nicht erlaubt.');
  }

  return url;
}

export function normalizeHttpUrl(rawUrl: string) {
  const url = new URL(rawUrl);

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new HttpUrlValidationError('Nur HTTP- und HTTPS-URLs sind erlaubt.');
  }

  return rawUrl.trim();
}
