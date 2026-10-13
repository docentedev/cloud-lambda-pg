// Controller: lee los mensajes de SQS (colaInformes) y delega en el service.
// record.body es la envoltura SNS (RawMessageDelivery=false): {"Type":"Notification","Message":"{type,body}",...}
// o, por compatibilidad, el mensaje {type,body} directo.
const service = require("./report.service");

function parseRecord(record) {
  const envelope = JSON.parse(record.body);
  const msgStr = envelope.Message ?? record.body;
  const payload = typeof msgStr === "string" ? JSON.parse(msgStr) : msgStr;
  return { type: payload.type, body: payload.body };
}

exports.handler = async (event) => {
  const records = event.Records ?? [];
  const generated = [];
  for (const record of records) {
    const { type, body } = parseRecord(record);
    if (type !== "report.requested") {
      // El filtro de la suscripción solo deja pasar "report.requested"; cualquier otro es un error de configuración.
      throw new Error(`Tipo de mensaje no soportado: ${type}`);
    }
    generated.push(await service.generateReport(body));
  }
  return { statusCode: 200, body: JSON.stringify(generated) };
};
