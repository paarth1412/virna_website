import { AsyncLocalStorage } from 'node:async_hooks';
import { getDatabase } from '@netlify/database';

// Netlify Database (Postgres). The schema lives in netlify/database/migrations/,
// which Netlify applies on every deploy.
let pool;
const getPool = () => (pool ??= getDatabase().pool);

// Queries made inside tx() run on that transaction's connection.
const txClient = new AsyncLocalStorage();

// The app writes SQL with ? placeholders; Postgres wants $1, $2, ...
const toPg = sql => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };

function query(sql, params) {
  return (txClient.getStore() || getPool()).query(toPg(sql), params);
}

export const one = async (sql, ...params) => (await query(sql, params)).rows[0];
export const all = async (sql, ...params) => (await query(sql, params)).rows;
export const run = async (sql, ...params) => {
  const res = await query(sql, params);
  return { changes: res.rowCount, rows: res.rows };
};

// Runs fn inside a transaction; any throw rolls everything back. Nested calls join the outer one.
export async function tx(fn) {
  if (txClient.getStore()) return fn();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await txClient.run(client, fn);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function closeDb() {
  if (pool) await pool.end();
  pool = undefined;
}
