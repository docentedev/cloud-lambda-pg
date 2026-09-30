# De SNS a Postgres: sesión completa SNS → SQS → Lambda → DB

Guía para estudiantes. Todo verificado con `awscli` el 2026-09-30.
Cuenta: `258344940817`. Región real: `us-east-2` (ojo: el default del PC era `us-east-1`).

Arquitectura:

```
Producer --publish--> SNS transporte --suscripción con filtro--> SQS miCola --trigger--> Lambda miReceptor --INSERT--> Postgres products
```

Recursos:
- SNS: `arn:aws:sns:us-east-2:258344940817:transporte`
- SQS: `arn:aws:sqs:us-east-2:258344940817:miCola` / `https://sqs.us-east-2.amazonaws.com/258344940817/miCola`
- Lambda: `miReceptor` en `us-east-2`, trigger SQS `miCola`, env `DATABASE_URL`
- Tabla: `products(id, name, price, stock)`

---

## 1. Buscar si existen SNS y SQS (error típico: región)

SNS y SQS son **regionales**. Si buscas en otra región, salen vacíos aunque existan.

```bash
# ¿quién soy y dónde estoy?
aws sts get-caller-identity
aws configure get region
# -> 258344940817, us-east-1

# SNS en default (vacío, engañoso)
aws sns list-topics --output json
# -> {"Topics": []}

# SQS en default (vacío + error)
aws sqs list-queues --output json
aws sqs get-queue-url --queue-name miCola
# -> AWS.SimpleQueueService.NonExistentQueue

# Correcto: fijarse en el ARN, dice us-east-2
aws sns list-topics --region us-east-2
# -> arn:aws:sns:us-east-2:258344940817:transporte

aws sqs get-queue-url --queue-name miCola --region us-east-2
# -> https://sqs.us-east-2.amazonaws.com/258344940817/miCola
```

Moraleja: siempre pasa `--region`. `list-*` vacío no significa “no existe”, puede ser “buscaste mal”.

Detalle útil:

```bash
aws sns get-topic-attributes --topic-arn arn:aws:sns:us-east-2:258344940817:transporte --region us-east-2
# SubscriptionsConfirmed: 1

aws sqs get-queue-attributes --queue-url https://sqs.us-east-2.amazonaws.com/258344940817/miCola --attribute-names All --region us-east-2
# Policy ya autoriza a sns.amazonaws.com con SourceArn = transporte
```

Ver `docs/busqueda-sns-sqs.md` para el paso a paso completo.

## 2. La suscripción con filtro: política vs mensaje

Ver suscripción:

```bash
aws sns list-subscriptions-by-topic --topic-arn arn:aws:sns:us-east-2:258344940817:transporte --region us-east-2
# -> arn:...:transporte:8d6314e1-c8b2-4b0c-ba89-3a74284c3abd, protocol sqs, endpoint arn:...:miCola

aws sns get-subscription-attributes --subscription-arn "arn:aws:sns:us-east-2:258344940817:transporte:8d6314e1-c8b2-4b0c-ba89-3a74284c3abd" --region us-east-2
# FilterPolicy: {"type":["products"]}
# FilterPolicyScope: MessageBody
# RawMessageDelivery: false
```

Pregunta clásica: **si la política es `{"type":["products"]}`, ¿debo enviar `{"type":["products"]}`?**

No. Son dos roles distintos:

- **Política = lista de permitidos (OR).** `{"type":["products"]}` = “deja pasar si `type == products`”. Si quisieras dos, sería `{"type":["products","orders"]}`.
- **Mensaje = un valor concreto.** Envía `{"type":"products", ...}`.

Probamos los 3 casos en esta sesión (todos con `publish` a SNS):

| # | Mensaje enviado | ¿Llegó a SQS/Lambda? | MessageId SNS |
|---|---|---|---|
| 1 | `{"type":"products","body":{"id":991,...}}` | SÍ | `eabf01f1-...` |
| 2 | `{"type":["products"],"body":{"id":992,...}}` | SÍ (SNS también matchea si el campo es array que contiene el valor) | `b0159e9e-...` |
| 3 | `{"type":"orders","body":{"id":993,...}}` | NO, filtrado. Lambda nunca lo vio (`grep 993` vacío), cola en 0 | `3851f1b7-...` |

Recomendación: usa string `"products"`. Es más simple, calza con tu modelo `Product`, y evita confusiones. El array en el mensaje funciona pero no aporta nada.

Comando para enviar bien:

```bash
aws sns publish \
  --topic-arn arn:aws:sns:us-east-2:258344940817:transporte \
  --message '{"type":"products","body":{"id":991,"name":"Producto de prueba","price":29.99,"stock":100}}' \
  --region us-east-2
```

## 3. Por qué fallaba la Lambda (y el fix)

Con `RawMessageDelivery: false`, SQS **no** recibe tu JSON limpio. Recibe la envoltura SNS:

```json
{
  "Type": "Notification",
  "TopicArn": "arn:aws:sns:us-east-2:258344940817:transporte",
  "Message": "{\"type\":\"products\",\"body\":{\"id\":991,...}}",
  "Timestamp": "..."
}
```

El código viejo hacía:

```js
const body = JSON.parse(record.body); // = envoltura, sin id/name/price/stock
// body.id -> undefined -> INSERT (null,null,null,null) -> error 23502 not-null id
```

Visto en CloudWatch `/aws/lambda/miReceptor`:
`Procesando producto de SQS: { Type: 'Notification', Message: ... }` + `null value in column "id" violates not-null constraint`, reintenta 3 veces.

Fix en `lambda-postgres/index.js` (desenvolver 2 capas):

```js
const envelope = JSON.parse(record.body);
const msgStr = envelope.Message ?? record.body;
const payload = typeof msgStr === 'string' ? JSON.parse(msgStr) : msgStr;
const body = payload.body ?? payload;
// body = {id, name, price, stock}
```

Soporta:
- `SNS envelope -> {type, body} -> product` (caso real actual)
- `SQS directo {type, body} -> product` (si activas Raw=true)
- `SQS directo {id,...}` plano (compatibilidad con pruebas viejas de `DEPLOY.md`)

Verificado local con `node -e` para los 3 casos.

## 4. Probar end-to-end

```bash
# 1. Publicar
aws sns publish --topic-arn arn:aws:sns:us-east-2:258344940817:transporte \
  --message '{"type":"products","body":{"id":994,"name":"Teclado","price":19.9,"stock":5}}' \
  --region us-east-2

# 2. Ver logs Lambda (tarda ~10-20s por trigger SQS)
aws logs tail /aws/lambda/miReceptor --since 5m --region us-east-2 | grep -A2 994

# Esperado después del fix:
# Procesando producto de SQS: { id: 994, ... }
# Producto insertado en PostgreSQL exitosamente

# 3. Si falla, revisa:
# - FilterPolicyScope debe ser MessageBody
# - RawMessageDelivery false => siempre parsea envelope.Message
# - products.id not-null => valida que body traiga los 4 campos
```

## 5. Subir el fix con GitHub Actions

El repo ya tiene `.github/workflows/deploy-lambda-postgres.yml`: hace `npm ci` → `function.zip` → `update-function-code`. Se dispara con push a `main` que toque `lambda-postgres/**`.

```bash
cd /Users/claudio.viajando/src/duocuc/RAMOS/cloud/chati/cloud-lambda-pg
git status
git add lambda-postgres/index.js docs/busqueda-sns-sqs.md docs/sesion-sns-sqs-lambda-para-estudiantes.md
git commit -m "fix(lambda): unwrap SNS envelope y payload {type,body} para products"
git push origin main
# ver deploy:
gh run list --limit 5
gh run watch
aws lambda get-function --function-name miReceptor --region us-east-2 --query 'Configuration.[LastModified,CodeSize]'
```

Requiere secrets en GitHub: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION=us-east-2`, `LAMBDA_FUNCTION_NAME=miReceptor`, y `DATABASE_URL` en la Lambda. Detalle en `DEPLOY.md`.
