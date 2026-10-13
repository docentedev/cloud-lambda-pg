// Repository: único lugar que habla con la base de datos (tabla products, la misma que usa el BFF).
const { Pool } = require("pg");

let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Supabase exige SSL; en local (Postgres sin SSL) se desactiva con DATABASE_SSL=false.
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
      max: 1,
    });
  }
  return pool;
}

async function topByPrice(limit = 10) {
  const { rows } = await getPool().query(
    `SELECT id, name, price, stock
       FROM products
      WHERE price IS NOT NULL
      ORDER BY price DESC
      LIMIT $1`,
    [limit],
  );
  return rows;
}

module.exports = { topByPrice };
