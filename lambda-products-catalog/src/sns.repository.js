const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns");

const REGION = process.env.AWS_REGION || "us-east-2";
const TOPIC_ARN =
  process.env.SNS_TOPIC_ARN ||
  "arn:aws:sns:us-east-2:258344940817:transporte";

const sns = new SNSClient({ region: REGION });

// Repository: único lugar que habla con SNS. Recibe payload ya validado.
async function publishProductMessage(product) {
  const message = JSON.stringify({ type: "products", body: product });
  const out = await sns.send(
    new PublishCommand({ TopicArn: TOPIC_ARN, Message: message })
  );
  return { messageId: out.MessageId, topic: TOPIC_ARN, message };
}

module.exports = { publishProductMessage, TOPIC_ARN };
