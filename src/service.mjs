import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultDataDir } from './config.mjs';

export const SERVICE_ID = 'io.github.beichenO2.goodnight';

const defaultEntry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/goodnight.mjs');
const badValue = /[\0\r\n]/;

function safe(value, name) {
  if (typeof value !== 'string' || !value || badValue.test(value)) {
    throw new TypeError(`${name} must be a non-empty string without NUL or newline characters`);
  }
  return value;
}

function xml(value) {
  return safe(value, 'XML value').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function plistString(value) {
  return `    <string>${xml(value)}</string>`;
}

// systemd uses a small, documented quoting language for ExecStart arguments.
function systemdArg(value) {
  safe(value, 'systemd argument');
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('$', () => '$$').replaceAll('%', '%%')}"`;
}

function windowsArg(value) {
  safe(value, 'Windows argument');
  // Quote using the Windows command-line escaping rules (backslashes before quotes/end).
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`;
}

function resolveOptions(options = {}) {
  const platform = options.platform ?? process.platform;
  if (!['darwin', 'win32', 'linux'].includes(platform)) throw new Error(`Unsupported service platform: ${platform}`);
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const env = { ...process.env, ...(options.env ?? {}) };
  const homeValue = options.home ?? (platform === 'win32'
    ? options.env?.USERPROFILE ?? process.env.USERPROFILE ?? ''
    : env.HOME ?? env.USERPROFILE ?? '');
  const home = paths.resolve(safe(homeValue, 'home'));
  const dataDir = options.dataDir === undefined
    ? safe(defaultDataDir({ platform, home, env }), 'dataDir')
    : paths.resolve(safe(options.dataDir, 'dataDir'));
  const entrypoint = paths.resolve(safe(options.entrypoint ?? defaultEntry, 'entrypoint'));
  const node = paths.resolve(safe(options.node ?? process.execPath, 'node'));
  const mode=options.mode??'daemon';
  if(!['daemon','web'].includes(mode))throw new Error('Service mode must be daemon or web');
  const args = [mode, '--data-dir', dataDir];
  if(mode==='web'){
    const port=options.port??3210;if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid web port');
    args.push('--port',String(port));
  }
  return { ...options, platform, env, home, dataDir, entrypoint, node, args };
}

function renderDarwin(o) {
  const file = path.posix.join(o.home, 'Library', 'LaunchAgents', `${SERVICE_ID}.plist`);
  const args = [o.node, o.entrypoint, ...o.args].map(plistString).join('\n');
  const content = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n  <key>Label</key>\n${plistString(SERVICE_ID)}\n  <key>ProgramArguments</key>\n  <array>\n${args}\n  </array>\n  <key>RunAtLoad</key>\n  <true/>\n  <key>KeepAlive</key>\n  <true/>\n  <key>WorkingDirectory</key>\n${plistString(o.home)}\n</dict>\n</plist>\n`;
  const uid = o.env.UID ?? String(os.userInfo().uid);
  const target = `gui/${uid}/${SERVICE_ID}`;
  return {
    files: [{ path: file, content }],
    commands: [
      { file: 'launchctl', args: ['bootout', target], optional: true, ignoreExitCodes: [3] },
      { file: 'launchctl', args: ['bootstrap', `gui/${uid}`, file] },
    ],
    uninstallCommands: [{ file: 'launchctl', args: ['bootout', target], optional: true, ignoreExitCodes: [3] }],
  };
}

function renderLinux(o) {
  const file = path.posix.join(o.home, '.config', 'systemd', 'user', `${SERVICE_ID}.service`);
  const exec = [o.node, o.entrypoint, ...o.args].map(systemdArg).join(' ');
  const content = `[Unit]\nDescription=GoodNight user daemon\nPartOf=graphical-session.target\n\n[Service]\nType=simple\nExecStart=${exec}\nRestart=on-failure\n\n[Install]\nWantedBy=graphical-session.target\n`;
  return {
    files: [{ path: file, content }],
    commands: [
      { file: 'systemctl', args: ['--user', 'daemon-reload'] },
      { file: 'systemctl', args: ['--user', 'enable', `${SERVICE_ID}.service`] },
      { file: 'systemctl', args: ['--user', 'restart', `${SERVICE_ID}.service`] },
    ],
    uninstallCommands: [
      { file: 'systemctl', args: ['--user', 'disable', '--now', `${SERVICE_ID}.service`] },
      { file: 'systemctl', args: ['--user', 'daemon-reload'] },
    ],
  };
}

function renderWindows(o) {
  const base = o.env.LOCALAPPDATA || path.win32.join(o.home, 'AppData', 'Local');
  const file = path.win32.join(base, 'GoodNight', `${SERVICE_ID}.xml`);
  const launcher=path.win32.resolve(path.win32.dirname(o.entrypoint),'..',`${SERVICE_ID}.vbs`);
  const launchLog=path.win32.join(base,'GoodNight',`${SERVICE_ID}.log`);
  const username = safe(o.env.USERNAME ?? '', 'Windows username (USERNAME environment variable)');
  const principal = o.env.USERDOMAIN ? `${safe(o.env.USERDOMAIN, 'Windows user domain')}\\${username}` : username;
  const args = [o.node,o.entrypoint,...o.args].map(windowsArg).join(' ');
  const vbsString=value=>`"${safe(value,'VBScript value').replaceAll('\"','\"\"')}"`;
  const command=`cmd.exe /d /s /c "${args} >> ${windowsArg(launchLog)} 2>&1"`;
  const launcherContent=`Set shell = CreateObject("WScript.Shell")\r\nshell.CurrentDirectory = ${vbsString(o.home)}\r\nexitCode = shell.Run(${vbsString(command)}, 0, True)\r\nWScript.Quit exitCode\r\n`;
  const wscript=path.win32.join(o.env.SystemRoot||'C:\\Windows','System32','wscript.exe');
  const content = `<?xml version="1.0" encoding="UTF-16"?>\n<Task xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task" version="1.3">\n  <RegistrationInfo><Description>GoodNight per-user daemon</Description><URI>\\${SERVICE_ID}</URI></RegistrationInfo>\n  <Triggers><LogonTrigger><UserId>${xml(principal)}</UserId><Enabled>true</Enabled></LogonTrigger></Triggers>\n  <Principals><Principal id="Author"><UserId>${xml(principal)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>\n  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>true</AllowHardTerminate><StartWhenAvailable>true</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable><AllowStartOnDemand>true</AllowStartOnDemand><Enabled>true</Enabled><Hidden>false</Hidden><WakeToRun>false</WakeToRun><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure><Priority>7</Priority></Settings>\n  <Actions Context="Author"><Exec><Command>${xml(wscript)}</Command><Arguments>${xml(windowsArg(launcher))}</Arguments><WorkingDirectory>${xml(o.home)}</WorkingDirectory></Exec></Actions>\n</Task>\n`;
  return {
    files: [{ path: file, content, encoding: 'utf16le' },{path:launcher,content:launcherContent,encoding:'utf16le'}],
    commands: [
      { file: 'schtasks.exe', args: ['/End', '/TN', SERVICE_ID], optional: true, ignoreExitCodes: [1] },
      { file: 'schtasks.exe', args: ['/Create', '/TN', SERVICE_ID, '/XML', file, '/F'] },
      { file: 'schtasks.exe', args: ['/Run', '/TN', SERVICE_ID] },
    ],
    uninstallCommands: [
      { file: 'schtasks.exe', args: ['/End', '/TN', SERVICE_ID], optional: true, ignoreExitCodes: [1] },
      { file: 'schtasks.exe', args: ['/Delete', '/TN', SERVICE_ID, '/F'] },
    ],
  };
}

export function renderService(options = {}) {
  const o = resolveOptions(options);
  return (o.platform === 'darwin' ? renderDarwin(o) : o.platform === 'linux' ? renderLinux(o) : renderWindows(o));
}

function defaultRunner(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function runCommands(commands, runner) {
  for (const command of commands) {
    const { file, args } = command;
    let result;
    try { result = await runner(file, args); }
    catch (cause) {
      const reason = cause?.code === 'ENOENT' ? 'missing tooling' : cause?.code === 'EACCES' || cause?.code === 'EPERM' ? 'permission denied' : 'could not run';
      throw new Error(`Service command ${file} ${reason}: ${cause.message}`, { cause });
    }
    if (result?.code !== 0 && command.optional === true && command.ignoreExitCodes?.includes(result?.code)) continue;
    if (result?.code !== 0) {
      const reason = result?.code === 5 ? 'permission denied' : `failed with exit code ${result?.code ?? 'unknown'}`;
      throw new Error(`Service command ${file} ${reason}`);
    }
  }
}

async function writeRendered(files) {
  for (const file of files) {
    await mkdir(path.dirname(file.path), { recursive: true });
    const encoding = file.encoding ?? 'utf8';
    const content = encoding === 'utf16le' ? '\uFEFF' + file.content : file.content;
    await writeFile(file.path, content, { encoding, mode: 0o600 });
  }
}

export async function installService(options = {}) {
  const rendered = renderService(options);
  await writeRendered(rendered.files);
  if (options.apply !== false) await runCommands(rendered.commands, options.commandRunner ?? defaultRunner);
  return rendered;
}

export async function uninstallService(options = {}) {
  const rendered = renderService(options);
  if (options.apply !== false) await runCommands(rendered.uninstallCommands, options.commandRunner ?? defaultRunner);
  // Delete only the exact generated artifact belonging to this service.
  for (const file of rendered.files) await rm(file.path, { force: true });
  return rendered;
}
