# Event Bus Implementation

## Message Broker Configuration

### Broker Choice
**RabbitMQ** was chosen over Kafka for this implementation.

**Rationale:**
- Order volumes are moderate — RabbitMQ's acknowledgement-based model fits better than Kafka's log-based approach
- Flexible routing via topic exchanges allows each service to subscribe only to relevant events
- Built-in dead letter queue support without additional configuration
- Simpler operational overhead for a 4-service architecture

### Topic/Queue Structure

```
Exchange: ecommerce-events (type: topic, durable: true)

Bindings:
  order-service-queue        → StockReserved, OutOfStock, PaymentCompleted, PaymentFailed
  inventory-service-queue    → OrderCreated, OrderCancelled, PaymentFailed
  payment-service-queue      → StockReserved, OrderCancelled
  notification-service-queue → OrderCreated, OrderConfirmed, OrderCancelled,
                                PaymentCompleted, PaymentFailed, RefundCompleted

Dead Letter Exchange: ecommerce-events.dlq (type: topic, durable: true)

DLQ Queues:
  order-service-queue.dlq
  inventory-service-queue.dlq
  payment-service-queue.dlq
  notification-service-queue.dlq
```

### Partitioning Strategy
RabbitMQ uses `prefetch(1)` per consumer to ensure ordered processing per queue. Each service has a dedicated queue, providing natural isolation between consumers.

---

## Event Schema Registry

### Standard Event Envelope
All events share a common envelope structure:

```json
{
  "eventId": "uuid",
  "eventType": "OrderCreated",
  "timestamp": "2025-01-15T10:30:00Z",
  "version": "1.0",
  "correlationId": "uuid",
  "payload": {}
}
```

### Event Catalog

**OrderCreated**
```json
{
  "eventType": "OrderCreated",
  "version": "1.0",
  "payload": {
    "orderId": "uuid",
    "customerId": "uuid",
    "items": [{ "productId": "string", "quantity": 1, "price": 99.99 }],
    "totalAmount": 99.99
  }
}
```

**StockReserved**
```json
{
  "eventType": "StockReserved",
  "version": "1.0",
  "payload": {
    "orderId": "uuid",
    "productId": "string",
    "quantity": 1,
    "reservationId": "uuid",
    "warehouseId": "WH-001"
  }
}
```

**OutOfStock**
```json
{
  "eventType": "OutOfStock",
  "version": "1.0",
  "payload": {
    "orderId": "uuid",
    "productId": "string",
    "requestedQuantity": 2,
    "availableQuantity": 0
  }
}
```

**PaymentCompleted**
```json
{
  "eventType": "PaymentCompleted",
  "version": "1.0",
  "payload": {
    "orderId": "uuid",
    "paymentId": "uuid",
    "customerId": "uuid",
    "amount": 99.99,
    "currency": "USD",
    "method": "CREDIT_CARD",
    "transactionRef": "TXN-1234567890"
  }
}
```

**PaymentFailed**
```json
{
  "eventType": "PaymentFailed",
  "version": "1.0",
  "payload": {
    "orderId": "uuid",
    "paymentId": "uuid",
    "failureReason": "INSUFFICIENT_FUNDS",
    "retryable": false
  }
}
```

**OrderConfirmed / OrderCancelled / StockReleased / RefundCompleted / NotificationSent** follow the same envelope pattern with service-specific payloads.

---

## Persistence Strategy

### Event Storage
- All messages published with `{ persistent: true }` — messages survive RabbitMQ restarts
- All queues declared with `{ durable: true }` — queue definitions survive RabbitMQ restarts
- Each service stores processed events in its own MongoDB collection for audit trail

### Replay Capability
- Failed messages are automatically routed to DLQ via `x-dead-letter-exchange`
- Messages in DLQ can be inspected and replayed via the RabbitMQ management API
- Each event carries a `correlationId` to trace the full saga when replaying

### Retention Policy
- Active queues: messages held until acknowledged (ack) or dead-lettered (nack)
- DLQ: messages retained indefinitely for manual inspection and replay
- MongoDB: events stored permanently per service database

---

## Delivery Guarantees

### At-Least-Once Implementation
RabbitMQ delivers messages at least once. Consumers use manual acknowledgement:
- `channel.ack(msg)` — after successful processing
- `channel.nack(msg, false, false)` — on failure, routes to DLQ

### Idempotency Handling
Each consumer maintains a `processedEvents` Set keyed on `eventId` (UUID):

```javascript
if (processedEvents.has(eventId)) {
  channel.ack(msg) // silently skip duplicate
  return
}
processedEvents.add(eventId)
```

This prevents duplicate processing when RabbitMQ redelivers messages.

### Dead Letter Queue Setup
Each service queue is declared with `x-dead-letter-exchange`:

```javascript
await channel.assertQueue(QUEUE, {
  durable: true,
  arguments: { 'x-dead-letter-exchange': 'ecommerce-events.dlq' }
})
```

When a consumer throws an error and calls `nack`, RabbitMQ automatically routes the message to the corresponding `.dlq` queue for manual inspection and replay.
