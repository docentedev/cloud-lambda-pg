# Guía técnica: pipeline de productos SNS → SQS → Lambda → PostgreSQL

Fecha de consolidación: 2026-09-30
Cuenta AWS: `258344940817`
Región operativa: `us-east-2` (la configuración local por defecto es `us-east-1`; todos los comandos deben especificar `--region us-east-2`)

## 1. Arquitectura

```
Client
  │ POST /productos (HTTP API, ANY)
  ▼
Lambda productsCatalog (publicadora, Node 20)
  │ Publish {"type":"products","body":{Product}} ── FilterPolicyScope=MessageBody
  ▼
SNS transporte (arn:aws:sns:us-east-2:258344940817:transporte)
  │ suscripción SQS + FilterPolicy {"type":["products"]}, RawMessageDelivery=false
  ▼
SQS miCola (https://sqs.us-east-2.amazonaws.com/258344940817/miCola)
  │ trigger (BatchSize 10, Enabled)
  ▼
Lambda miReceptor (Node 24, consumer SQS)
  │ INSERT INTO products
  ▼
PostgreSQL (tabla public.products)
```

Recursos existentes:

| Tipo | Identificador |
|---|---|
| SNS Topic | `arn:aws:sns:us-east-2:258344940817:transporte` |
| Suscripción | `arn:aws:sns:us-east-2:258344940817:transporte:8d6314e1-c8b2-4b0c-ba89-3a74284c3abd` (protocol `sqs`, endpoint `arn:aws:sqs:us-east-2:258344940817:miCola`) |
| SQS Queue | `arn:aws:sqs:us-east-2:258344940817:miCola`, URL `https://sqs.us-east-2.amazonaws.com/258344940817/miCola` |
| Lambda consumer | `arn:aws:lambda:us-east-2:258344940817:function:miReceptor` (runtime `nodejs24.x`, handler `index.handler`, env `DATABASE_URL`) |
| Lambda publisher | `arn:aws:lambda:us-east-2:258344940817:function:productsCatalog` (runtime `nodejs20.x`, handler `index.handler`, env `SNS_TOPIC_ARN`) |
| Event source mapping | UUID `743d6d6f-07ea-49ec-836c-aaefc0ed85da` (SQS miCola → miReceptor, Enabled) |
| API | `mi-pasarela-api` (`yxpnxitdnh`, HTTP API, stage `$default`): `ANY /productos` → `productsCatalog` (AWS_PROXY, payload 2.0, Auth NONE) |
| Rol ejecución | `arn:aws:iam::258344940817:role/service-role/miReceptor-role-3i4xgr9j` (+ policy inline `sns-publish-transporte`: `sns:Publish` sobre `transporte`) |

## 2. Estado actual y trabajo pendiente

Implementado y verificado end-to-end (IDs 991–996, 994 vía API con insert confirmado en PostgreSQL):

- Verificación de existencia SNS/SQS por región.
- Suscripción SNS→SQS con filtro por cuerpo.
- Corrección del consumer para desenvolver envoltura SNS.
- Lambda publicadora con validación y publicación tipada.
- Integración API Gateway → publicadora.
- Workflows de despliegue por directorio.
- Observabilidad: atributos SQS, métricas SNS, `logs tail`.

Pendiente / próximos pasos:

1. Commitear y pushear cambios locales (`lambda-postgres/index.js`, `lambda-products-catalog/`, workflows, `docs/`) para que CI despliegue ambas funciones.
2. Definir política de reintentos/DLQ para `miReceptor` (actualmente `throw` falla el lote completo; evaluar `ReportBatchItemFailures`).
3. Endurecer IAM: reemplazar rol compartido por roles mínimos por función (consumer: `sqs:ReceiveMessage/DeleteMessage/GetQueueAttributes` + `logs`; publisher: `sns:Publish` + `logs`; deploy user: `lambda:UpdateFunctionCode/GetFunction/UpdateFunctionConfiguration` acotado).
4. Rotar credenciales de deploy al cierre del ciclo académico.
5. Añadir validación de esquema en ambos extremos y tests automatizados (`node --check` actual es mínimo).

## 3. Contratos de mensajes

### 3.1 Product

```json
{"id": 993, "name": "Mouse inalambrico", "price": 19990, "stock": 25}
```

Tipos: `id:number`, `name:string`, `price:number`, `stock:number`. Usar ASCII en transporte CLI/API.

### 3.2 Publicación SNS (lo que envía productsCatalog)

```json
{"type": "products", "body": {"id": 993, "name": "Mouse inalambrico", "price": 19990, "stock": 25}}
```

`FilterPolicy` de la suscripción: `{"type":["products"]}`, `FilterPolicyScope=MessageBody`. Semántica: el arreglo de la política es la lista de valores permitidos (OR); el mensaje porta un valor concreto. Comportamiento verificado: `type:"products"` entrega; `type:["products"]` también entrega (match por contenido); `type:"orders"` es filtrado y no alcanza SQS.

### 3.3 Mensaje SQS (RawMessageDelivery=false)

Envoltura SNS, no el Product directo:

```json
{"Type":"Notification","TopicArn":"arn:aws:sns:us-east-2:258344940817:transporte","Message":"{\"type\":\"products\",\"body\":{\"id\":994,...}}","Timestamp":"..."}
```

El consumer debe aplicar: `record.body → envelope.Message → {type,body} → product`.

## 4. Procedimiento operativo

Variables comunes:

```bash
export REGION=us-east-2
export TOPIC=arn:aws:sns:us-east-2:258344940817:transporte
export QUEUE=https://sqs.us-east-2.amazonaws.com/258344940817/miCola
export SUB=arn:aws:sns:us-east-2:258344940817:transporte:8d6314e1-c8b2-4b0c-ba89-3a74284c3abd
export ESM_UUID=743d6d6f-07ea-49ec-836c-aaefc0ed85da
export API=https://yxpnxitdnh.execute-api.us-east-2.amazonaws.com/productos
```

### 4.1 Verificación de identidad y existencia

```bash
aws sts get-caller-identity
aws configure get region
aws sns list-topics --region $REGION
aws sns get-topic-attributes --topic-arn $TOPIC --region $REGION
aws sqs get-queue-url --queue-name miCola --region $REGION
aws sqs list-queues --region $REGION
aws sqs get-queue-attributes --queue-url $QUEUE --attribute-names All --region $REGION
aws sns list-subscriptions-by-topic --topic-arn $TOPIC --region $REGION
aws sns get-subscription-attributes --subscription-arn "$SUB" --region $REGION
aws lambda list-functions --region $REGION
aws lambda get-function-configuration --function-name miReceptor --region $REGION
aws lambda get-function-configuration --function-name productsCatalog --region $REGION
aws lambda list-event-source-mappings --region $REGION
```

Nota: `list-topics`/`list-queues` vacíos en `us-east-1` no indican inexistencia; indican región incorrecta. `get-queue-url` sin `--region` retorna `NonExistentQueue` para recursos de `us-east-2`.

### 4.2 Publicación directa a SNS

```bash
aws sns publish --topic-arn $TOPIC --region $REGION \
  --message '{"type":"products","body":{"id":993,"name":"Mouse inalambrico","price":19990,"stock":25}}'
```

### 4.3 Invocación directa de la publicadora

```bash
printf '%s' '{"id":996,"name":"Teclado mecanico","price":49990,"stock":10}' > /tmp/payload.json
aws lambda invoke --function-name productsCatalog --region $REGION \
  --cli-binary-format raw-in-base64-out --payload file:///tmp/payload.json /tmp/catalog-out.json && cat /tmp/catalog-out.json
```

### 4.4 Ingesta vía API

```bash
curl -X POST "$API" -H "Content-Type: application/json" \
  -d '{"id":994,"name":"Mouse inalambrico","price":19990,"stock":25}'
```

Respuesta esperada `HTTP 200` con `messageId`, `topic` y eco de `sent`.

### 4.5 Observabilidad

Profundidad de cola:

```bash
aws sqs get-queue-attributes --queue-url $QUEUE --region $REGION \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible ApproximateNumberOfMessagesDelayed
watch -n 3 "aws sqs get-queue-attributes --queue-url $QUEUE --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible --region $REGION --output table"
```

Inspección de contenido (peek no destructivo; con trigger activo suele salir vacío porque el consumer drena):

```bash
aws lambda update-event-source-mapping --uuid $ESM_UUID --enabled false --region $REGION
aws sns publish --topic-arn $TOPIC --region $REGION \
  --message '{"type":"products","body":{"id":994,"name":"Teclado","price":19.9,"stock":5}}'
aws sqs receive-message --queue-url $QUEUE --region $REGION \
  --max-number-of-messages 1 --visibility-timeout 0 --wait-time-seconds 10 --output json
aws sqs receive-message --queue-url $QUEUE --region $REGION \
  --max-number-of-messages 1 --visibility-timeout 0 --wait-time-seconds 10 --output json \
  | jq -r '.Messages[0].Body | fromjson | .Message | fromjson | .body'
aws lambda update-event-source-mapping --uuid $ESM_UUID --enabled true --region $REGION
```

Métricas SNS (publicados/entregados/filtrados/fallidos, últimos 30 min):

```bash
for M in NumberOfMessagesPublished NumberOfNotificationsDelivered NumberOfNotificationsFilteredOut NumberOfNotificationsFailed; do
echo "== $M ==";
aws cloudwatch get-metric-statistics --namespace AWS/SNS --metric-name $M \
  --dimensions Name=TopicName,Value=transporte \
  --start-time $(date -u -v-30M +%Y-%m-%dT%H:%M:%SZ) --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 60 --statistics Sum --region $REGION --output table;
done
```

Logs:

```bash
aws logs tail /aws/lambda/productsCatalog --since 5m --region $REGION
aws logs tail /aws/lambda/miReceptor --since 5m --region $REGION
aws logs tail /aws/lambda/miReceptor --follow --since 5m --region $REGION
aws logs tail /aws/lambda/miReceptor --since 10m --region $REGION | grep -A3 994
```

Traza end-to-end con ID único:

```bash
ID=$(date +%s | tail -c 5)
aws sns publish --topic-arn $TOPIC --region $REGION \
  --message "{\"type\":\"products\",\"body\":{\"id\":$ID,\"name\":\"Lab-$ID\",\"price\":9.9,\"stock\":1}}"
sleep 20
aws sqs get-queue-attributes --queue-url $QUEUE --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible --region $REGION
aws logs tail /aws/lambda/miReceptor --since 2m --region $REGION | grep -A2 "$ID" | tail -n 10
```

## 5. Implementación

### 5.1 Consumer (`lambda-postgres/index.js`)

Desempaquetado requerido por `RawMessageDelivery=false`:

```js
const envelope = JSON.parse(record.body);
const msgStr = envelope.Message ?? record.body;
const payload = typeof msgStr === 'string' ? JSON.parse(msgStr) : msgStr;
const body = payload.body ?? payload;
const values = [body.id, body.name, body.price, body.stock];
// INSERT INTO products (id, name, price, stock) VALUES ($1,$2,$3,$4) RETURNING *
```

Sin este paso, `body.id` es `undefined` y PostgreSQL retorna `23502 null value in column "id"`, con reintento del lote.

### 5.2 Publisher (`lambda-products-catalog/`, capas)

Estructura (entry `index.js` → `src/`; handler Lambda sigue siendo `index.handler`):

| Capa | Archivo | Responsabilidad |
|---|---|---|
| Controller | `src/handler.js` | Traduce evento (directo / API GW v2 `{body}` / pre-envuelto `{type,body}`) ⇄ respuesta HTTP. Sin SNS/SQL. |
| Negocio | `src/service.js` | `validateProduct` + chequeo duplicado + construcción de `{"type":"products","body"}`. |
| Repository SNS | `src/sns.repository.js` | Único que usa `SNSClient/PublishCommand`. |
| Repository DB | `src/product.repository.js` + `src/db.js` | Únicas con SQL (`existsById`, `findById`, pool `pg`). Si no hay `DATABASE_URL`, el chequeo se omite sin bloquear. |

Flujo: `handler.extractInput → service.publishProduct → (validate → productRepo.existsById → 409 si existe → snsRepo.publishProductMessage) → 200 {messageId, topic, sent}`. Errores de validación → `400`; duplicado → `409`.

Verificado: `node --check` de los 6 archivos OK; `handler({id:'x'})` → `400`; `handler({id:998,...})` → `200` con `MessageId 92e22af9-...` publicado al SNS.

## 6. Integración API Gateway

- API: HTTP API `yxpnxitdnh` (`mi-pasarela-api`), stage `$default` (AutoDeploy).
- Ruta: `ANY /productos` → integración `3kv33yd`, `AWS_PROXY`, `POST`, `arn:aws:lambda:us-east-2:258344940817:function:productsCatalog`, payload `2.0`, sin autorización.
- Verificación:

```bash
aws apigatewayv2 get-routes --api-id yxpnxitdnh --region $REGION
aws apigatewayv2 get-integrations --api-id yxpnxitdnh --region $REGION
```

## 7. Despliegue continuo

Dos workflows independientes, cada uno filtrado por `paths` a su directorio (cambios en `docs/` no despliegan):

| Workflow | Trigger paths | Función destino (secret) |
|---|---|---|
| `deploy-lambda-postgres.yml` | `lambda-postgres/**`, su propio yml | `LAMBDA_FUNCTION_NAME` (`miReceptor`) |
| `deploy-lambda-products-catalog.yml` | `lambda-products-catalog/**`, su propio yml | `LAMBDA_CATALOG_FUNCTION_NAME` (`productsCatalog`) |

Flujo: `npm ci --omit=dev` → `zip` → `update-function-code` → `wait function-updated` → `update-function-configuration` (env opcional). Los workflows no crean funciones; la creación es manual (sección 8).

Secrets requeridos: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `LAMBDA_FUNCTION_NAME`, `LAMBDA_CATALOG_FUNCTION_NAME`, opcional `SNS_TOPIC_ARN` y `DATABASE_URL`.

Comandos:

```bash
git status
git add lambda-postgres/index.js lambda-products-catalog/index.js lambda-products-catalog/package.json lambda-products-catalog/package-lock.json .github/workflows/deploy-lambda-products-catalog.yml docs/
git commit -m "feat: pipeline productos SNS-SQS-Lambda documentado y verificado"
git push origin main
gh run list --limit 5
gh run watch
aws lambda get-function --function-name miReceptor --region $REGION --query 'Configuration.[LastModified,CodeSize]'
aws lambda get-function --function-name productsCatalog --region $REGION --query 'Configuration.[LastModified,CodeSize]'
```

## 8. Creación inicial de productsCatalog (ejecutada una vez)

```bash
cd lambda-products-catalog
npm ci --omit=dev
zip -r ../catalog-function.zip . -x "*.git*" "*.DS_Store*"
aws lambda create-function \
  --function-name productsCatalog \
  --runtime nodejs20.x \
  --role arn:aws:iam::258344940817:role/service-role/miReceptor-role-3i4xgr9j \
  --handler index.handler \
  --zip-file fileb://../catalog-function.zip \
  --timeout 10 --memory-size 128 \
  --environment "Variables={SNS_TOPIC_ARN=arn:aws:sns:us-east-2:258344940817:transporte}" \
  --region us-east-2
aws iam put-role-policy --role-name miReceptor-role-3i4xgr9j \
  --policy-name sns-publish-transporte \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["sns:Publish"],"Resource":"arn:aws:sns:us-east-2:258344940817:transporte"}]}'
```

Restricción: `AWS_REGION` es clave reservada en `create-function`/`update-function-configuration`; no debe incluirse en `Variables`.

## 9. Diagnóstico

| Síntoma | Causa probable | Acción |
|---|---|---|
| `Topics: []` / `NonExistentQueue` | Región incorrecta (`us-east-1` vs `us-east-2`) | Reintentar con `--region us-east-2` |
| `ResourceNotFoundException` en CI | Función no creada o nombre/región erróneos | Crear función (sección 8), verificar secrets |
| Métrica SNS `FilteredOut` incrementa | `type` distinto de `products` | Corregir payload a `{"type":"products",...}` |
| `miReceptor`: `Type: Notification` + `23502 null id` | Falta desenvolver envoltura SNS | Desplegar `lambda-postgres/index.js` vigente |
| `AccessDenied: sns:Publish` | Rol sin permiso | Aplicar policy `sns-publish-transporte` |
| `Invalid base64` en `lambda invoke` | `--payload` inline con caracteres no ASCII | Usar `file://` + `--cli-binary-format raw-in-base64-out`, payload ASCII |
| `Reserved keys: AWS_REGION` | Env manual con clave reservada | Eliminar `AWS_REGION` de `Variables` |
| Peek SQS vacío con tráfico activo | Consumer drena la cola | Pausar event source mapping para la inspección (4.5) |
| Error PK duplicada en insert | Reutilización de `id` | Usar `id` único por prueba; si la cola se contamina, purgar (9.1) |
| Error CI `FunctionName length 0` | Secret `LAMBDA_CATALOG_FUNCTION_NAME` inexistente | Crearlo en GitHub Secrets y re-ejecutar workflow |

### 9.1 Purga de mensajes contaminados en SQS (ejecutado 2026-09-30)

Situación: reintentos por PK duplicada (IDs 991/993/996) dejaron 4 visibles + 1 en vuelo. Procedimiento aplicado con trigger pausado para evitar que Lambda siga consumiendo durante la limpieza. Nota CLI: el flag es `--no-enabled` / `--enabled`, no `--enabled false`.

```bash
export REGION=us-east-2
export QUEUE=https://sqs.us-east-2.amazonaws.com/258344940817/miCola
export ESM_UUID=743d6d6f-07ea-49ec-836c-aaefc0ed85da

# 1. Pausar consumer
aws lambda update-event-source-mapping --uuid $ESM_UUID --no-enabled --region $REGION
aws lambda get-event-source-mapping --uuid $ESM_UUID --region $REGION --query 'State'
# -> Disabling -> Disabled

# 2. Esperar a que los en vuelo vuelvan a visibles (visibility-timeout 30s)
sleep 45
aws sqs get-queue-attributes --queue-url $QUEUE --region $REGION \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible
# -> 4 visibles, 1 en vuelo

# 3. Purga (borra visibles; límite AWS: 1 purge por cola cada 60s)
aws sqs purge-queue --queue-url $QUEUE --region $REGION
aws sqs get-queue-attributes --queue-url $QUEUE --region $REGION \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible
# -> 0 / 0

# 4. Esperar 45s y reverificar (un en vuelo puede reaparecer tras expirar su timeout)
sleep 45
aws sqs get-queue-attributes --queue-url $QUEUE --region $REGION \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible
# -> 0 / 0 confirmado (si reaparece alguno, esperar 60s desde la purga anterior y repetir purge)

# 5. Reactivar consumer
aws lambda update-event-source-mapping --uuid $ESM_UUID --enabled --region $REGION
aws lambda get-event-source-mapping --uuid $ESM_UUID --region $REGION --query 'State'
# -> Enabling -> Enabled
```

Alternativa quirúrgica (borrar mensajes puntuales sin vaciar la cola): `receive-message --visibility-timeout 0` + `delete-message --receipt-handle`. Preferir `purge-queue` cuando todos los mensajes son descartables, como en este caso.

## 10. Referencia de archivos

- `lambda-postgres/index.js`: consumer SQS → PostgreSQL.
- `lambda-products-catalog/index.js` (entry), `src/handler.js` (controller), `src/service.js` (negocio), `src/sns.repository.js` (SNS), `src/product.repository.js` + `src/db.js` (DB), `package.json` (`@aws-sdk/client-sns`, `pg`).
- `.github/workflows/deploy-lambda-postgres.yml`, `deploy-lambda-products-catalog.yml`: CI por directorio.
- `DEPLOY.md`: detalle de secrets, variables y contrato SQS original.
- `docs/README.md`, `docs/busqueda-sns-sqs.md`, `docs/sesion-sns-sqs-lambda-para-estudiantes.md`: material previo consolidado en el presente documento, que es la referencia canónica.
