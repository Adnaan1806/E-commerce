# Architecture

## Overview

Event-driven microservices platform where services communicate exclusively through RabbitMQ events — no direct HTTP calls between services after the initial order is placed.

## Design Decisions

### Choreography Saga (not Orchestration)
Each service listens for events and reacts independently. There is no central coordinator. This means:
- No single point of failure
- Services are loosely coupled — a service can be added or removed without changing others
- Tradeoff: the overall flow is harder to visualise (see [SAGA_FLOW.md](SAGA_FLOW.md))

### RabbitMQ Topic Exchange
All events are published to a single `ecommerce-events` topic exchange. Services bind their queues to the routing keys they care about:

```
Exchange: ecommerce-events (topic, durable)

order-service-queue     → StockReserved, OutOfStock, PaymentCompleted, PaymentFailed
inventory-service-queue → OrderCreated, OrderCancelled, PaymentFailed
payment-service-queue   → StockReserved, OrderCancelled
notification-service-queue → OrderCreated, OrderConfirmed, OrderCancelled,
                              PaymentCompleted, PaymentFailed, RefundCompleted
```

### Dead Letter Queues
Failed messages (nack'd after processing error) are routed to `ecommerce-events.dlq` exchange:

```
order-service-queue.dlq
inventory-service-queue.dlq
payment-service-queue.dlq
notification-service-queue.dlq
```

### Event Schema
All events follow a standard envelope:
```json
{
  "eventId": "uuid",         // idempotency key
  "eventType": "OrderCreated",
  "version": "1.0",          // schema version for consumers
  "timestamp": "ISO-8601",
  "correlationId": "uuid",   // links all events in one saga
  "payload": {}
}
```

### Distributed Tracing
OpenTelemetry W3C `traceparent` headers are injected into RabbitMQ message headers by the producer and extracted by each consumer. This links spans across all 4 services into a single trace in Honeycomb.

## Data Stores

Each service has its own MongoDB database — no shared database:

| Service | Database | Collections |
|---------|----------|-------------|
| order-service | orders-db | orders |
| inventory-service | inventory-db | stock, reservations |
| payment-service | payments-db | payments |
| notification-service | notifications-db | notifications |
