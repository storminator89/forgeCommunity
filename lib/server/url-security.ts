import 'server-only';

import { LookupAddress, LookupOptions } from 'dns';
import { lookup } from 'dns/promises';
import type { Agent } from 'undici';
import net from 'net';

export class HttpUrlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HttpUrlValidationError';
  }
}

type ResolvedAddress = { address: string; family?: number };

function parseIpv4(address: string) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }

  return octets;
}

function isPrivateIpv4(address: string) {
  const octets = parseIpv4(address);
  if (!octets) return false;

  const [first, second] = octets;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) || // Shared address space.
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 168) ||
    (first === 198 && second >= 18 && second <= 19) ||
    (first === 198 && second === 51 && octets[2] === 100) ||
    (first === 203 && second === 0 && octets[2] === 113) ||
    first >= 224
  );
}

function parseIpv6(address: string) {
  const normalized = address.toLowerCase().split('%', 1)[0];
  const [left, right, ...extra] = normalized.split('::');
  if (extra.length > 0) return null;

  const parsePart = (part: string) => {
    if (!part) return [] as number[];

    const groups = part.split(':');
    const output: number[] = [];
    for (const group of groups) {
      if (group.includes('.')) {
        const ipv4 = parseIpv4(group);
        if (!ipv4) return null;
        output.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
      } else if (/^[0-9a-f]{1,4}$/.test(group)) {
        output.push(parseInt(group, 16));
      } else {
        return null;
      }
    }
    return output;
  };

  const leftGroups = parsePart(left);
  const rightGroups = parsePart(right || '');
  if (!leftGroups || !rightGroups || leftGroups.length + rightGroups.length > 8) return null;

  const missing = 8 - leftGroups.length - rightGroups.length;
  if (!normalized.includes('::') && missing !== 0) return null;

  return [...leftGroups, ...Array.from({ length: missing }, () => 0), ...rightGroups];
}

function isPrivateIpv6(address: string) {
  const groups = parseIpv6(address);
  if (!groups) return false;

  // IPv4 mapped and IPv4 compatible addresses must receive the IPv4 policy.
  const isIpv4Embedded = groups.slice(0, 5).every((group) => group === 0) &&
    (groups[5] === 0 || groups[5] === 0xffff);
  if (isIpv4Embedded) {
    const ipv4 = [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.');
    if (isPrivateIpv4(ipv4)) return true;
    // IPv4-compatible addresses are deprecated and not public destinations.
    if (groups[5] === 0) return true;
    // Public IPv4-mapped addresses are safe under the IPv4 policy above.
    return false;
  }

  const first = groups[0];
  return (
    groups.every((group) => group === 0) ||
    (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) ||
    (first & 0xfe00) === 0xfc00 || // Unique local addresses.
    (first & 0xffc0) === 0xfe80 || // Link local addresses.
    (first & 0xff00) === 0xff00 || // Multicast is never a public HTTP destination.
    (first & 0xe000) !== 0x2000 || // Only global unicast 2000::/3 is routable.
    (first === 0x2001 && groups[1] === 0x0db8) || // Documentation range.
    (first === 0x2001 && groups[1] === 0x0010) || // ORCHID.
    (first === 0x2001 && groups[1] === 0x0002) || // Benchmarking.
    (first === 0x2001 && groups[1] === 0x0000) || // Teredo.
    first === 0x2002 || // 6to4 can encode private IPv4 destinations.
    (first === 0x0064 && groups[1] === 0xff9b) || // NAT64 well-known prefix.
    (first & 0xffc0) === 0xfec0 // Deprecated site-local addresses.
  );
}

function isPrivateAddress(address: string) {
  const withoutZone = address.toLowerCase().split('%', 1)[0];
  const ipVersion = net.isIP(withoutZone);

  if (ipVersion === 4) return isPrivateIpv4(withoutZone);
  if (ipVersion === 6) return isPrivateIpv6(withoutZone);
  return true;
}

function stripIpv6Brackets(hostname: string) {
  return hostname.replace(/^\[/, '').replace(/\]$/, '');
}

async function resolvePublicAddresses(hostname: string): Promise<ResolvedAddress[]> {
  const normalizedHostname = stripIpv6Brackets(hostname);
  const ipVersion = net.isIP(normalizedHostname);

  if (ipVersion) {
    if (isPrivateAddress(normalizedHostname)) {
      throw new HttpUrlValidationError('Private oder lokale Netzwerkziele sind nicht erlaubt.');
    }
    return [{ address: normalizedHostname, family: ipVersion }];
  }

  let addresses: ResolvedAddress[];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    addresses = await Promise.race([
      lookup(normalizedHostname, { all: true, verbatim: true }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('DNS lookup timed out')), 5000);
      }),
    ]);
  } catch {
    throw new HttpUrlValidationError('Das Ziel konnte nicht aufgelöst werden.');
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new HttpUrlValidationError('Private oder lokale Netzwerkziele sind nicht erlaubt.');
  }

  return addresses;
}

function callbackError(message: string) {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = 'EADDRNOTAVAIL';
  return error;
}

// The dispatcher performs the same checked lookup at connection time. This
// closes the validation/fetch DNS rebind window while preserving TLS SNI and
// certificate validation for the original hostname.
function checkedLookup(
  hostname: string,
  options: LookupOptions,
  callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family: number) => void,
) {
  resolvePublicAddresses(hostname)
    .then((resolvedAddresses) => {
      const addresses = options.family
        ? resolvedAddresses.filter((entry) => entry.family === options.family)
        : resolvedAddresses;
      if (addresses.length === 0) {
        callback(callbackError('No safe address for requested IP family'), '', 0);
        return;
      }

      if (options.all) {
        callback(null, addresses.map((entry) => ({ address: entry.address, family: entry.family || net.isIP(entry.address) })), 0);
        return;
      }

      const address = addresses[0];
      callback(null, address.address, address.family || net.isIP(address.address));
    })
    .catch((error) => callback(error instanceof Error ? error : callbackError('Unsafe network target'), '', 0));
}

let safeDispatcher: Agent | undefined;

async function getSafeDispatcher() {
  if (!safeDispatcher) {
    const { Agent: UndiciAgent } = await import('undici');
    safeDispatcher = new UndiciAgent({
      connect: { lookup: checkedLookup },
    });
  }

  return safeDispatcher;
}


export async function assertSafePublicUrl(rawUrl: string) {
  const url = new URL(normalizeHttpUrl(rawUrl));

  if (url.username || url.password) {
    throw new HttpUrlValidationError('URLs mit eingebetteten Zugangsdaten sind nicht erlaubt.');
  }

  if (url.port && !['80', '443'].includes(url.port)) {
    throw new HttpUrlValidationError('Nur Standard-Ports werden unterstützt.');
  }

  const hostname = stripIpv6Brackets(url.hostname.toLowerCase());
  const hostnameWithoutTrailingDot = hostname.replace(/\.$/, '');
  if (
    hostnameWithoutTrailingDot === 'localhost' ||
    hostnameWithoutTrailingDot.endsWith('.local') ||
    hostnameWithoutTrailingDot.endsWith('.internal') ||
    hostnameWithoutTrailingDot.endsWith('.localhost')
  ) {
    throw new HttpUrlValidationError('Lokale Ziele sind nicht erlaubt.');
  }

  await resolvePublicAddresses(hostname);
  return url;
}

/**
 * Fetch a validated public URL with a checked DNS lookup and no redirects.
 * Callers must explicitly validate each redirect target before following it.
 */
export async function fetchSafePublicUrl(rawUrl: string | URL, init: RequestInit = {}) {
  const safeUrl = await assertSafePublicUrl(rawUrl.toString());
  const dispatcher = await getSafeDispatcher();
  return fetch(safeUrl.toString(), {
    ...init,
    redirect: 'manual',
    // Node's RequestInit type does not include the undici dispatcher field.
    dispatcher,
  } as RequestInit & { dispatcher: Agent });
}

export function normalizeHttpUrl(rawUrl: string) {
  if (typeof rawUrl !== 'string') {
    throw new HttpUrlValidationError('Eine gültige URL ist erforderlich.');
  }

  const candidate = rawUrl.trim();
  if (!candidate || candidate.length > 2048) {
    throw new HttpUrlValidationError('Eine gültige URL ist erforderlich.');
  }
  let url: URL;

  try {
    url = new URL(candidate);
  } catch {
    throw new HttpUrlValidationError('Eine gültige URL ist erforderlich.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new HttpUrlValidationError('Nur HTTP- und HTTPS-URLs sind erlaubt.');
  }

  if (url.username || url.password) {
    throw new HttpUrlValidationError('URLs mit eingebetteten Zugangsdaten sind nicht erlaubt.');
  }

  return candidate;
}
