const notifier = require("./notifier");

function validateRequest(body) {
  const { requestId, requester, reportType } = body ?? {};
  if (!requestId || !requester || !reportType) {
    throw new Error(
      "Solicitud inválida. Se espera {requestId, requester, reportType, params?, requestedAt?}"
    );
  }
  return body;
}

// Lógica de negocio: validar → armar el informe → entregarlo.
// Por ahora el informe solo describe la solicitud; acá se consultará la DB para llenarlo.
async function generateReport(input) {
  const request = validateRequest(input);

  const report = {
    reportId: request.requestId,
    type: request.reportType,
    requester: request.requester,
    params: request.params ?? {},
    requestedAt: request.requestedAt,
    generatedAt: new Date().toISOString(),
  };

  await notifier.sendReport(report);
  return { reportId: report.reportId, type: report.type, requester: report.requester };
}

module.exports = { generateReport };
