/**
 * Assemble the Linux tarball.
 *
 * Tauri has no tar.gz bundle target — deb, rpm and AppImage all assume a
 * package manager or a FUSE mount. This produces the plain alternative: the
 * binary, its icons, and a script that puts them where a desktop expects them.
 *
 * Run after `tauri build`, on Linux:  node scripts/pack-linux.mjs
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

const BINARY = 'sequent';
const ICON_SIZES = [32, 128, 256];

function fail(message) {
  console.error(`pack-linux: ${message}`);
  process.exit(1);
}

if (process.platform !== 'linux') {
  fail(`this packages a Linux build and must run on Linux (this is ${process.platform}).\n`
    + '  Tauri cannot cross-compile; build on a Linux machine, container or CI runner.');
}

const builtBinary = join(root, 'src-tauri/target/release', BINARY);
if (!existsSync(builtBinary)) {
  fail(`no built binary at ${builtBinary}\n  Run \`npm run desktop:build\` first.`);
}

const arch = process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'aarch64' : process.arch;
const name = `${BINARY}-${version}-${arch}`;
const outDir = join(root, 'src-tauri/target/release/bundle/tar');
const stage = join(outDir, name);

rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, 'icons'), { recursive: true });

copyFileSync(builtBinary, join(stage, BINARY));
chmodSync(join(stage, BINARY), 0o755);

for (const size of ICON_SIZES) {
  // 256 is not in the generated set; the @2x of 128 is the same pixel size.
  const candidates = [`${size}x${size}.png`, size === 256 ? '128x128@2x.png' : null].filter(Boolean);
  const found = candidates
    .map((file) => join(root, 'src-tauri/icons', file))
    .find((file) => existsSync(file));
  if (found) copyFileSync(found, join(stage, 'icons', `${size}x${size}.png`));
}

for (const script of ['install.sh', 'uninstall.sh']) {
  const target = join(stage, script);
  copyFileSync(join(root, 'scripts/linux', script), target);
  chmodSync(target, 0o755);
}

const archive = join(outDir, `${name}.tar.gz`);
rmSync(archive, { force: true });
// Run from outDir with relative names: the archive then unpacks into a single
// directory, and tar never sees an absolute path to misread.
execFileSync('tar', ['-czf', `${name}.tar.gz`, name], { cwd: outDir, stdio: 'inherit' });
rmSync(stage, { recursive: true, force: true });

console.log(`Bundled at:\n    ${archive}`);
