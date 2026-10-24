#!/opt/homebrew/bin/node
/** Foreground owner of one backend and one Cloudflare Quick Tunnel. No shell is used. */
import { spawn } from 'node:child_process';
import { existsSync, realpathSync, mkdirSync, chmodSync, openSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptFile = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptFile);
const argv = process.argv.slice(2);
if (argv.includes('--help')) {
  console.log('Usage: node scripts/launch-local.mjs [--repo /absolute/repository] [--publish-config]\nEnvironment: TTS_MOS_DATA_DIR (outside repo), PORT (8787), CLOUDFLARED_BIN, TTS_MOS_REPO');
  process.exit(0);
}
let repoArg;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--repo' && argv[i + 1]) repoArg = argv[++i];
  else if (argv[i] !== '--publish-config') throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
}
const repo = realpathSync(path.resolve(repoArg || path.join(scriptDir, '..')));
const dataCandidate = path.resolve(process.env.TTS_MOS_DATA_DIR || path.join(repo, '..', 'private-data'));
mkdirSync(dataCandidate, { recursive: true, mode: 0o700 });
const dataDir = realpathSync(dataCandidate);
if (dataDir === repo || dataDir.startsWith(repo + path.sep)) throw new Error('TTS_MOS_DATA_DIR must be outside the repository.');
const port = Number(process.env.PORT || 8787);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer from 1024 to 65535.');
const localBase = `http://127.0.0.1:${port}`;
const healthPath = '/api/health';
const appName = 'tts-mos-evaluation';
const githubRepo = process.env.TTS_MOS_REPO || 'wkzCode/tts-mos-evaluation';
if (!/^[\w.-]+\/[\w.-]+$/.test(githubRepo)) throw new Error('Invalid TTS_MOS_REPO.');
const publish = argv.includes('--publish-config');
const backendFile = path.join(repo, 'backend', 'server.mjs');
if (!existsSync(backendFile)) throw new Error(`Missing backend: ${backendFile}; use --repo /absolute/repository.`);
const opsDir = path.join(dataDir, 'ops');
mkdirSync(opsDir, { recursive: true, mode: 0o700 });
chmodSync(opsDir, 0o700);
const lockFile = path.join(opsDir, 'supervisor.lock');
const stateFile = path.join(opsDir, 'status.json');
const stopRequested = { value: false };
const owned = new Set();
const timers = new Set();
const logs = new Set();
const state = {
  app: appName, supervisorPid: process.pid, supervisorScript: scriptFile, repo, dataDir,
  localBase, healthPath, startedAt: new Date().toISOString(), status: 'starting',
  backendPid: null, backendOwned: false, tunnelPid: null, apiBase: null,
  publishConfig: publish, publishedApiBase: null, configuredApiBase: null,
  configInFlight: false, configRetryAttempts: 0, configNextRetryAt: null, configError: null,
};
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
let lockFd;
try {
  lockFd = openSync(lockFile, 'wx', 0o600);
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  let previous;
  try { previous = JSON.parse(readFileSync(lockFile, 'utf8')); } catch {}
  if (!previous || alive(previous.pid)) throw new Error(`An existing supervisor or unreadable lock exists: ${lockFile}. Inspect it before retrying.`);
  unlinkSync(lockFile); // Reclaim a lock only after its recorded PID has ceased to exist.
  lockFd = openSync(lockFile, 'wx', 0o600);
}
writeFileSync(lockFd, JSON.stringify({ pid: process.pid, script: scriptFile, repo, startedAt: state.startedAt }));
closeSync(lockFd);
function saveState(extra = {}) {
  Object.assign(state, extra, { checkedAt: new Date().toISOString() });
  const temp = `${stateFile}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  renameSync(temp, stateFile);
}
function logStream(name) {
  const filename = path.join(opsDir, `${name}.log`);
  const stream = createWriteStream(filename, { flags: 'a', mode: 0o600 });
  if (existsSync(filename)) chmodSync(filename, 0o600);
  logs.add(stream);
  stream.on('error', () => void shutdown(1, 'Unable to write private logs.'));
  stream.write(`\n[${new Date().toISOString()}] supervisor ${process.pid}\n`);
  return stream;
}
function wait(ms) {
  return new Promise(resolve => {
    const timer = setTimeout(() => { timers.delete(timer); resolve(); }, ms);
    timers.add(timer);
  });
}
async function health(base) {
  try {
    const response = await fetch(base + healthPath, { signal: AbortSignal.timeout(2500), cache: 'no-store' });
    if (!response.ok) return false;
    const body = await response.json();
    return body.ok === true && body.app === appName;
  } catch { return false; }
}
async function untilHealthy(base, attempts, current = () => true) {
  for (let i = 0; i < attempts && !stopRequested.value && current(); i++) {
    if (await health(base)) return current();
    await wait(1000);
  }
  return false;
}
function child(command, args, log, env = process.env) {
  const proc = spawn(command, args, { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  owned.add(proc);
  proc.stdout.pipe(log, { end: false });
  proc.stderr.pipe(log, { end: false });
  proc.once('exit', () => owned.delete(proc));
  proc.once('error', () => owned.delete(proc));
  return proc;
}
function run(command, args, input) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd: repo, env: process.env, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    owned.add(proc);
    let output = '', errorText = '';
    proc.stdout.on('data', chunk => { output += chunk; });
    proc.stderr.on('data', chunk => { errorText += chunk; });
    const timer = setTimeout(() => proc.kill('SIGTERM'), 45000);
    proc.once('error', error => { clearTimeout(timer); owned.delete(proc); reject(error); });
    proc.once('exit', code => {
      clearTimeout(timer); owned.delete(proc);
      if (code === 0) resolve(output);
      else { const error = new Error(`${command} failed (exit ${code}).`); error.notFound = /HTTP 404/.test(errorText); reject(error); }
    });
    proc.stdin.on('error', () => {});
    proc.stdin.end(input);
  });
}
async function publishConfig(config) {
  const endpoint = `repos/${githubRepo}/contents/public/data/runtime.json`;
  let version;
  try {
    const existing = JSON.parse(await run('gh', ['api', '--method', 'GET', endpoint]));
    version = existing.sha;
    // A previous PUT may have succeeded even if its response was lost. Avoid another commit.
    if (existing.content) {
      try {
        const remote = JSON.parse(Buffer.from(existing.content, 'base64').toString('utf8'));
        if (remote.apiBase === config.apiBase) return;
      } catch {}
    }
  }
  catch (error) { if (!error.notFound) throw error; }
  const body = { message: 'Update public tunnel endpoint', content: Buffer.from(JSON.stringify(config, null, 2) + '\n').toString('base64') };
  // GitHub requires its returned version field to update an existing file. No digest is calculated.
  if (version) body.sha = version;
  await run('gh', ['api', '--method', 'PUT', endpoint, '--input', '-'], JSON.stringify(body));
}
// One configuration worker; health monitoring can request recovery without accumulating jobs.
let configInFlight = false;
let configRequested = null;
function needsConfig(apiBase) {
  return state.configuredApiBase !== apiBase || (publish && state.publishedApiBase !== apiBase);
}
function currentTunnel(apiBase, tunnelPid) {
  return typeof apiBase === 'string' && !stopRequested.value && state.apiBase === apiBase && tunnel?.pid === tunnelPid && tunnel.exitCode === null && tunnel.signalCode === null;
}
function queueConfig(apiBase, tunnelPid) {
  if (!currentTunnel(apiBase, tunnelPid) || !needsConfig(apiBase)) return;
  configRequested = { apiBase, tunnelPid };
  if (configInFlight || Date.now() < (state.configNextRetryAt || 0)) return;
  void configureCurrent();
}
async function configureCurrent() {
  const request = configRequested;
  if (!request || configInFlight) return;
  const { apiBase, tunnelPid } = request;
  const current = () => currentTunnel(apiBase, tunnelPid);
  if (!current() || !needsConfig(apiBase)) return;
  configInFlight = true;
  saveState({ status: 'checking-tunnel', configInFlight: true });
  try {
    if (!await untilHealthy(apiBase, 30, current)) {
      if (!current()) return;
      throw new Error('The public tunnel did not pass /api/health. Waiting for automatic recovery.');
    }
    if (!current()) return;
    saveState({ tunnelHealthy: true });
    const config = { apiBase };
    if (state.configuredApiBase !== apiBase) {
      const target = path.join(repo, 'public', 'data', 'runtime.json');
      mkdirSync(path.dirname(target), { recursive: true });
      const temp = `${target}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify(config, null, 2) + '\n', { mode: 0o644 });
      renameSync(temp, target);
      saveState({ configuredApiBase: apiBase, configUpdatedAt: new Date().toISOString() });
      console.log(`API: ${apiBase}\nConfig: ${target}`);
    }
    if (publish && state.publishedApiBase !== apiBase) {
      saveState({ status: 'publishing-config' });
      await publishConfig(config);
      if (!current()) return;
      saveState({ publishedApiBase: apiBase, publishedAt: new Date().toISOString() });
      console.log(`Published public/data/runtime.json to ${githubRepo}.`);
    }
    if (current()) saveState({ status: 'running', configError: null, configRetryAttempts: 0, configNextRetryAt: null });
  } catch (error) {
    if (!current()) return;
    const attempts = state.configRetryAttempts + 1;
    const delay = Math.min(15000 * 2 ** Math.min(attempts - 1, 5), 300000);
    saveState({ status: 'config-retry-wait', configError: error.message, configRetryAttempts: attempts, configNextRetryAt: Date.now() + delay });
    console.error(`Configuration update failed: ${error.message}\nAutomatic retry in at least ${delay / 1000} seconds when the tunnel is healthy.`);
  } finally {
    configInFlight = false;
    if (!stopRequested.value) saveState({ configInFlight: false });
    // A tunnel replacement during an earlier attempt needs its own first attempt immediately.
    if (!stopRequested.value && configRequested !== request && configRequested) {
      queueConfig(configRequested.apiBase, configRequested.tunnelPid);
    }
  }
}
let backend;
let tunnel;
let restarts = 0;
const tunnelLog = logStream('tunnel');
async function startTunnel() {
  if (stopRequested.value) return;
  const candidates = [process.env.CLOUDFLARED_BIN, path.join(repo, 'bin', 'cloudflared'), path.resolve(scriptDir, '..', '..', 'bin', 'cloudflared'), path.resolve(scriptDir, '..', '..', 'ops', 'bin', 'cloudflared'), '/opt/homebrew/bin/cloudflared'];
  const binary = candidates.find(candidate => candidate && existsSync(candidate)) || 'cloudflared';
  let buffer = '', found = null;
  tunnel = child(binary, ['tunnel', '--url', localBase, '--protocol', 'http2', '--no-autoupdate'], tunnelLog);
  saveState({ tunnelPid: tunnel.pid ?? null, apiBase: null, status: 'opening-tunnel', tunnelHealthy: false });
  const thisTunnel = tunnel;
  const watchdog = setTimeout(() => {
    if (!stopRequested.value && !found && thisTunnel.exitCode === null) thisTunnel.kill('SIGTERM');
  }, 90000);
  timers.add(watchdog);
  const parse = chunk => {
    buffer = (buffer + chunk.toString()).slice(-12000);
    for (const match of buffer.matchAll(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/g)) {
      if (!found) {
        found = match[0]; clearTimeout(watchdog); timers.delete(watchdog);
        saveState({ apiBase: found, configRetryAttempts: 0, configNextRetryAt: null, configError: null });
        queueConfig(found, thisTunnel.pid);
      }
    }
  };
  tunnel.stdout.on('data', parse);
  tunnel.stderr.on('data', parse);
  tunnel.once('error', error => void shutdown(1, `Cannot launch cloudflared: ${error.message}`));
  tunnel.once('exit', async (code, signal) => {
    clearTimeout(watchdog); timers.delete(watchdog);
    if (stopRequested.value) return;
    saveState({ status: 'tunnel-restarting', tunnelPid: null, tunnelHealthy: false });
    if (++restarts > 8) { await shutdown(1, 'Tunnel exited repeatedly; inspect the private tunnel log.'); return; }
    console.error(`Tunnel exited (${code ?? signal}); retry ${restarts}/8.`);
    await wait(Math.min(restarts * 2000, 15000));
    await startTunnel();
  });
}
async function shutdown(code = 0, reason) {
  if (stopRequested.value) return;
  stopRequested.value = true;
  if (reason) console.error(reason);
  saveState({ status: 'stopping', error: reason || null });
  for (const proc of owned) if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 2000));
  for (const proc of owned) if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
  for (const timer of timers) clearTimeout(timer);
  saveState({ status: 'stopped', stoppedAt: new Date().toISOString(), tunnelPid: null, backendPid: state.backendOwned ? null : state.backendPid, backendHealthy: state.backendOwned ? false : state.backendHealthy, tunnelHealthy: false });
  try { const lock = JSON.parse(readFileSync(lockFile, 'utf8')); if (lock.pid === process.pid) unlinkSync(lockFile); } catch {}
  await Promise.all([...logs].map(stream => new Promise(resolve => stream.end(resolve))));
  process.exit(code);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
process.on('SIGHUP', () => void shutdown());
process.on('uncaughtException', error => void shutdown(1, error.message));
process.on('unhandledRejection', error => void shutdown(1, String(error?.message || error)));

try {
  saveState();
  if (await health(localBase)) {
    saveState({ backendOwned: false, backendHealthy: true });
    console.log(`Reusing existing ${appName} backend at ${localBase}; its data directory cannot be confirmed here. It will remain running when this supervisor stops.`);
  } else {
    backend = child(process.execPath, [backendFile], logStream('backend'), { ...process.env, HOST: '127.0.0.1', PORT: String(port), TTS_MOS_DATA_DIR: dataDir });
    saveState({ backendPid: backend.pid ?? null, backendOwned: true });
    backend.once('error', error => void shutdown(1, `Cannot launch backend: ${error.message}`));
    backend.once('exit', (code, signal) => { if (!stopRequested.value) void shutdown(1, `Backend exited (${code ?? signal}); an occupied port is not terminated. See backend.log.`); });
    if (!await untilHealthy(localBase, 20)) throw new Error('Backend /api/health did not become ready. Check the port and private backend log.');
    saveState({ backendHealthy: true });
  }
  console.log(`Private status: ${stateFile}\nPress Ctrl+C to stop owned processes.`);
  await startTunnel();
  let monitorBusy = false;
  const healthTimer = setInterval(async () => {
    if (stopRequested.value || monitorBusy) return;
    monitorBusy = true;
    const checkedApi = state.apiBase;
    const checkedTunnelPid = tunnel?.pid;
    try {
      const backendHealthy = await health(localBase);
      const tunnelHealthy = checkedApi ? await health(checkedApi) : false;
      if (stopRequested.value) return;
      saveState({ backendHealthy });
      // An old probe must not overwrite state for a replacement tunnel.
      if (!currentTunnel(checkedApi, checkedTunnelPid)) return;
      saveState({ tunnelHealthy });
      if (tunnelHealthy && needsConfig(checkedApi)) {
        queueConfig(checkedApi, checkedTunnelPid);
      } else if (!configInFlight && !needsConfig(checkedApi)) {
        saveState({ status: tunnelHealthy && backendHealthy ? 'running' : 'degraded', configError: null });
      }
    } finally { monitorBusy = false; }
  }, 15000);
  timers.add(healthTimer);
} catch (error) { await shutdown(1, error.message); }
