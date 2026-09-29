const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

exports.handler = async (event) => {
  const records = event.Records ?? [];
    let client;
    try {
        client = await pool.connect();
        const inserted = [];
        for (const record of records) {
      const body = JSON.parse(record.body);
      console.log("Procesando producto de SQS:", body);

      const queryText = `
                INSERT INTO products (id, name, price, stock) 
                VALUES ($1, $2, $3, $4) 
                RETURNING *;
            `;
      const values = [body.id, body.name, body.price, body.stock];

      const res = await client.query(queryText, values);
      console.log(
        "Producto insertado en PostgreSQL exitosamente:",
        res.rows[0],
      );
      inserted.push(res.rows[0]);
    }

    return {
      statusCode: 200,
      body: JSON.stringify(inserted),
    };
  } catch (error) {
    console.error("Error al insertar en PostgreSQL:", error);
    throw error;
  } finally {
    if (client) client.release();
  }
};
