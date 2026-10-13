const productRepo = require("./product.repository");
const notifier = require("./notifier");

const TOP = 10;
const MAX_TEXT = 2000; // límite de la API de avisos (1-2000 caracteres)

function validateRequest(body) {
  const { requestId, requester, reportType } = body ?? {};
  if (!requestId || !requester || !reportType) {
    throw new Error(
      "Solicitud inválida. Se espera {requestId, requester, reportType, params?, requestedAt?}"
    );
  }
  return body;
}

function formatPrice(value) {
  return `$${Number(value).toLocaleString("es-CL", { maximumFractionDigits: 2 })}`;
}

// Arma el texto del aviso: encabezado + los productos más caros.
function buildMessage(report, products) {
  const lines = [
    `Informe ${report.type} solicitado por ${report.requester}.`,
    products.length === 0
      ? "No hay productos registrados."
      : `Los ${products.length} productos más caros:`,
    ...products.map((p, i) => {
      const name = String(p.name ?? "(sin nombre)").slice(0, 60);
      return `${i + 1}. ${name} - ${formatPrice(p.price)} (stock ${p.stock ?? 0})`;
    }),
  ];
  const text = lines.join("\n");
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 3)}...` : text;
}

// Lógica de negocio: validar → traer los productos más caros → armar el mensaje → publicarlo.
async function generateReport(input) {
  const request = validateRequest(input);
  const products = await productRepo.topByPrice(TOP);

  const report = {
    reportId: request.requestId,
    type: request.reportType,
    requester: request.requester,
    params: request.params ?? {},
    requestedAt: request.requestedAt,
    generatedAt: new Date().toISOString(),
  };
  report.text = buildMessage(report, products);

  await notifier.sendReport(report);
  return {
    reportId: report.reportId,
    type: report.type,
    requester: report.requester,
    products: products.length,
  };
}

module.exports = { generateReport, buildMessage };
