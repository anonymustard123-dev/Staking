import { readFile } from 'node:fs/promises';
import { pool } from './db.ts';
const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
await pool.query(sql);
console.log('Database schema and watchlist ready');
await pool.end();
