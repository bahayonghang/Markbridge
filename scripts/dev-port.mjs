import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';

export const devPortCandidates = [1420, 14200, 18080, 24680, 41720, 43120];

function canListen(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

export async function chooseDevPort() {
  const raw = process.env.MARKBRIDGE_DEV_PORT;
  const candidates = raw === undefined || raw === '' ? devPortCandidates : [Number(raw)];
  if (!Number.isInteger(candidates[0]) || candidates[0] < 1 || candidates[0] > 65535) {
    throw new Error('DEV_PORT_INVALID');
  }
  for (const port of candidates) {
    if (await canListen(port)) return port;
  }
  throw new Error('DEV_PORT_UNAVAILABLE');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${await chooseDevPort()}\n`);
}
