const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns");

const REGION = process.env.AWS_REGION || "us-east-2";
const TOPIC_ARN =
  process.env.SNS_TOPIC_ARN ||
  "arn:aws:sns:us-east-2:258344940817:transporte";

const sns = new SNSClient({ region: REGION });

// Recibe un product y lo envía al SNS con {type:"products", body:product}
// Acepta:
//  - Invocación directa: {id, name, price, stock}
//  - API Gateway proxy: {body: "{\"id\":...}"} (body string)
//  - Ya con envoltura: {type:"products", body:{...}} (la respeta)
function extractProduct(event) {
  const src = event?.body
    ? typeof event.body === "string"
      ? JSON.parse(event.body)
      : event.body
    : event;

  return src?.body ?? src;
}

exports.handler = async (event) => {
  const product = extractProduct(event);

  const { id, name, price, stock } = product ?? {};
  if (
    typeof id !== "number" ||
    typeof name !== "string" ||
    typeof price !== "number" ||
    typeof stock !== "number"
  ) {
    console.error("Product inválido:", product);
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "Product inválido. Se espera {id:number, name:string, price:number, stock:number}",
        received: product ?? null,
      }),
    };
  }

  // Formato que pasa el FilterPolicy {"type":["products"]} (scope MessageBody)
  const message = JSON.stringify({ type: "products", body: { id, name, price, stock } });

  const out = await sns.send(
    new PublishCommand({ TopicArn: TOPIC_ARN, Message: message })
  );
  console.log("Publicado en SNS:", out.MessageId, message);

  const statusCode = event?.body !== undefined ? 200 : 200;
  return {
    statusCode,
    body: JSON.stringify({ messageId: out.MessageId, topic: TOPIC_ARN, sent: { type: "products", body: { id, name, price, stock } } }),
  };
};
