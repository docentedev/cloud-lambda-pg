const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;

// Supabase exige SSL; en local (Postgres sin SSL) se desactiva con DATABASE_SSL=false.
const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
});

const MESSAGE_TYPE = "report.requested";

// record.body es la envoltura SNS (RawMessageDelivery=false):
//   {"Type":"Notification","Message":"{\"type\":\"report.requested\",\"body\":{...}}",...}
// o, por compatibilidad, el mensaje {type, body} directo.
function parseRecord(record) {
  const envelope = JSON.parse(record.body);
  const msgStr = envelope.Message ?? record.body;
  const payload = typeof msgStr === "string" ? JSON.parse(msgStr) : msgStr;
  return { type: payload.type, body: payload.body };
}

// Idempotente: SQS entrega "al menos una vez", un reintento no duplica la solicitud.
async function insertReportRequest(client, body) {
  console.log("Procesando solicitud de informe de SQS:", body);
  const res = await client.query(
    `INSERT INTO report_requests (id, requester, requester_id, type, params, requested_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (id) DO NOTHING
     RETURNING *;`,
    [
      body.requestId,
      body.requester,
      body.requesterId,
      body.reportType,
      JSON.stringify(body.params ?? {}),
      body.requestedAt,
    ],
  );
  console.log("Solicitud de informe registrada:", res.rows[0] ?? body.requestId);
  return res.rows[0];
}

exports.handler = async (event) => {
  const records = event.Records ?? [];
  let client;
  try {
    client = await pool.connect();
    const inserted = [];
    for (const record of records) {
      const { type, body } = parseRecord(record);
      if (type !== MESSAGE_TYPE) {
        throw new Error(`Tipo de mensaje no soportado: ${type}`);
      }
      const row = await insertReportRequest(client, body);
      if (row) inserted.push(row);
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
