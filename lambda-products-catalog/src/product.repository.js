const { getPool } = require("./db");

// Repository: único lugar con SQL. No conoce de SNS ni de HTTP.
async function existsById(id) {
  const pool = getPool();
  if (!pool) return false; // sin DB configurada: no bloquea publicación
  const { rows } = await pool.query("SELECT 1 FROM products WHERE id = $1", [id]);
  return rows.length > 0;
}

async function findById(id) {
  const pool = getPool();
  if (!pool) return null;
  const { rows } = await pool.query(
    "SELECT id, name, price, stock FROM products WHERE id = $1",
    [id]
  );
  return rows[0] ?? null;
}

module.exports = { existsById, findById };
