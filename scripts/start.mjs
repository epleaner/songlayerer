import net from 'net';
import { spawn } from 'child_process';

const HOST = process.env.HOST || '127.0.0.1';
const parsedPort = Number.parseInt(String(process.env.PORT || '5174'), 10);
const START_PORT = Number.isFinite(parsedPort) ? parsedPort : 5174;
const MAX_ATTEMPTS = 200;

function canListen(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.on('error', () => {
      resolve(false);
    });
    server.listen({ port, host }, () => {
      server.close();
      resolve(true);
    });
  });
}

async function findAvailablePort(start, host) {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const port = start + i;
    // eslint-disable-next-line no-await-in-loop
    if (await canListen(port, host)) return port;
  }
  return null;
}

async function main() {
  const port = await findAvailablePort(START_PORT, HOST);
  if (!port) {
    // eslint-disable-next-line no-console
    console.error(
      `Could not find an available port in range ${START_PORT}-${START_PORT + MAX_ATTEMPTS - 1}`
    );
    process.exit(1);
  }

  if (port !== START_PORT) {
    // eslint-disable-next-line no-console
    console.log(`Port ${START_PORT} in use, starting on ${port}`);
  }

  const child = spawn(process.execPath, ['server.js'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      HOST,
      PORT: String(port),
    },
  });

  child.on('close', (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
