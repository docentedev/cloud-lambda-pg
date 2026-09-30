# Guía única paso a paso: SNS → SQS → Lambda → Postgres

Para estudiantes. Todo verificado con `awscli` el 2026-09-30.
Cuenta `258344940817`, región real `us-east-2` (el PC trae `us-east-1` por defecto, ese es el error típico).

```
Producer --publish--> SNS transporte --filtro--> SQS miCola --trigger--> Lambda miReceptor --INSERT--> Postgres products
```

| Recurso | Valor |
|---|---|
| SNS | `arn:aws:sns:us-east-2:258344940817:transporte` |
| SQS ARN | `arn:aws:sqs:us-east-2:258344940817:miCola` |
| SQS URL | `https://sqs.us-east-2.amazonaws.com/258344940817/miCola` |
| Lambda | `miReceptor` en `us-east-2` |
| Suscripción | `transporte:8d6314e1-c8b2-4b0c-ba89-3a74284c3abd`, `sqs`, `FilterPolicy {"type":["products"]}`, `Scope MessageBody`, `Raw false` |
| Tabla | `products(id, name, price, stock)` |

> `REGION=us-east-2` en todos los comandos. Si lo omites, buscas en `us-east-1` y sale vacío aunque exista.

---

## Paso 0. Quién soy y dónde estoy

```bash
export REGION=us-east-2
export TOPIC=arn:aws:sns:us-east-2:258344940817:transporte
export QUEUE=https://sqs.us-east-2.amazonaws.com/258344940817/miCola

aws sts get-caller-identity
aws configure get region
# -> 258344940817, us-east-1 (por eso hay que pasar --region siempre)
```

## Paso 1. Buscar SNS y SQS (no te dejes engañar por vacío)

```bash
# Mal (región por defecto): da vacío y confunde
aws sns list-topics --output json
# -> {"Topics": []}
aws sqs list-queues --output json
aws sqs get-queue-url --queue-name miCola
# -> NonExistentQueue (solo significa "no está en us-east-1")

# Bien:
aws sns list-topics --region $REGION
# -> arn:aws:sns:us-east-2:258344940817:transporte
aws sqs get-queue-url --queue-name miCola --region $REGION
aws sqs list-queues --region $REGION

# Detalle:
aws sns get-topic-attributes --topic-arn $TOPIC --region $REGION
# -> SubscriptionsConfirmed 1
aws sqs get-queue-attributes --queue-url $QUEUE --attribute-names All --region $REGION
# -> Policy ya autoriza a sns.amazonaws.com con SourceArn=transporte
```

Regla: `list-*` vacío = “puede ser región equivocada”, no “no existe”.

## Paso 2. Ver la suscripción y el filtro (política vs mensaje)

```bash
aws sns list-subscriptions-by-topic --topic-arn $TOPIC --region $REGION
aws sns get-subscription-attributes \
  --subscription-arn "arn:aws:sns:us-east-2:258344940817:transporte:8d6314e1-c8b2-4b0c-ba89-3a74284c3abd" \
  --region $REGION
# FilterPolicy {"type":["products"]}, Scope MessageBody, Raw false, endpoint miCola
```

La duda clásica: **política `{"type":["products"]}` ¿obliga a enviar array? No.**

- Política = lista de permitidos (OR). `{"type":["products"]}` = “pasa si `type==products`”. Con dos sería `["products","orders"]`.
- Mensaje = valor concreto. Envía `{"type":"products",...}`.

Lo probado en esta sesión:

| Mensaje | ¿Llega? | ID |
|---|---|---|
| `{"type":"products","body":{"id":991,...}}` | SÍ | `eabf01f1-...` |
| `{"type":["products"],"body":{"id":992,...}}` | SÍ (SNS matchea array que contiene el valor) | `b0159e9e-...` |
| `{"type":"orders","body":{"id":993,...}}` | NO, filtrado, Lambda nunca lo vio | `3851f1b7-...` |

Usa string `"products"`: simple, calza con tu modelo, evita enredos.

## Paso 3. Enviar bien al SNS

```bash
aws sns publish --topic-arn $TOPIC --region $REGION \
  --message '{"type":"products","body":{"id":991,"name":"Producto de prueba","price":29.99,"stock":100}}'
```

## Paso 4. Ver EN VIVO qué pasa por SNS y por la cola ← lo nuevo

SNS **no guarda** mensajes, SQS sí (pero tu Lambda los consume en segundos). Así se observa cada capa:

### 4a. Cola en vivo: profundidad (¿hay mensajes esperando?)

```bash
# Una foto:
aws sqs get-queue-attributes --queue-url $QUEUE \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible ApproximateNumberOfMessagesDelayed \
  --region $REGION

# En vivo cada 3s (profundidad):
watch -n 3 "aws sqs get-queue-attributes --queue-url $QUEUE --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible --region $REGION --output table"
# Visible = esperando, NotVisible = en proceso por Lambda o en visibility-timeout
```

### 4b. Cola en vivo: espiar el contenido sin romper nada (peek)

Ojo: `miCola` tiene trigger a `miReceptor`, Lambda borra rápido y el peek suele salir vacío. Para clases, pausa el trigger, espía, y reactívalo:

```bash
# 1. Pausar consumo Lambda (para poder espiar)
aws lambda list-event-source-mappings --region $REGION
# copia el UUID del que apunta a miCola (ej 743d6d6f-...)
aws lambda update-event-source-mapping --uuid 743d6d6f-07ea-49ec-836c-aaefc0ed85da --enabled false --region $REGION

# 2. Publicar uno de prueba
aws sns publish --topic-arn $TOPIC --region $REGION \
  --message '{"type":"products","body":{"id":994,"name":"Teclado","price":19.9,"stock":5}}'

# 3. Espiar SIN borrar (visibility 0 = vuelve a la cola altiro)
aws sqs receive-message --queue-url $QUEUE --region $REGION \
  --max-number-of-messages 1 --visibility-timeout 0 --wait-time-seconds 10 --output json

# 4. Espiar y desenvolver en una línea (envoltura SNS -> Message -> product) con jq:
aws sqs receive-message --queue-url $QUEUE --region $REGION \
  --max-number-of-messages 1 --visibility-timeout 0 --wait-time-seconds 10 --output json \
  | jq -r '.Messages[0].Body | fromjson | .Message | fromjson | .body'

# Sin jq (python, viene en macOS):
aws sqs receive-message --queue-url $QUEUE --region $REGION \
  --max-number-of-messages 1 --visibility-timeout 0 --wait-time-seconds 10 --output json \
  | python3 -c "import json,sys; m=json.load(sys.stdin)['Messages'][0]['Body']; e=json.loads(m); p=json.loads(e.get('Message',m)); print((p.get('body') or p))"

# 5. Reactivar Lambda cuando termines de mirar
aws lambda update-event-source-mapping --uuid 743d6d6f-07ea-49ec-836c-aaefc0ed85da --enabled true --region $REGION
```

Lo que verás es la envoltura (porque `RawMessageDelivery=false`):

```json
{"Type":"Notification","TopicArn":"...transporte","Message":"{\"type\":\"products\",\"body\":{\"id\":994,...}}",...}
```

### 4c. SNS en vivo: ¿publicó? ¿filtró? ¿entregó? (métricas)

```bash
# ¿cuántos publish / entregados / filtrados en los últimos 30 min?
for M in NumberOfMessagesPublished NumberOfNotificationsDelivered NumberOfNotificationsFilteredOut NumberOfNotificationsFailed; do
echo "== $M ==";
aws cloudwatch get-metric-statistics --namespace AWS/SNS --metric-name $M \
  --dimensions Name=TopicName,Value=transporte \
  --start-time $(date -u -v-30M +%Y-%m-%dT%H:%M:%SZ) --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 60 --statistics Sum --region $REGION --output table;
done
# Si FilteredOut sube al enviar "orders", el filtro está trabajando.
# Si Delivered sube al enviar "products", llegó a SQS.
```

### 4d. Lambda en vivo: qué procesó (logs)

```bash
# Seguir logs en vivo:
aws logs tail /aws/lambda/miReceptor --follow --since 5m --region $REGION

# Buscar un id puntual (usa id único por prueba, ej 994):
aws logs tail /aws/lambda/miReceptor --since 10m --region $REGION | grep -A3 994
# Esperado OK: "Procesando producto de SQS: { id: 994...}" + "Producto insertado..."
# Error viejo: "{ Type: 'Notification'...}" + 'null value in column "id"' (falta el unwrap del paso 5)
```

### 4e. Traza completa de laboratorio (un solo script)

```bash
ID=$(date +%s | tail -c 5)
echo "Probando con id $ID"
aws sns publish --topic-arn $TOPIC --region $REGION \
  --message "{\"type\":\"products\",\"body\":{\"id\":$ID,\"name\":\"Lab-$ID\",\"price\":9.9,\"stock\":1}}"
sleep 20
echo "--- cola ---"
aws sqs get-queue-attributes --queue-url $QUEUE --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible --region $REGION
echo "--- lambda ---"
aws logs tail /aws/lambda/miReceptor --since 2m --region $REGION | grep -A2 "$ID" | tail -n 10
```

## Paso 5. Fix de la Lambda (por qué fallaba)

El código viejo hacía `JSON.parse(record.body)` esperando `{id,...}`, pero recibía la envoltura SNS → `body.id=undefined` → `error 23502 null in column id`, reintenta y va a DLQ.

Fix en `lambda-postgres/index.js` (ya aplicado): desenvolver 2 capas.

```js
const envelope = JSON.parse(record.body);
const msgStr = envelope.Message ?? record.body;
const payload = typeof msgStr === 'string' ? JSON.parse(msgStr) : msgStr;
const body = payload.body ?? payload; // {id,name,price,stock}
```

Soporta SNS-envelope + `{type,body}`, SQS directo `{type,body}`, y producto plano `{id,...}` (compat. con `DEPLOY.md`).

## Paso 6. Desplegar por GitHub Actions

Push a `main` que toque `lambda-postgres/**` → `npm ci` → `function.zip` → `update-function-code` en `miReceptor`.

```bash
git status
git add lambda-postgres/index.js docs/
git commit -m "fix(lambda): unwrap SNS envelope y payload {type,body} para products"
git push origin main
gh run list --limit 5
gh run watch
aws lambda get-function --function-name miReceptor --region $REGION --query 'Configuration.[LastModified,CodeSize]'
```

Secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION=us-east-2`, `LAMBDA_FUNCTION_NAME=miReceptor`, más `DATABASE_URL` en la Lambda. Detalle en `DEPLOY.md`.

## Paso 7. Checklist si algo no llega

1. ¿`--region us-east-2`? El 90% de los “no existe” es eso.
2. ¿`FilterPolicyScope=MessageBody` y mensaje JSON válido con `"type":"products"`?
3. ¿Métrica `FilteredOut` sube? Es filtro, no error.
4. ¿Cola en 0 pero `NotVisible>0`? Lambda lo tomó, mira logs, no hagas peek a ciegas.
5. ¿Log dice `Type: Notification` + `null id`? Falta el unwrap del paso 5, despliega de nuevo.
6. ¿Peek vacío con trigger activo? Normal, pausa el trigger (4b) para la demo.

---

### Anexos (detalle histórico, no necesitas leerlos en clase)

- `busqueda-sns-sqs.md`: comandos crudos de búsqueda con salidas JSON completas.
- `sesion-sns-sqs-lambda-para-estudiantes.md`: bitácora de la sesión con los 3 envíos de prueba (991/992/993).
- `../DEPLOY.md`: deploy y evento SQS de ejemplo.
- Esta guía (`README.md`) es la canónica: si algo difiere, manda esta.
