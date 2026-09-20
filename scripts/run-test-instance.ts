/** Start only an explicitly prepared fixture, with a sanitised environment. */
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, realpathSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

export function preparedInstanceEnvironment(input: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const root = input.QIUSHUIAI_PREP_ROOT;
  if (!root || !existsSync(root) || lstatSync(root).isSymbolicLink()) throw new Error('Missing prepared test root');
  const real = realpathSync(root);
  if (!real.startsWith(realpathSync('/tmp') + '/qiushuiai-addon-e2e-')) throw new Error('Invalid prepared test root');
  if (readFileSync(resolve(real, '.qiushuiai-addon-e2e-owner'), 'utf8').trim() !== 'qiushuiai disposable addon fixture') throw new Error('Missing fixture owner marker');
  const env = { ...input };
  for (const key of Object.keys(env)) {
    if (/(?:API_KEY|ACCESS_KEY|ACCOUNT_KEY|PRIVATE_KEY|PASSWORD|TOKEN|SECRET|CONNECTION_STRING|_PAT)$/.test(key) || /^(SSH_|GITHUB_|GH_|AZURE_|AWS_|PORTAINER_|PROXMOX_|RESTIC_|MEMENTO_|BORGBACKUPSERVER_)/.test(key)) delete env[key];
  }
  for (const key of ['QIUSHUIAI_WORKSPACE', 'QIUSHUIAI_STORE', 'QIUSHUIAI_DATA', 'QIUSHUIAI_PI_AGENT_DIR', 'PI_CODING_AGENT_DIR', 'HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'TMPDIR', 'TMP', 'TEMP']) {
    const value = env[key];
    if (!value || !realpathSync(value).startsWith(real + sep)) throw new Error(`Missing/outside prepared path: ${key}`);
  }
  // Deliberate test-only auth is mapped to runtime bootstrap names.
  delete env.QIUSHUIAI_KEYCHAIN_KEY;
  if (input.QIUSHUIAI_E2E_INTERNAL_SECRET) env.QIUSHUIAI_INTERNAL_SECRET = input.QIUSHUIAI_E2E_INTERNAL_SECRET;
  if (input.QIUSHUIAI_E2E_KEYCHAIN_KEY) env.QIUSHUIAI_KEYCHAIN_KEY = input.QIUSHUIAI_E2E_KEYCHAIN_KEY;
  delete env.QIUSHUIAI_RUNTIME_ROOT; delete env.QIUSHUIAI_KEYCHAIN_KEY_FILE; delete env.QIUSHUIAI_WEB_TLS_CERT; delete env.QIUSHUIAI_WEB_TLS_KEY;
  delete env.SUPERVISOR_CONF; delete env.QIUSHUIAI_RECORDINGS_DIR; delete env.QIUSHUIAI_WORKSPACE_SEARCH_ROOTS;
  return env;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args[0] === '--') args.shift();
  if (!args.length) throw new Error('Provide the fixture runtime command after --');
  const env = preparedInstanceEnvironment(process.env);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const path = arg === '--workspace' || arg === '-w' ? args[++i] : /^(--workspace|-w)=/.test(arg) ? arg.slice(arg.indexOf('=') + 1) : null;
    if (path !== null && (!path || !resolve(path).startsWith(realpathSync(env.QIUSHUIAI_PREP_ROOT!) + sep))) throw new Error('CLI workspace outside prepared fixture');
  }
  const child = spawn(args[0]!, args.slice(1), { env, stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
  child.on('error', () => process.exit(127));
  child.on('exit', (code) => process.exit(code ?? 1));
}
