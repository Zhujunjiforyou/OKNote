const WINDOWS_FONTS = ['Microsoft YaHei', 'SimSun', 'SimHei', 'KaiTi', 'FangSong', 'DengXian', 'YouYuan', 'NSimSun', 'Microsoft JhengHei', 'Segoe UI', 'Consolas', 'Calibri', 'Cambria'];
const MAC_FONTS = ['PingFang SC', 'Songti SC', 'Heiti SC', 'Kaiti SC', 'Hiragino Sans', 'Helvetica Neue', 'Menlo', 'Monaco'];
const COMMON_FONTS = ['Arial', 'Times New Roman', 'Courier New', 'Verdana', 'Georgia', 'Tahoma', 'Trebuchet MS'];

function defaultFont(platform = process.platform) {
  return platform === 'darwin' ? 'PingFang SC' : platform === 'win32' ? 'Microsoft YaHei' : 'sans-serif';
}

function fallbackFonts(platform = process.platform) {
  return [...(platform === 'darwin' ? MAC_FONTS : platform === 'win32' ? WINDOWS_FONTS : []), ...COMMON_FONTS];
}

function fontQuery(platform = process.platform) {
  if (platform === 'darwin') return { file: '/usr/sbin/system_profiler', args: ['SPFontsDataType', '-json'] };
  if (platform !== 'win32') return null;
  const script = `[Console]::OutputEncoding = [Text.Encoding]::UTF8; @('HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts','HKCU:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts') | ForEach-Object { $key = Get-ItemProperty -Path $_ -ErrorAction SilentlyContinue; if ($key) { $key.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' -and $_.Name.Length -gt 1 -and $_.Name.Length -lt 80 } | ForEach-Object { (($_.Name -replace '\\s*\\((TrueType|OpenType)\\)', '') -replace '\\s+$', '').Trim() } } }`;
  return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', script] };
}

function parseFontNames(stdout, platform = process.platform) {
  if (platform !== 'darwin') return stdout.split(/[\r\n]+/);
  const names = new Set();
  const addFamily = (value) => {
    if (typeof value !== 'string') return;
    const family = value.trim();
    // Dot-prefixed families are private macOS UI fonts, not selectable document fonts.
    // system_profiler can wrap that prefix in invisible bidi controls.
    const visibleFamily = family.replace(/\p{Bidi_Control}/gu, '').trim();
    if (visibleFamily && !visibleFamily.startsWith('.')) names.add(family);
  };
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    addFamily(value.family);
    addFamily(value.family_name);
    for (const child of Object.values(value)) if (child && typeof child === 'object') visit(child);
  };
  visit(JSON.parse(stdout));
  return [...names];
}

function loginItemOptions(settings, platform = process.platform, executable = process.execPath) {
  const openAtLogin = settings.autoLaunch === true;
  if (platform === 'darwin') return { openAtLogin };
  return { openAtLogin, name: 'com.oknote.app', path: executable, args: openAtLogin && settings.startMinimized ? ['--hidden'] : [] };
}

function shouldStartHidden(settings, loginState, argv = process.argv, platform = process.platform) {
  return argv.includes('--hidden') || (platform === 'darwin' && settings.startMinimized === true && loginState?.wasOpenedAtLogin === true);
}

function macMenuTemplate(actions) {
  return [
    { label: 'OKNote', submenu: [
      { role: 'about', label: '关于 OKNote' }, { type: 'separator' },
      { label: '偏好设置…', accelerator: 'Command+,', click: actions.settings },
      { type: 'separator' }, { role: 'services', label: '服务' }, { type: 'separator' },
      { role: 'hide', label: '隐藏 OKNote' }, { role: 'hideOthers', label: '隐藏其他' }, { role: 'unhide', label: '全部显示' },
      { type: 'separator' }, { label: '退出 OKNote', accelerator: 'Command+Q', click: actions.quit },
    ] },
    { label: '文件', submenu: [{ role: 'close', label: '关闭窗口', accelerator: 'Command+W' }] },
    { label: '编辑', submenu: [
      { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' },
      { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' },
      { role: 'selectAll', label: '全选' },
    ] },
    { label: '窗口', submenu: [
      { label: '显示日历', click: actions.calendar }, { label: '每日待办', click: actions.daily },
      { type: 'separator' }, { role: 'minimize', label: '最小化' }, { role: 'front', label: '全部置于前面' },
    ] },
  ];
}

module.exports = { defaultFont, fallbackFonts, fontQuery, parseFontNames, loginItemOptions, shouldStartHidden, macMenuTemplate };
