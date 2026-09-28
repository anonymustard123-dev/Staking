import { spawn, type ChildProcess } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

// Embedded PostgreSQL for a one-command, persistent local preview.
// Production remains a normal PostgreSQL deployment with a separate worker.
const db = await PGlite.create('./.local-db');
const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 5433, maxConnections: 8 });
await socket.start();
const environment = { ...process.env, DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5433/postgres', NODE_USE_SYSTEM_CA: '1' };
const run = (file: string) => spawn(process.execPath, ['--experimental-strip-types', file], { cwd: process.cwd(), env: environment, stdio: 'inherit' });
const migrate = run('server/migrate.ts');
const migrated = await new Promise<boolean>(resolve => migrate.once('exit', code => resolve(code === 0)));
if (!migrated) { await socket.stop(); await db.close(); process.exit(1); }
const children: ChildProcess[] = [run('server/index.ts'), run('server/collector.ts')];
console.log('Local persistent monitor ready: http://127.0.0.1:3001');
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill();
  await socket.stop(); await db.close();
  process.exit(0);
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
for (const child of children) child.once('exit', code => { if (!closing) { console.error(`Local service exited (${code})`); void close(); } });
