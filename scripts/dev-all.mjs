import { spawn } from 'node:child_process';

/**
 * Arranca API y frontend a la vez. Se prefiere a `concurrently` para no añadir
 * otra dependencia por algo que son veinte líneas, y para garantizar que al
 * cerrar uno se cierra el otro: dejar el API huérfano ocupando el puerto es la
 * forma más habitual de perder cinco minutos en el siguiente arranque.
 */
const RESET = '[0m';

const definitions = [
  { name: 'api', args: ['run', 'dev:api'], color: '[36m' },
  { name: 'web', args: ['run', 'dev'], color: '[35m' },
];

const children = definitions.map(({ name, args, color }) => {
  const child = spawn('npm', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  const prefix = `${color}[${name}]${RESET}`;
  const relay = (chunk) => {
    for (const line of chunk.toString().split('\n')) {
      if (line.trim()) console.log(`${prefix} ${line}`);
    }
  };
  child.stdout.on('data', relay);
  child.stderr.on('data', relay);
  child.on('exit', (code) => {
    console.log(`${prefix} terminó con código ${code}`);
    shutdown();
  });
  return child;
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(0), 500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
