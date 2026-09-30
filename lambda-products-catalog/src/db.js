const { Pool } = require("pg");

// Pool singleton. Si no hay DATABASE_URL (publisher puro SNS),
// pool queda en null y el repository omite el chequeo de duplicados.
let pool = null;

function getPool() {
  if (pool) return pool;
  if (!process.env.DATABASE_URL) return null;
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  return pool;
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { getPool, closePool };
