# Step 05a — Generate Event Bus Documentation

**Output file:** `{output_folder}/{challenge_name}-eventbus.md`

Scan the microservices/ directory to extract actual Kafka configuration, then generate the complete event bus deliverable.

---

## Actions

1. Read microservices/docker-compose.yml to extract Kafka/broker config
2. Read microservices/schemas/events.json for all event schemas
3. Read each service's events.py and consumer.py for producer/consumer patterns

## Generate Document

Write the following to `{output_folder}/{challenge_name}-eventbus.md`:

```markdown
# Event Bus Implementation

## Message Broker Configuration

### Broker Choice: Apache Kafka

**Rationale:** Kafka was chosen over RabbitMQ for this platform because:
- **Durability**: Messages persisted to disk, not just in-memory queues
- **Replay capability**: Consumer groups can reset offsets to replay any event
- **Throughput**: Handles high-volume order events with partitioned topics
- **At-least-once guarantees**: Producer acks=all + consumer manual commit
- **Ecosystem**: Native OpenTelemetry support via header propagation

### Topic Structure

| Topic | Partitions | Retention | Producer | Consumers |
|---|---|---|---|---|
| order-events | 3 | 7 days | order-service | inventory-service, notification-service |
| inventory-events | 3 | 7 days | inventory-service | order-service, notification-service |
| payment-events | 3 | 7 days | payment-service | order-service, notification-service |
| notification-events | 1 | 3 days | notification-service | (terminal) |
| order-events.dlq | 1 | 30 days | consumer error handlers | ops team |
| inventory-events.dlq | 1 | 30 days | consumer error handlers | ops team |
| payment-events.dlq | 1 | 30 days | consumer error handlers | ops team |
| notification-events.dlq | 1 | 30 days | consumer error handlers | ops team |

### Partitioning Strategy

All event topics are partitioned by `orderId` (extracted from payload).
This ensures all events for a single order are processed in sequence by the same consumer partition.

### Consumer Groups

| Consumer Group | Topic | Service |
|---|---|---|
| order-inventory-consumer | inventory-events | order-service |
| order-payment-consumer | payment-events | order-service |
| inventory-order-consumer | order-events | inventory-service |
| inventory-payment-consumer | payment-events | inventory-service |
| payment-inventory-consumer | inventory-events | payment-service |
| payment-order-consumer | order-events | payment-service |
| notification-consumer | order-events, inventory-events, payment-events | notification-service |

---

## Event Schema Registry

All events conform to the following envelope schema:

```json
{
  "eventId": "uuid4",
  "eventType": "string (enum)",
  "timestamp": "ISO 8601 UTC",
  "version": "1.0",
  "correlationId": "uuid4 (same for all events in one saga)",
  "payload": {}
}
```

### Schema Versioning Strategy

- Version field follows semantic versioning (`"1.0"`, `"1.1"`, `"2.0"`)
- Breaking changes (removed/renamed fields) require major version bump
- Consumers check `version` field and route to appropriate handler
- Old versions supported for 2 sprints before deprecation

### OrderCreated (order-service → order-events)

```json
{
  "eventId": "a1b2c3d4-...",
  "eventType": "OrderCreated",
  "timestamp": "2025-01-15T10:30:00Z",
  "version": "1.0",
  "correlationId": "saga-uuid",
  "payload": {
    "orderId": "uuid",
    "customerId": "uuid",
    "items": [
      {"productId": "PROD-001", "quantity": 2, "price": 29.99}
    ],
    "totalAmount": 59.98,
    "status": "PENDING"
  }
}
```

### OrderConfirmed (order-service → order-events)

```json
{
  "eventType": "OrderConfirmed",
  "payload": {
    "orderId": "uuid",
    "customerId": "uuid",
    "totalAmount": 59.98,
    "estimatedDelivery": "2025-01-20",
    "status": "CONFIRMED"
  }
}
```

### OrderCancelled (order-service → order-events)

```json
{
  "eventType": "OrderCancelled",
  "payload": {
    "orderId": "uuid",
    "customerId": "uuid",
    "reason": "PaymentFailed | OutOfStock | CustomerCancelled",
    "status": "CANCELLED"
  }
}
```

### StockReserved (inventory-service → inventory-events)

```json
{
  "eventType": "StockReserved",
  "payload": {
    "orderId": "uuid",
    "productId": "PROD-001",
    "quantity": 2,
    "reservationId": "uuid",
    "warehouseId": "WH-001"
  }
}
```

### StockReleased (inventory-service → inventory-events)

```json
{
  "eventType": "StockReleased",
  "payload": {
    "orderId": "uuid",
    "productId": "PROD-001",
    "quantity": 2,
    "reservationId": "uuid",
    "reason": "PaymentFailed | OrderCancelled"
  }
}
```

### OutOfStock (inventory-service → inventory-events)

```json
{
  "eventType": "OutOfStock",
  "payload": {
    "orderId": "uuid",
    "productId": "PROD-001",
    "requestedQuantity": 5,
    "availableQuantity": 0
  }
}
```

### PaymentCompleted (payment-service → payment-events)

```json
{
  "eventType": "PaymentCompleted",
  "payload": {
    "orderId": "uuid",
    "paymentId": "uuid",
    "customerId": "uuid",
    "amount": 59.98,
    "currency": "USD",
    "method": "CREDIT_CARD",
    "transactionRef": "TXN-12345"
  }
}
```

### PaymentFailed (payment-service → payment-events)

```json
{
  "eventType": "PaymentFailed",
  "payload": {
    "orderId": "uuid",
    "paymentId": "uuid",
    "customerId": "uuid",
    "amount": 59.98,
    "failureReason": "INSUFFICIENT_FUNDS | CARD_DECLINED | TIMEOUT",
    "retryable": false
  }
}
```

### RefundCompleted (payment-service → payment-events)

```json
{
  "eventType": "RefundCompleted",
  "payload": {
    "orderId": "uuid",
    "paymentId": "uuid",
    "refundId": "uuid",
    "amount": 59.98,
    "currency": "USD"
  }
}
```

### NotificationSent (notification-service → notification-events)

```json
{
  "eventType": "NotificationSent",
  "payload": {
    "orderId": "uuid",
    "customerId": "uuid",
    "notificationType": "ORDER_CONFIRMED | ORDER_CANCELLED | PAYMENT_FAILED",
    "channel": "EMAIL | SMS",
    "messageId": "uuid",
    "subject": "Your order has been confirmed"
  }
}
```

---

## Persistence Strategy

### Event Storage

Events are persisted by Kafka to disk with the following configuration:

```properties
log.retention.hours=168          # 7 days for business events
log.retention.hours=720          # 30 days for DLQ topics
log.segment.bytes=1073741824     # 1GB per segment
log.cleanup.policy=delete        # Time-based deletion
```

### Replay Capability

Consumer groups can replay events by resetting offsets:

```bash
# Reset consumer group to beginning of topic
kafka-consumer-groups.sh \
  --bootstrap-server kafka:9092 \
  --group inventory-order-consumer \
  --topic order-events \
  --reset-offsets --to-earliest --execute
```

Use cases:
- Service restart after failure (auto-resume from last committed offset)
- Bug fix replay: reprocess events after fixing a consumer bug
- New service onboarding: bootstrap from historical events

---

## Delivery Guarantees

### At-Least-Once Implementation

**Producer side (acks=all):**
```python
producer = KafkaProducer(
    bootstrap_servers=[KAFKA_BOOTSTRAP_SERVERS],
    acks='all',                    # Wait for all replicas
    retries=3,                     # Retry on transient failure
    value_serializer=lambda v: json.dumps(v).encode('utf-8')
)
producer.send(topic, value=event)
producer.flush()                   # Synchronous confirmation
```

**Consumer side (manual commit after processing):**
```python
consumer = KafkaConsumer(
    topic,
    bootstrap_servers=[KAFKA_BOOTSTRAP_SERVERS],
    group_id=CONSUMER_GROUP,
    enable_auto_commit=False,      # Manual commit
    auto_offset_reset='earliest'
)
for msg in consumer:
    handle_event(msg.value)
    consumer.commit()              # Only after successful processing
```

### Idempotency Handling

Every consumer maintains a processed event set keyed by `eventId`:

```python
processed_events: set = set()  # Redis in production

def handle_event(event: dict):
    event_id = event['eventId']
    if event_id in processed_events:
        logger.info(f"Duplicate event skipped: {event_id}")
        return
    # Process business logic
    process(event)
    processed_events.add(event_id)
```

In production, use Redis with TTL matching event retention period:
```python
redis_client.set(f"processed:{event_id}", "1", ex=604800)  # 7 days
```

### Dead Letter Queue Setup

Events that fail processing after 3 retries are forwarded to the DLQ topic:

```python
MAX_RETRIES = 3

def safe_handle_event(event: dict, retry_count: int = 0):
    try:
        handle_event(event)
    except Exception as e:
        if retry_count < MAX_RETRIES:
            safe_handle_event(event, retry_count + 1)
        else:
            dlq_topic = f"{source_topic}.dlq"
            event['_dlq_reason'] = str(e)
            event['_dlq_timestamp'] = datetime.utcnow().isoformat()
            event['_retry_count'] = retry_count
            publish_event(dlq_topic, event)
            logger.error(f"Event sent to DLQ: {event['eventId']}")
```

DLQ monitoring: Check DLQ topic lag daily. Events in DLQ require manual inspection and replay after root cause fix.
```
