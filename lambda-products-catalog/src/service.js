const productRepo = require("./product.repository");
const snsRepo = require("./sns.repository");

function validateProduct(product) {
  const { id, name, price, stock } = product ?? {};
  if (
    typeof id !== "number" ||
    typeof name !== "string" ||
    typeof price !== "number" ||
    typeof stock !== "number"
  ) {
    const err = new Error(
      "Product inválido. Se espera {id:number, name:string, price:number, stock:number}"
    );
    err.statusCode = 400;
    err.received = product ?? null;
    throw err;
  }
  return { id, name, price, stock };
}

// Lógica de negocio: validar → evitar duplicado (si hay DB) → publicar.
// El handler (controller) solo traduce event ⇄ HTTP; nunca toca SNS/SQL.
async function publishProduct(input) {
  const product = validateProduct(input?.body ?? input);

  if (await productRepo.existsById(product.id)) {
    const err = new Error(`Product id=${product.id} ya existe`);
    err.statusCode = 409;
    throw err;
  }

  const { messageId, topic } = await snsRepo.publishProductMessage(product);
  console.log("Publicado en SNS:", messageId, product);
  return { messageId, topic, sent: { type: "products", body: product } };
}

module.exports = { publishProduct, validateProduct };
