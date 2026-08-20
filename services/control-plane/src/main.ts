/** Entry point: `npm run server` (repo root). LAN/private alpha host. */
import { DEFAULT_SERVER_PORT } from '@arena/contracts';
import { createControlPlane } from './server';

const port = Number(process.env.ARENA_PORT ?? DEFAULT_SERVER_PORT);
const cp = await createControlPlane({ port });

console.log(`[control-plane] Infinite Arena room server listening on ws://0.0.0.0:${cp.port}`);
console.log(
  `[control-plane] join hint: point clients at ws://<this-machine's-LAN-IP>:${cp.port}, ` +
    `send {"t":"hello","name":"YourName"}, then {"t":"create_room","experimental":false} ` +
    `or {"t":"join_room","roomId":"<CODE>","as":"player"}`,
);

const shutdown = async () => {
  console.log('[control-plane] shutting down…');
  await cp.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
