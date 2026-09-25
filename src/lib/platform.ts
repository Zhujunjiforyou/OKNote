export const defaultSystemFont = typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin'
  ? 'PingFang SC'
  : 'Microsoft YaHei'
export const systemFontStack = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
