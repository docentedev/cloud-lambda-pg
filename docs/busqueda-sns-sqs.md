# Búsqueda de recursos SNS y SQS con AWS CLI

Fecha verificación: 2026-09-30
Cuenta: `258344940817`
Región por defecto: `us-east-1`
Región real de los recursos: `us-east-2`

Recursos verificados:
- SNS: `arn:aws:sns:us-east-2:258344940817:transporte`
- SQS: `arn:aws:sqs:us-east-2:258344940817:miCola`
- URL cola: `https://sqs.us-east-2.amazonaws.com/258344940817/miCola`

## 1. Verificar identidad y región configurada

```bash
aws sts get-caller-identity
aws configure get region
```

Esto confirma contra qué cuenta y región por defecto estás buscando.
En este caso devolvió cuenta `258344940817` y región `us-east-1`,
por eso la primera búsqueda dio vacío.

## 2. Buscar tópico SNS `transporte`

### 2.1 Listar todos los tópicos (región por defecto)

```bash
aws sns list-topics --output json
```

Resultado en `us-east-1`:
```json
{
    "Topics": []
}
```
Conclusión: no existe ningún SNS en `us-east-1`.

### 2.2 Listar en `us-east-2` (región correcta)

```bash
aws sns list-topics --region us-east-2
```

Resultado:
```json
{
    "Topics": [
        {
            "TopicArn": "arn:aws:sns:us-east-2:258344940817:transporte"
        }
    ]
}
```
Conclusión: `transporte` SÍ existe en `us-east-2`.

### 2.3 Ver detalle del tópico

```bash
aws sns get-topic-attributes \
  --topic-arn arn:aws:sns:us-east-2:258344940817:transporte \
  --region us-east-2
```

Dato relevante: `SubscriptionsConfirmed: 1`, `SubscriptionsPending: 0`.
Ya tiene una suscripción confirmada.

### 2.4 Ver suscripción SNS -> SQS y FilterPolicy

```bash
aws sns list-subscriptions-by-topic \
  --topic-arn arn:aws:sns:us-east-2:258344940817:transporte \
  --region us-east-2

aws sns get-subscription-attributes \
  --subscription-arn "arn:aws:sns:us-east-2:258344940817:transporte:8d6314e1-c8b2-4b0c-ba89-3a74284c3abd" \
  --region us-east-2
```

Resultado verificado:
- `Protocol: sqs`
- `Endpoint: arn:aws:sqs:us-east-2:258344940817:miCola`
- `FilterPolicy: {"type":["products"]}`
- `FilterPolicyScope: MessageBody`
- `RawMessageDelivery: false`

Conclusión: solo los mensajes cuyo body JSON contenga
`{"type": "products"}` pasan del tópico `transporte` a la cola `miCola.
El resto se filtra en la suscripción y no llega a SQS.

## 3. Buscar cola SQS `miCola`

### 3.1 Listar colas (región por defecto)

```bash
aws sqs list-queues --output json
aws sqs list-queues --queue-name-prefix miCola
```

Resultado en `us-east-1`: vacío, sin `QueueUrls`.
Conclusión: no hay colas en `us-east-1`.

### 3.2 Búsqueda directa por nombre (región por defecto)

```bash
aws sqs get-queue-url --queue-name miCola
```

Resultado en `us-east-1`:
```
AWS.SimpleQueueService.NonExistentQueue: The specified queue does not exist.
```

### 3.3 Buscar en `us-east-2` (región correcta)

```bash
aws sqs get-queue-url --queue-name miCola --region us-east-2
aws sqs list-queues --region us-east-2
```

Resultado:
```json
{
    "QueueUrl": "https://sqs.us-east-2.amazonaws.com/258344940817/miCola"
}
```

```json
{
    "QueueUrls": [
        "https://sqs.us-east-2.amazonaws.com/258344940817/miCola"
    ]
}
```
Conclusión: `miCola` SÍ existe en `us-east-2` con ARN
`arn:aws:sqs:us-east-2:258344940817:miCola`.

### 3.4 Ver atributos y política de la cola

```bash
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-2.amazonaws.com/258344940817/miCola \
  --attribute-names All \
  --region us-east-2
```

Datos relevantes:
- `QueueArn`: `arn:aws:sqs:us-east-2:258344940817:miCola`
- `ApproximateNumberOfMessages`: `0`
- `Policy`: ya permite `SQS:SendMessage` con `Principal: sns.amazonaws.com`
  y condición `aws:SourceArn = arn:aws:sns:us-east-2:258344940817:transporte`.
  Esto indica que SNS `transporte` ya está autorizado a enviar a `miCola`.

## 4. Resumen y lección aprendida

1. SNS y SQS son regionales. Siempre pasar `--region`.
2. Si `aws configure get region` dice `us-east-1` pero el ARN dice
   `us-east-2`, hay que repetir la búsqueda con `--region us-east-2`.
3. `list-topics` / `list-queues` vacíos no significan que no existan,
   puede ser región equivocada.
4. `get-queue-url --queue-name miCola` es la forma más directa de
   confirmar una cola puntual.
5. `get-topic-attributes` y `get-queue-attributes` sirven para confirmar
   suscripciones y permisos SNS -> SQS.

## 5. Comandos de referencia rápida

```bash
# SNS
aws sns list-topics --region us-east-2
aws sns get-topic-attributes --topic-arn arn:aws:sns:us-east-2:258344940817:transporte --region us-east-2
aws sns list-subscriptions-by-topic --topic-arn arn:aws:sns:us-east-2:258344940817:transporte --region us-east-2
aws sns get-subscription-attributes --subscription-arn "arn:aws:sns:us-east-2:258344940817:transporte:8d6314e1-c8b2-4b0c-ba89-3a74284c3abd" --region us-east-2

# SQS
aws sqs list-queues --region us-east-2
aws sqs get-queue-url --queue-name miCola --region us-east-2
aws sqs get-queue-attributes --queue-url https://sqs.us-east-2.amazonaws.com/258344940817/miCola --attribute-names All --region us-east-2
```
