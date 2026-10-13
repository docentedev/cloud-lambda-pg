// Único lugar que entrega el informe: lo publica como aviso en la API de notificaciones.
//   POST {API_NOTIFICATION}/saas/notices   Authorization: ApiKey {API_TOKEN_INTEGRATION}   {"text": "..."}
//
// Variables de entorno de la Lambda:
//   API_NOTIFICATION       URL del sitio de la app (ej. https://mi-app.example.com/). La API cuelga de /api, que se
//                          agrega solo; si ya viene incluido (…/api) no se duplica.
//   API_TOKEN_INTEGRATION  API key (crr_...). Nunca se escribe en los logs.
//   NOTIFY_MODE=log        solo para desarrollo local: imprime el aviso en vez de publicarlo
//
// Toda respuesta que no sea un 2xx con JSON se trata como error: el mensaje se reintenta y, tras 3 intentos,
// va a la DLQ. Así un aviso nunca se da por entregado cuando no se creó.
const TIMEOUT_MS = 8000;

// La API publica en POST /api/saas/notices. API_NOTIFICATION puede ser la URL del sitio o ya incluir /api.
function noticesUrl(base) {
  const root = base.trim().replace(/\/+$/, "");
  const withApi = /\/api$/i.test(root) ? root : `${root}/api`;
  return `${withApi}/saas/notices`;
}

function describeFailure(res, contentType, body) {
  if (res.status >= 300 && res.status < 400) {
    // Un redirect convertiría el POST en GET y el aviso no se crearía aunque la respuesta parezca exitosa.
    return `redirección a ${res.headers.get("location") ?? "(sin Location)"}: usa ese destino, sin el /api/saas/notices final, como API_NOTIFICATION`;
  }
  if (/text\/html/i.test(contentType) || /^\s*</.test(body)) {
    return "respuesta HTML: la URL no responde como la API; revisa API_NOTIFICATION (debe ser el sitio de la app)";
  }
  return body.slice(0, 200);
}

async function sendReport(report) {
  if (process.env.NOTIFY_MODE === "log") {
    console.log(`[NOTIFY_MODE=log] Aviso para ${report.requester}:\n${report.text}`);
    return { delivered: false };
  }

  const base = process.env.API_NOTIFICATION;
  const token = process.env.API_TOKEN_INTEGRATION;
  if (!base || !token) {
    throw new Error("Faltan API_NOTIFICATION y/o API_TOKEN_INTEGRATION en la configuración de la Lambda");
  }

  const url = noticesUrl(base);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `ApiKey ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: report.text }),
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const contentType = res.headers.get("content-type") ?? "";
  const body = await res.text().catch(() => "");

  if (!res.ok || !/json/i.test(contentType)) {
    const detail = res.ok
      ? `respuesta inesperada (${contentType || "sin content-type"}), no es JSON: ${describeFailure(res, contentType, body)}`
      : describeFailure(res, contentType, body);
    throw new Error(`La API de avisos rechazó la publicación: HTTP ${res.status} ${detail}`);
  }

  console.log(`Aviso publicado (HTTP ${res.status}) para ${report.requester}, informe ${report.reportId}`);
  return { delivered: true };
}

module.exports = { sendReport, noticesUrl };
