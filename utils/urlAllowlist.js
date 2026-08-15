/**
 * Official URL Allowlist
 * ──────────────────────
 * Validates redirect targets before sending users to external government portals.
 * Prevents open-redirect vulnerabilities on GET /api/jobs/:id/apply.
 */

import SITE_REGISTRY from '../config/siteRegistry.js';

const STATIC_SUFFIXES = ['.gov.in', '.nic.in', '.gov', '.ac.in'];

const registryHosts = SITE_REGISTRY.map((site) => {
  try {
    return new URL(site.url).hostname;
  } catch {
    return null;
  }
}).filter(Boolean);

/**
 * Returns true if the URL is a safe http(s) link to an allowed government domain.
 */
export function isAllowedOfficialUrl(urlString) {
  let parsed;

  try {
    parsed = new URL(urlString);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();

  const matchesStaticSuffix = STATIC_SUFFIXES.some(
    (suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix)
  );

  if (matchesStaticSuffix) {
    return true;
  }

  return registryHosts.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`)
  );
}

export default { isAllowedOfficialUrl };
