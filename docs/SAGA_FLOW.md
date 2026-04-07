# Saga Flow — Order Processing

## Happy Path

```
Client
  │
  ▼
POST /orders ──► OrderService saves order (PENDING)
                      │ publishes OrderCreated
                      ▼
              InventoryService reserves stock
                      │ publishes StockReserved
                      ▼
              PaymentService processes payment
                      │ publishes PaymentCompleted
                      ▼
              OrderService updates order (CONFIRMED)
                      │ publishes OrderConfirmed
                      ▼
              NotificationService sends confirmation email
                      │ publishes NotificationSent
```

**Events in order:**
1. `OrderCreated` — order-service → inventory-service, notification-service
2. `StockReserved` — inventory-service → payment-service, order-service
3. `PaymentCompleted` — payment-service → order-service, notification-service
4. `OrderConfirmed` — order-service → notification-service

---

## Compensation Path — Payment Fails

```
Client
  │
  ▼
POST /orders ──► OrderService saves order (PENDING)
                      │ publishes OrderCreated
                      ▼
              InventoryService reserves stock
                      │ publishes StockReserved
                      ▼
              PaymentService FAILS
                      │ publishes PaymentFailed
                      ▼
              InventoryService releases reserved stock
                      │ publishes StockReleased
                      ▼
              OrderService updates order (CANCELLED)
                      │ publishes OrderCancelled
                      ▼
              NotificationService sends failure email
```

**Compensation events in order:**
1. `OrderCreated`
2. `StockReserved`
3. `PaymentFailed` — triggers compensation
4. `StockReleased` — inventory-service compensates
5. `OrderCancelled` — order-service compensates
6. `NotificationSent` (type: PAYMENT_FAILED)

---

## Compensation Path — Out of Stock

```
POST /orders ──► OrderCreated
                      │
              InventoryService: not enough stock
                      │ publishes OutOfStock
                      ▼
              OrderService: cancels immediately
                      │ publishes OrderCancelled
                      ▼
              NotificationService: sends cancellation email
```

---

## Failure Scenarios & Recovery

| Failure | Effect | Recovery |
|---------|--------|----------|
| inventory-service crashes | StockReserved not published | RabbitMQ holds `OrderCreated` message; inventory-service re-reads on restart |
| payment-service times out | PaymentFailed published with `retryable: true` | Client can retry the order |
| notification-service crashes | Notification lost | Message goes to `notification-service-queue.dlq` for manual inspection/replay |
| RabbitMQ restarts | Queues are durable, messages are persistent | No messages lost |
| MongoDB unavailable | Consumer throws, message nack'd | Message goes to DLQ after failure |

---

## Idempotency

Every event has a unique `eventId` (UUID). Each consumer maintains a `processedEvents` Set and skips duplicate `eventId`s. This handles RabbitMQ at-least-once delivery.
