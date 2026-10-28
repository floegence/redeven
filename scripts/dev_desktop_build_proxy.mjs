import { execFileSync } from 'node:child_process';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const proxyVariables = ['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY'];

// curl, Cargo and package installers inherit environment proxies, not macOS's
// static system settings. Resolve once for build preparation; never read secrets
// or evaluate a PAC file, and never override an explicit environment policy.
export function resolveBuildProxy({
  env = process.env,
  platform = process.platform,
  readSettings = () => execFileSync('/usr/sbin/scutil', ['--proxy'], { encoding: 'utf8', timeout: 5000 }),
  warn = message => console.warn(message),
} = {}) {
  if (platform !== 'darwin' || env.REDEVEN_DEV_SYSTEM_PROXY === '0' || proxyVariables.some(name => Object.hasOwn(env, name))) return {};
  let settings;
  try {
    settings = readSettings();
  } catch {
    warn('[WARN] Could not read macOS build proxy settings; configure HTTPS_PROXY explicitly if downloads require a proxy.');
    return {};
  }
  const value = name => settings.match(new RegExp(`^\\s*${name} : (.*?)\\s*$`, 'm'))?.[1];
  const result = {};
  for (const protocol of ['HTTP', 'HTTPS']) {
    if (value(`${protocol}Enable`) !== '1') continue;
    let host = value(`${protocol}Proxy`) ?? '';
    const port = value(`${protocol}Port`) ?? '';
    if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
    if ((!isIP(host) && !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/u.test(host)) || !/^\d+$/u.test(port) || Number(port) < 1 || Number(port) > 65535) {
      throw new Error(`Invalid macOS ${protocol} proxy; fix System Settings or set HTTPS_PROXY explicitly.`);
    }
    const endpoint = `http://${isIP(host) === 6 ? `[${host}]` : host}:${Number(port)}`;
    result[`${protocol.toLowerCase()}_proxy`] = endpoint;
    result[`${protocol}_PROXY`] = endpoint;
  }
  if (!Object.keys(result).length) {
    if (value('ProxyAutoConfigEnable') === '1' || value('SOCKSEnable') === '1') {
      warn('[WARN] macOS uses a PAC or SOCKS proxy; set HTTPS_PROXY or ALL_PROXY explicitly for development downloads.');
    }
    return result;
  }
  if (!Object.hasOwn(env, 'no_proxy') && !Object.hasOwn(env, 'NO_PROXY')) {
    const exceptions = settings.match(/ExceptionsList : <array> \{([\s\S]*?)\}/u)?.[1] ?? '';
    const hosts = ['localhost', '127.0.0.1', '::1'];
    for (const match of exceptions.matchAll(/^\s*\d+ : (\S+)\s*$/gmu)) {
      const host = match[1].replace(/^\*\./u, '.');
      // NO_PROXY supports suffixes, addresses and CIDR, not arbitrary globs.
      if (/^[a-zA-Z0-9.:/\[\]-]+$/u.test(host)) hosts.push(host);
    }
    result.no_proxy = result.NO_PROXY = [...new Set(hosts)].join(',');
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    for (const [name, value] of Object.entries(resolveBuildProxy())) console.log(`${name}=${value}`);
  } catch (error) {
    console.error(`[ERROR] ${error.message}`);
    process.exitCode = 1;
  }
}
