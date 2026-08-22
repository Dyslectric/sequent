/**
 * Generate a local certificate authority and a server certificate for it.
 *
 * A phone will not install a PWA, or even register a service worker, unless the
 * origin is secure — and a plain `http://192.168.x.x` never is. Serving over
 * HTTPS with a certificate the phone trusts is the way around that, which needs
 * a CA (a bare self-signed server certificate cannot be installed as one).
 *
 *   node scripts/make-cert.mjs [extra-host ...]
 *
 * Every local IPv4 address is included automatically; pass extra DNS names as
 * arguments. Certificates land in `certs/`, which is not tracked.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const certDir = join(root, 'certs');
const DAYS = '825'; // Beyond this, mobile platforms reject the leaf outright.

function openssl(args, input) {
  return execFileSync('openssl', args, { cwd: certDir, input, encoding: 'utf8' });
}

try {
  execFileSync('openssl', ['version'], { stdio: 'ignore' });
} catch {
  console.error('make-cert: openssl is not on PATH.');
  process.exit(1);
}

const addresses = Object.values(networkInterfaces())
  .flat()
  .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
  .map((entry) => entry.address);

const hosts = [...new Set(['localhost', ...process.argv.slice(2)])];
const ips = [...new Set(['127.0.0.1', ...addresses])];

const san = [
  ...hosts.map((host) => `DNS:${host}`),
  ...ips.map((ip) => `IP:${ip}`),
].join(',');

mkdirSync(certDir, { recursive: true });
for (const stale of ['ca.srl', 'server.csr']) rmSync(join(certDir, stale), { force: true });

// The CA. This is the file that gets installed on the phone.
if (!existsSync(join(certDir, 'ca.key'))) {
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256',
    '-days', '3650', '-keyout', 'ca.key', '-out', 'ca.crt',
    '-subj', '/CN=Sequent local CA/O=Sequent',
    '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
  console.log('created certs/ca.crt  (install this one on the phone)');
} else {
  console.log('reusing certs/ca.crt');
}

// The leaf, reissued every run so a newly added address is covered.
writeFileSync(join(certDir, 'server.ext'),
  `basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\n`
  + `extendedKeyUsage=serverAuth\nsubjectAltName=${san}\n`);

openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-sha256',
  '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=Sequent']);
openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key',
  '-CAcreateserial', '-out', 'server.crt', '-days', DAYS, '-sha256',
  '-extfile', 'server.ext']);
rmSync(join(certDir, 'server.csr'), { force: true });

console.log('created certs/server.crt for:');
for (const entry of [...hosts, ...ips]) console.log(`  ${entry}`);
console.log('\nVite picks these up automatically. Next:');
console.log('  1. npm run preview            (now https://…:4173)');
console.log('  2. get certs/ca.crt onto the phone and install it as a CA');
console.log('     (Android: Settings > Security > Encryption & credentials >');
console.log('      Install a certificate > CA certificate)');
