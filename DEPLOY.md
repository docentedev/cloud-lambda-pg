# Deploy lambda-postgres con GitHub Actions → AWS Lambda

Esto reemplaza lo que hoy haces a mano (comprimir ZIP y subirlo en la consola).

Workflow: `.github/workflows/deploy-lambda-postgres.yml`
Hace: `npm ci` → arma `function.zip` → `update-function-code` en tu Lambda.
Se dispara solo en `push` a `main` que toque `lambda-postgres/**`, o manual desde Actions.

---

## 1. Secrets de GitHub (para que Actions pueda desplegar)

Estos **viven en GitHub, no en AWS**. Los usa el workflow para autenticarse y saber qué función actualizar. Tu código NO los lee.

| Secret en GitHub | Qué es | Dónde conseguirlo |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | Access key de un usuario IAM para el deploy | AWS Console → IAM → Users → crea usuario `github-deploy-lambda` (sin consola) → Create access key → Command Line Interface (CLI) → copia el ID. |
| `AWS_SECRET_ACCESS_KEY` | Secret de ese access key (solo se muestra 1 vez) | Te lo da en el mismo paso anterior. Guárdalo altiro, no se puede ver después. |
| `AWS_REGION` | Región donde está tu Lambda | AWS Console → Lambda → tu función → arriba a la derecha. La tuya hoy es `us-east-2` (verificado con `aws lambda list-functions`). Ej: `us-east-2`. |
| `LAMBDA_FUNCTION_NAME` | Nombre de la función a actualizar | AWS Console → Lambda → Functions → nombre. Hoy tienes `miReceptor` y `eventProcExample` en `us-east-2`. Usa el que corresponda (ej: `miReceptor`). |

Dónde agregarlos: en GitHub abre tu repo → **Settings → Secrets and variables → Actions** → **New repository secret**, uno por uno.

> Nota para clases/demo: en un entorno personal de enseñanza puedes usar directamente tus claves actuales del Mac (tienen permiso de sobra y el deploy va a funcionar). La recomendación del usuario IAM limitado es la buena práctica para producción o equipos, úsala como materia de clase más que como requisito. En cualquier caso, rota o elimina esas keys al terminar el ramo.

---

## 2. Variables de entorno de la Lambda (para que tu código funcione)

Estas **viven en AWS, no en GitHub**. Tu `index.js` las lee con `process.env.NOMBRE` (sin ninguna librería, es nativo de Node).

| Variable en la Lambda | Qué es | Dónde conseguir el valor |
|---|---|---|
| `DATABASE_URL` | Connection string de Supabase/Postgres | Supabase → tu proyecto → Settings → Database → Connection string → usa el pooler (`aws-0-us-east-2.pooler.supabase.com:5432`). |

Tienes 2 formas de dejarla configurada (elige una):

**Opción A — directo en AWS (recomendado, más simple):**
AWS Console → Lambda → tu función → **Configuration → Environment variables → Edit** → agrega `DATABASE_URL` con tu connection string → Save. Listo, el código la toma solo.

**Opción B — vía GitHub (automático en cada deploy):**
Crea el secret `DATABASE_URL` en GitHub (mismo lugar del punto 1) y el workflow la configura solo con `update-function-configuration`.
Ojo: ese paso **reemplaza todas** las env vars de la Lambda, no solo agrega una. Si tu función ya tiene otras variables, agrégalas también al comando del workflow o se borrarán.

> Nota: tu `index.js` usa `process.env.DATABASE_URL` con fallback a tu string actual, así que funciona con o sin la variable. Pero lo correcto es sacarla del código y dejarla solo como env var en la Lambda.

## 3. Permisos mínimos del usuario IAM

Al usuario `github-deploy-lambda` adjúntale esta policy (IAM → Users → tu usuario → Add permissions → Create inline policy → JSON):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:GetFunction"
      ],
      "Resource": "arn:aws:lambda:us-east-2:258344940817:function:*"
    }
  ]
}
```

Cambia la cuenta/región si usas otra. Tu cuenta actual es `258344940817`.

Si prefieres apretar más, reemplaza `:*` por `:miReceptor`.

## 4. Dónde agregarlos (paso a paso)

1. Sube esta carpeta como repo a GitHub (si aún no lo has hecho):
   `git init` en `lambda-pg/` (o en la raíz que contenga `lambda-postgres/` y `.github/` juntos) → commit → push.
   Importante: `.github/` y `lambda-postgres/` deben quedar **en la misma raíz del repo**, si no el workflow no encuentra la carpeta.
2. En GitHub abre tu repo → **Settings → Secrets and variables → Actions** → **New repository secret**.
   Crea los 4 del punto 1: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `LAMBDA_FUNCTION_NAME`.
3. En AWS configura la variable del punto 2: Lambda → tu función → **Configuration → Environment variables** → `DATABASE_URL`.
   (O crea el secret `DATABASE_URL` en GitHub si prefieres la Opción B.)
4. Anda a **Actions → Deploy lambda-postgres to AWS → Run workflow** para probar, o haz un `push` a `main` que toque `lambda-postgres/`.
5. Verifica en AWS Console → Lambda → tu función → Code + Monitor → el código y `Last modified` cambiaron.

## 5. Checklist rápido si falla

- `ResourceNotFoundException`: el `LAMBDA_FUNCTION_NAME` o `AWS_REGION` están malos. Tu función está en `us-east-2`, no en `us-east-1`.
- `AccessDenied`: al usuario IAM le falta la policy del punto 2.
- `InvalidSignature / token`: el `AWS_SECRET_ACCESS_KEY` quedó mal copiado (regenera el access key).
- El deploy pasa pero la Lambda falla con DB: falta la variable `DATABASE_URL` en la Lambda (revisa Lambda → Configuration → Environment variables).

## 6. Evento SQS que recibe la Lambda

La Lambda se dispara por SQS (Lambda → Configuration → Triggers → cola SQS). Cada mensaje de la cola llega dentro de `event.Records`, y el producto viene como **string JSON en `record.body`** (por eso el código hace `JSON.parse(record.body)`). La Lambda inserta una fila por cada record del lote.

Ejemplo de evento:

```json
{
  "Records": [
    {
      "messageId": "19dd0b57-b21e-4ac1-bd88-01bbb068cb78",
      "receiptHandle": "MessageReceiptHandle",
      "body": "{\"id\":991,\"name\":\"Producto de prueba\",\"price\":29.99,\"stock\":100}",
      "attributes": {
        "ApproximateReceiveCount": "1",
        "SentTimestamp": "1523232000000",
        "SenderId": "123456789012",
        "ApproximateFirstReceiveTimestamp": "1523232000001"
      },
      "messageAttributes": {},
      "md5OfBody": "7b270e59b47ff90a553787216d55d91d",
      "eventSource": "aws:sqs",
      "eventSourceARN": "arn:aws:sqs:us-east-1:123456789012:my-queue",
      "awsRegion": "us-east-1"
    }
  ]
}
```

Contrato del `body` (parseado) → tabla `products`:

| Campo en `body` | Tipo | Columna destino |
|---|---|---|
| `id` | number (entero) | `id` |
| `name` | string | `name` |
| `price` | number (decimal) | `price` |
| `stock` | number (entero) | `stock` |

Notas:

- `body` es string, no objeto: si el emisor manda el producto sin serializar a JSON, el `JSON.parse` falla y el lote completo reintenta (SQS redrive según tu configuración).
- Si un record del lote falla, hoy falla todo el lote (`throw` al final): con `Batch size` grande conviene usar report de fallos parciales (`functionResponseType: ReportBatchItemFailures`) o validar cada body por separado.
- Para probar manual en la consola: Lambda → Test → crea un evento con el JSON de arriba y ejecútalo (requiere `DATABASE_URL` configurada).
