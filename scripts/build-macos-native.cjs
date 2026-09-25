const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');

function buildMacNative(arch = process.arch) {
  if (!['arm64', 'x64'].includes(arch)) throw new Error(`Unsupported macOS architecture: ${arch}`);
  const source = path.join(root, 'native', 'macos-desktop-window.mm');
  const output = path.join(root, 'build', 'native', `darwin-${arch}`, 'desktop-window.node');
  if (process.platform !== 'darwin') {
    if (fs.existsSync(output) && fs.statSync(output).mtimeMs >= fs.statSync(source).mtimeMs) return output;
    throw new Error(`Build the macOS ${arch} native module on a Mac with npm run prepare:mac-native -- ${arch} first.`);
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  execFileSync('xcrun', ['clang++', '-std=c++17', '-bundle', '-undefined', 'dynamic_lookup',
    '-fobjc-arc', '-fblocks', '-framework', 'AppKit', '-framework', 'UserNotifications', '-DNAPI_VERSION=8', '-mmacosx-version-min=13.0',
    '-arch', arch === 'x64' ? 'x86_64' : 'arm64', '-I', require('node-api-headers').include_dir,
    source, '-o', output], { stdio: 'inherit' });
  return output;
}

if (require.main === module && process.platform === 'darwin') {
  for (const arch of process.argv[2] === 'all' ? ['arm64', 'x64'] : [process.argv[2] || process.arch]) {
    console.log(`Built macOS ${arch} native window module: ${buildMacNative(arch)}`);
  }
}

module.exports = { buildMacNative };
