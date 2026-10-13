// Único lugar que entrega el informe: lo publica como aviso en la API de notificaciones.
//   POST {API_NOTIFICATION}/saas/notices   Authorization: ApiKey {API_TOKEN_INTEGRATION}   {"text": "..."}
//
// Variables de entorno de la Lambda:
//   API_NOTIFICATION       URL base de la API (con o sin "/" final)
//   API_TOKEN_INTEGRATION  API key (crr_...). Nunca se escribe en los logs.
//   NOTIFY_MODE=log        solo para desarrollo local: imprime el aviso en vez de publicarlo
const TIMEOUT_MS = 8000;

async function sendReport(report) {
  if (process.env.NOTIFY_MODE === "log") {
    console.log(`[NOTIFY_MODE=log] Aviso para ${report.requester}:\n${report.text}`);
    return { delivered: false };
  }

  const base = process.env.API_NOTIFICATION;
  const token = process.env.API_TOKEN_INTEGRATION;
  if (!base || !token) {
    // Falla a propósito: el mensaje se reintenta y, tras 3 intentos, queda en la DLQ en vez de perderse.
    throw new Error("Faltan API_NOTIFICATION y/o API_TOKEN_INTEGRATION en la configuración de la Lambda");
  }

  const url = `${base.replace(/\/+$/, "")}/saas/notices`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `ApiKey ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: report.text }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`La API de avisos rechazó la publicación: HTTP ${res.status} ${detail}`);
  }
  console.log(`Aviso publicado (HTTP ${res.status}) para ${report.requester}, informe ${report.reportId}`);
  return { delivered: true };
}

module.exports = { sendReport };
