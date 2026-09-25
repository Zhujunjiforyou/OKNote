const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const yazl = require('yazl');
const yauzl = require('yauzl');

const MACH_MAGICS = new Set(['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca']);
function fileMode(file) {
  const fd = fs.openSync(file, 'r');
  const header = Buffer.alloc(4);
  try { fs.readSync(fd, header, 0, 4, 0); } finally { fs.closeSync(fd); }
  return MACH_MAGICS.has(header.toString('hex')) || file.endsWith('.command') ? 0o100755 : 0o100644;
}

async function createMacArchive(appDir, destination, extras = []) {
  const entries = [];
  function collect(file, name) {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(file).replaceAll('\\', '/');
      const resolved = path.resolve(path.dirname(file), target);
      const relative = path.relative(appDir, resolved);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Link escapes app: ${name}`);
      entries.push({ type: 'link', target, name, options: { mode: 0o120777, mtime: stat.mtime } });
    } else if (stat.isDirectory()) {
      entries.push({ type: 'directory', name, options: { mode: 0o40755, mtime: stat.mtime } });
      for (const entry of fs.readdirSync(file).sort()) collect(path.join(file, entry), `${name}/${entry}`);
    } else {
      entries.push({ type: 'file', file, name, options: { mode: fileMode(file), mtime: stat.mtime, compressionLevel: 6 } });
    }
  }
  // Validate the complete tree before yazl starts opening input streams. A
  // rejected link must not leave asynchronous reads racing fixture cleanup.
  collect(appDir, path.basename(appDir));
  for (const file of extras) entries.push({ type: 'file', file, name: path.basename(file), options: { mode: fileMode(file) } });
  const zip = new yazl.ZipFile();
  zip.on('error', error => zip.outputStream.destroy(error));
  const completion = pipeline(zip.outputStream, fs.createWriteStream(destination));
  try {
    for (const entry of entries) {
      if (entry.type === 'link') zip.addBuffer(Buffer.from(entry.target), entry.name, entry.options);
      else if (entry.type === 'directory') zip.addEmptyDirectory(entry.name, entry.options);
      else zip.addFile(entry.file, entry.name, entry.options);
    }
    zip.end();
    await completion;
  } catch (error) { zip.outputStream.destroy(error); await completion.catch(() => {}); throw error; }
}

function listArchive(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (error, zip) => {
      if (error) return reject(error);
      const entries = new Map();
      zip.on('error', reject);
      zip.on('entry', (entry) => { entries.set(entry.fileName, entry); zip.readEntry(); });
      zip.on('end', () => resolve({ zip, entries }));
      zip.readEntry();
    });
  });
}
function readEntry(zip, entry) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) return reject(error);
      const chunks = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  });
}

async function verifyMacArchive(file, architecture, expected = {}) {
  const { zip, entries } = await listArchive(file);
  const base = 'OKNote.app/Contents/';
  const framework = `${base}Frameworks/Electron Framework.framework/`;
  const mode = entry => entry.externalFileAttributes >>> 16;
  const required = name => {
    const entry = entries.get(name);
    if (!entry || entry.uncompressedSize === 0) throw new Error(`Missing archive resource: ${name}`);
    return entry;
  };
  try {
    const executable = required(`${base}MacOS/OKNote`);
    if ((mode(executable) & 0o111) !== 0o111) throw new Error('App executable lost Unix execute permissions');
    const binary = await readEntry(zip, executable);
    const cpu = architecture === 'arm64' ? 0x0100000c : 0x01000007;
    if (binary.readUInt32LE(0) !== 0xfeedfacf || binary.readUInt32LE(4) !== cpu) throw new Error(`Wrong Mach-O architecture: expected ${architecture}`);
    const plist = (await readEntry(zip, required(`${base}Info.plist`))).toString('utf8');
    for (const [key, value] of [['CFBundleIdentifier', 'com.oknote.app'], ['CFBundleExecutable', 'OKNote']]) {
      const encodedValue = value.replaceAll('.', '\\.');
      if (!new RegExp(`<key>${key}</key>\\s*<string>${encodedValue}</string>`).test(plist)) throw new Error(`Invalid Info.plist: ${key}`);
    }
    const iconName = plist.match(/<key>CFBundleIconFile<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
    if (!iconName) throw new Error('Missing icon declaration');
    const icon = await readEntry(zip, required(`${base}Resources/${iconName.endsWith('.icns') ? iconName : `${iconName}.icns`}`));
    if (icon.subarray(0, 4).toString() !== 'icns' || icon.readUInt32BE(4) !== icon.length) throw new Error('Invalid bundled ICNS');
    if (expected.icon && !icon.equals(expected.icon)) throw new Error('Bundled app icon differs from the current source');
    const asarEntry = required(`${base}Resources/app.asar`);
    if (expected.asar && !(await readEntry(zip, asarEntry)).equals(expected.asar)) throw new Error('Bundled application differs from the verified app.asar');
    required(`${base}Resources/icons/app.ico`);
    required(`${base}Resources/icons/trayTemplate@2x.png`);
    required(`${framework}Versions/A/Electron Framework`);
    const links = { 'Versions/Current': 'A', 'Electron Framework': 'Versions/Current/Electron Framework', 'Resources': 'Versions/Current/Resources' };
    for (const [name, target] of Object.entries(links)) {
      const entry = required(framework + name);
      if ((mode(entry) & 0o170000) !== 0o120000 || (await readEntry(zip, entry)).toString() !== target) throw new Error(`Framework symlink was not preserved: ${name}`);
    }
    let executableCount = 0;
    for (const [name, entry] of entries) {
      if (name.includes('/MacOS/') && !name.endsWith('/')) {
        if ((mode(entry) & 0o111) === 0) throw new Error(`Helper lost execute permission: ${name}`);
        executableCount++;
      }
      if (name.includes('/user-data/') || name.includes('/.env') || name.includes('/node_modules/')) throw new Error(`Unexpected development/user data in app: ${name}`);
    }
    return { architecture, files: entries.size, executableCount, frameworkLinksPreserved: true, iconValid: true,
      iconMatchesSource: Boolean(expected.icon), asarMatchesVerifiedSource: Boolean(expected.asar), runtimeTestedOnMac: false };
  } finally { zip.close(); }
}

module.exports = { createMacArchive, verifyMacArchive, fileMode };
