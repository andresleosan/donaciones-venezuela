#!/usr/bin/env node
// Lanza `firebase emulators:exec` garantizando un JDK >= 21 en el PATH.
//
// Por qué existe: firebase-tools >= 15 rechaza Java < 21, y en Windows es común
// que el `java` del PATH sea un JRE 8 heredado (Oracle "java8path") aunque exista
// un JDK 21 instalado o declarado en JAVA_HOME. Sin esto, `npm run test:rules`,
// `test:functions`, `test:emulators` y `verify` fallan sin tocar una sola prueba.
//
// Uso: node scripts/emulators-exec.mjs <args de firebase emulators:exec...>
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, join } from 'node:path';

const MIN_JAVA = 21;
const require = createRequire(import.meta.url);
const firebaseBin = require.resolve('firebase-tools/lib/bin/firebase.js');

function javaMajor(javaPath) {
  const result = spawnSync(javaPath, ['-version'], { encoding: 'utf8' });
  if (result.error) return 0;
  const text = `${result.stderr || ''}${result.stdout || ''}`;
  const match = text.match(/version "(\d+)(?:\.(\d+))?/);
  if (!match) return 0;
  const major = Number(match[1]);
  return major === 1 ? Number(match[2] || 0) : major;
}

function candidateHomes() {
  const homes = [];
  if (process.env.JAVA_HOME) homes.push(process.env.JAVA_HOME);
  const roots = process.platform === 'win32'
    ? [
      'C:\Program Files\Eclipse Adoptium',
      'C:\Program Files\Microsoft',
      'C:\Program Files\Java',
      'C:\Program Files\Amazon Corretto',
      'C:\Program Files\Zulu',
      'C:\Program Files\BellSoft',
    ]
    : ['/usr/lib/jvm', '/Library/Java/JavaVirtualMachines', '/opt/homebrew/opt'];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      if (/jdk|zulu|corretto|liberica|openjdk/i.test(entry)) {
        homes.push(join(root, entry));
        homes.push(join(root, entry, 'Contents', 'Home'));
      }
    }
  }
  return homes;
}

function javaBinary(home) {
  return join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
}

function resolveJavaHome() {
  if (javaMajor('java') >= MIN_JAVA) return null; // el PATH ya sirve
  for (const home of candidateHomes()) {
    const binary = javaBinary(home);
    if (existsSync(binary) && javaMajor(binary) >= MIN_JAVA) return home;
  }
  return undefined;
}

const javaHome = resolveJavaHome();
if (javaHome === undefined) {
  console.error(`[emulators-exec] No se encontró un JDK ${MIN_JAVA}+ (ni en PATH, JAVA_HOME ni en las rutas habituales). Instala Temurin ${MIN_JAVA} y reintenta.`);
  process.exit(1);
}

const env = { ...process.env };
if (javaHome) {
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') || 'PATH';
  env[pathKey] = `${join(javaHome, 'bin')}${delimiter}${env[pathKey] || ''}`;
  env.JAVA_HOME = javaHome;
  console.log(`[emulators-exec] Usando JDK ${MIN_JAVA}+ de ${javaHome}`);
}

const child = spawn(process.execPath, [firebaseBin, 'emulators:exec', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
