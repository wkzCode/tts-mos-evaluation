#!/opt/homebrew/bin/node
import { readFileSync, realpathSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const args = process.argv.slice(2);
if (args.includes('--help')) { console.log('Usage: node scripts/stop-local.mjs [--repo /absolute/repository]\nUse the same TTS_MOS_DATA_DIR as the launch command.'); process.exit(0); }
let repoArg;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--repo' && args[i + 1]) repoArg = args[++i];
  else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
}
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repo = realpathSync(path.resolve(repoArg || path.join(scriptDir, '..')));
const dataCandidate = path.resolve(process.env.TTS_MOS_DATA_DIR || path.join(repo, '..', 'private-data'));
const dataDir = existsSync(dataCandidate) ? realpathSync(dataCandidate) : dataCandidate;
const lockFile = path.join(dataDir, 'ops', 'supervisor.lock');
if (!existsSync(lockFile)) { console.log('No supervisor lock found; no process was stopped.'); process.exit(0); }
const lock = JSON.parse(readFileSync(lockFile, 'utf8'));
if (lock.repo !== repo || !Number.isSafeInteger(lock.pid) || lock.pid <= 1) throw new Error('Supervisor lock does not match this repository. No process was stopped.');
let command;
try { command = (await promisify(execFile)('/bin/ps', ['-p', String(lock.pid), '-o', 'command='])).stdout.trim(); }
catch { console.log('Supervisor PID is no longer running; no process was stopped. A future launch can reclaim the stale lock.'); process.exit(0); }
if (!lock.script || !command.includes(lock.script) || !path.basename(lock.script).endsWith('launch-local.mjs')) {
  throw new Error('PID command does not match the recorded supervisor; no process was stopped.');
}
process.kill(lock.pid, 'SIGINT');
console.log(`Sent SIGINT to supervisor ${lock.pid}. Only its owned children will be stopped. See ${path.join(dataDir, 'ops', 'status.json')}.`);
