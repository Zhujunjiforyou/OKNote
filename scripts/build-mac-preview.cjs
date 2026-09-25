const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { packager } = require('@electron/packager');
const config = require('../build/electron-builder.preview.cjs');
const manifest = require('../package.json');
const { default: validateRuntime } = require('./afterPack.cjs');
const { createMacArchive, verifyMacArchive } = require('./lib/mac-archive.cjs');
const root = path.join(__dirname, '..');

async function run() {
  const out = path.resolve(root, config.directories.output);
  if (!out.startsWith(path.resolve(root, 'release') + path.sep)) throw new Error('Preview output must stay inside release');
  fs.mkdirSync(out, { recursive: true });
  // Stage only application code. No repository, user data or development
  // dependencies can accidentally enter the app archive.
  const staging = fs.mkdtempSync(path.join(out, '.source-'));
  const source = path.join(staging, 'app');
  const icons = path.join(staging, 'icons');
  fs.mkdirSync(source);
  fs.mkdirSync(icons);
  for (const dir of ['dist', 'electron']) fs.cpSync(path.join(root, dir), path.join(source, dir), { recursive: true });
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: manifest.name, version: config.extraMetadata.version,
    main: manifest.main, description: manifest.description, author: manifest.author, license: manifest.license }, null, 2));
  for (const file of fs.readdirSync(path.join(root, 'build', 'icons')).filter(file => /\.(png|ico)$/.test(file))) {
    fs.copyFileSync(path.join(root, 'build', 'icons', file), path.join(icons, file));
  }
  const reports = [];
  try {
  for (const architecture of ['arm64', 'x64']) {
    console.log(`Preparing macOS ${architecture} preview`);
    let lastProgress = -1;
    // Electron Packager supports unsigned cross-platform app bundles;
    // electron-builder 26 explicitly requires a Mac host for its Mac targets.
    const [bundleDir] = await packager({ dir: source, name: 'OKNote', platform: 'darwin', arch: architecture,
      electronVersion: require('electron/package.json').version, appVersion: config.extraMetadata.version,
      download: { downloadOptions: { quiet: true, signal: AbortSignal.timeout(10 * 60 * 1000), getProgressCallback: ({ percent }) => {
        const step = Math.floor(percent * 10);
        if (step > lastProgress) { lastProgress = step; console.log(`Electron ${architecture} download: ${step * 10}%`); }
      } } },
      buildVersion: config.buildVersion, appBundleId: manifest.build.appId,
      appCategoryType: manifest.build.mac.category, darwinDarkModeSupport: true,
      extendInfo: { LSMinimumSystemVersion: manifest.build.mac.minimumSystemVersion },
      icon: path.join(root, manifest.build.mac.icon), extraResource: [icons],
      asar: true, prune: false, overwrite: true, out });
    await validateRuntime({ electronPlatformName: 'darwin', arch: architecture, appOutDir: bundleDir, packager: { appInfo: { productFilename: 'OKNote' } } });
    const appDir = path.join(bundleDir, 'OKNote.app');
    const file = path.join(out, `OKNote-${config.extraMetadata.version}-mac-${architecture}.zip`);
    const asar = require('@electron/asar');
    const appAsar = path.join(appDir, 'Contents', 'Resources', 'app.asar');
    const entries = asar.listPackage(appAsar).map(name => name.replaceAll('\\', '/'));
    if (!entries.includes('/electron/main.cjs') || !entries.includes('/dist/index.html') ||
      entries.some(name => !/^\/(dist|electron)(\/|$)|^\/package\.json$/.test(name))) throw new Error('Unexpected app.asar contents');
    const extras = [path.join(root, 'docs', 'macos-preview.md'), path.join(root, 'scripts', 'prepare-macos-preview.command'), path.join(root, 'scripts', 'preview-entitlements.plist')];
    const releaseNotes = path.join(root, 'docs', 'releases', `${manifest.version}.md`);
    if (fs.existsSync(releaseNotes)) {
      const bundledNotes = path.join(staging, `${manifest.version}.md`);
      fs.writeFileSync(bundledNotes, fs.readFileSync(releaseNotes, 'utf8').replace('](../macos-preview.md)', '](macos-preview.md)'));
      extras.push(bundledNotes);
    }
    await createMacArchive(appDir, file, extras);
    const report = await verifyMacArchive(file, architecture, {
      icon: fs.readFileSync(path.join(root, manifest.build.mac.icon)), asar: fs.readFileSync(appAsar),
    });
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    reports.push({ file: path.basename(file), bytes: fs.statSync(file).size, sha256: hash.digest('hex'), ...report });
    console.log(`Verified ${architecture} archive: Unix modes, framework links, Mach-O, icon, resources`);
  }
  fs.writeFileSync(path.join(out, 'macos-verification.json'), JSON.stringify({ version: config.extraMetadata.version,
    buildVersion: config.buildVersion, createdAt: new Date().toISOString(), host: process.platform, reports }, null, 2) + '\n');
  const sumsFile = path.join(out, 'SHA256SUMS.txt');
  const currentFiles = new Set(reports.map(report => report.file));
  const otherSums = fs.existsSync(sumsFile) ? fs.readFileSync(sumsFile, 'utf8').split(/\r?\n/)
    .filter(line => line.trim() && !currentFiles.has(line.replace(/^[a-f\d]{64}\s+/i, ''))) : [];
  fs.writeFileSync(sumsFile, [...otherSums, ...reports.map(report => `${report.sha256}  ${report.file}`)].join('\n') + '\n');
  } finally {
    const resolved = path.resolve(staging);
    if (path.dirname(resolved) === out && path.basename(resolved).startsWith('.source-')) fs.rmSync(resolved, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
