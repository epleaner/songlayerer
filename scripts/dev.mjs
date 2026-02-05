import { spawn } from 'child_process';

function run(cmd, args, name) {
  const child = spawn(cmd, args, {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('close', (code) => {
    if (code !== 0) {
      // eslint-disable-next-line no-console
      console.error(`${name} exited with code ${code}`);
      process.exit(code ?? 1);
    }
  });
  return child;
}

const server = run(process.execPath, ['server.js', '--dev'], 'server');
const vite = run('vite', [], 'vite');

function shutdown() {
  server.kill('SIGTERM');
  vite.kill('SIGTERM');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

