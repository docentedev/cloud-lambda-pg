// Controller: procesa el mensaje de entrada y el retorno HTTP.
// Acepta invocación directa {id,...}, API Gateway v2 {body:"..."} y pre-envuelto {type,body}.
const service = require("./service");

function extractInput(event) {
  const src =
    event?.body !== undefined
      ? typeof event.body === "string"
        ? JSON.parse(event.body)
        : event.body
      : event;
  return src;
}

exports.handler = async (event) => {
  try {
    const result = await service.publishProduct(extractInput(event));
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    const statusCode = err.statusCode ?? 500;
    console.error("Error en catalog:", err.message);
    return {
      statusCode,
      body: JSON.stringify({
        error: err.message,
        ...(err.received !== undefined ? { received: err.received } : {}),
      }),
    };
  }
};
