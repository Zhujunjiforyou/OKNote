// Kill any process occupying port 5199 (Vite dev server cleanup)
const { execSync } = require('child_process');

const PORT = '5199';

try {
  if (process.platform === 'win32') {
    // Windows: use netstat + taskkill
    const cmd = `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${PORT} ^| findstr LISTENING') do taskkill /F /PID %a`;
    try {
      execSync(cmd, { stdio: 'pipe', timeout: 5000 });
      console.log(`[killport] Port ${PORT} freed.`);
    } catch {
      console.log(`[killport] Port ${PORT} was not in use.`);
    }
  } else {
    // macOS/Linux: use lsof
    try {
      const out = execSync(`lsof -ti:${PORT}`, { encoding: 'utf-8', timeout: 5000 });
      const pids = out.trim().split('\n').filter(Boolean);
      for (const pid of pids) {
        process.kill(parseInt(pid, 10), 'SIGKILL');
      }
      console.log(`[killport] Port ${PORT} freed (${pids.length} process(es)).`);
    } catch {
      console.log(`[killport] Port ${PORT} was not in use.`);
    }
  }
} catch (err) {
  // Silently ignore failures
  process.exit(0);
}
