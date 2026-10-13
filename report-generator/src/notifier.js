// Único lugar que entrega el informe. Hoy es un console.log;
// para enviar por email, reemplazar el cuerpo por SES (@aws-sdk/client-ses) hacia report.requester.
async function sendReport(report) {
  console.log(`Informe generado para ${report.requester}:`, JSON.stringify(report, null, 2));
}

module.exports = { sendReport };
