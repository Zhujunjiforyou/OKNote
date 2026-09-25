const fs = require('node:fs');
const path = require('node:path');
const { Resvg } = require('@resvg/resvg-js');

const root = path.join(__dirname, '..');
const source = path.join(root, 'assets', 'brand', 'app-icon.png');
const outputDir = path.join(root, 'build', 'icons');
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256, 512, 1024];

function png(svg, size) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
}
function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(([size, data], index) => {
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map(([, data]) => data)]);
}
function icns(images) {
  const chunks = images.map(([type, data]) => {
    const header = Buffer.alloc(8);
    header.write(type, 0, 'ascii');
    header.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([header, data]);
  });
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
  return Buffer.concat([header, ...chunks]);
}

function build() {
  // The reviewed raster concept is traced as SVG for flat colors, real alpha
  // and repeatable native icon export. Keep the PNG alongside it for consumers.
  const vector = fs.readFileSync(path.join(root, 'assets', 'brand', 'app-icon.svg'), 'utf8');
  const original = png(vector, 1254);
  fs.writeFileSync(source, original);
  if (original.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('App icon must be a PNG');
  if (original.readUInt32BE(16) !== original.readUInt32BE(20) || original.readUInt32BE(16) < 1024) throw new Error('App icon must be square and at least 1024px');
  fs.mkdirSync(outputDir, { recursive: true });
  const small = fs.readFileSync(path.join(root, 'assets', 'brand', 'app-icon-small.svg'), 'utf8');
  // Rasterize each size from its vector source to preserve antialiasing on
  // fine pen contours; resampling an embedded bitmap loses small strokes.
  const images = new Map(sizes.map((size) => [size, png(size <= 32 ? small : vector, size)]));
  for (const [size, data] of images) fs.writeFileSync(path.join(outputDir, `app-${size}.png`), data);
  fs.writeFileSync(path.join(outputDir, 'app.png'), images.get(1024));
  fs.writeFileSync(path.join(outputDir, 'app.ico'), ico([...images].filter(([size]) => size <= 256)));
  fs.writeFileSync(path.join(outputDir, 'app.icns'), icns([
    ['icp4', images.get(16)], ['icp5', images.get(32)], ['icp6', images.get(64)],
    ['ic07', images.get(128)], ['ic08', images.get(256)], ['ic09', images.get(512)], ['ic10', images.get(1024)],
    ['ic11', images.get(32)], ['ic12', images.get(64)], ['ic13', images.get(256)], ['ic14', images.get(512)],
  ]));
  const tray = fs.readFileSync(path.join(root, 'assets', 'brand', 'tray-template.svg'), 'utf8');
  fs.writeFileSync(path.join(outputDir, 'trayTemplate.png'), png(tray, 18));
  fs.writeFileSync(path.join(outputDir, 'trayTemplate@2x.png'), png(tray, 36));
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), images.get(1024));
  const glyphs = require('../src/components/ui/icon-paths.json');
  const iconMarkup = Object.entries(glyphs).map(([name, paths]) => `<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths.map(d => `<path d="${d}"/>`).join('')}</svg><span>${name}</span></li>`).join('');
  const sample = sizes.map(size => `<figure><img src="app-${size}.png" width="${Math.min(size, 128)}" height="${Math.min(size, 128)}"><figcaption>${size}px${size > 128 ? ' (缩小预览)' : ''}</figcaption></figure>`).join('');
  fs.writeFileSync(path.join(outputDir, 'preview.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>OKNote 图标预览</title><style>body{font:14px system-ui;margin:0;background:#edf1f6;color:#16243a}main{max-width:1100px;margin:32px auto;padding:0 24px}h1{font-size:26px}h2{font-size:18px;margin:32px 0 16px}.samples{display:flex;flex-wrap:wrap;gap:20px;align-items:center;padding:24px;background:#fff;border-radius:16px}figure{margin:0;min-width:56px;text-align:center}figcaption{margin-top:10px;font-size:11px;opacity:.7}.dark{background:#101a2e;color:#f1f5ff}ul{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:24px;list-style:none;padding:24px;border-radius:16px;background:#fff}li{display:flex;gap:12px;align-items:center}svg{width:22px;height:22px;flex-shrink:0}li span{font-size:12px}.tray{display:flex;gap:20px;align-items:center}</style><main><h1>OKNote · 图标尺寸与主题预览</h1><p>应用图标保留生成图的透明度；功能图标采用统一矢量路径。</p><h2>浅色桌面</h2><div class="samples">${sample}</div><h2>深色桌面</h2><div class="samples dark">${sample}</div><h2>菜单栏模板图标</h2><div class="samples tray"><img src="trayTemplate.png" width="18" height="18"><img src="trayTemplate@2x.png" width="18" height="18"><span>18pt / 2× Retina，系统自动反色</span></div><h2>界面图标</h2><ul>${iconMarkup}</ul><ul class="dark">${iconMarkup}</ul></main></html>`);
  console.log(`Generated ${sizes.length} PNG sizes, Windows ICO, macOS ICNS and Retina tray icons in build/icons`);
}

if (require.main === module) build();
module.exports = { ico, icns };
