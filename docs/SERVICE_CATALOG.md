# Service Catalog

## order-service

| Property | Value |
|----------|-------|
| Port | 8001 |
| Language | Node.js 20 |
| Database | MongoDB (orders-db) |
| Publishes | OrderCreated, OrderConfirmed, OrderCancelled |
| Consumes | StockReserved, OutOfStock, PaymentCompleted, PaymentFailed |

### API

**POST /orders**
```json
Request:
{
  "customerId": "string",
  "items": [{ "productId": "string", "quantity": 1, "price": 99.99 }]
}

Response 201:
{
  "orderId": "uuid",
  "status": "PENDING",
  "totalAmount": 99.99
}
```

**GET /orders/:orderId**
Returns current order status and details.

### Order States
`PENDING` → `STOCK_RESERVED` → `CONFIRMED` | `CANCELLED`

---

## inventory-service

| Property | Value |
|----------|-------|
| Port | 8002 |
| Language | Node.js 20 |
| Database | MongoDB (inventory-db) |
| Publishes | StockReserved, OutOfStock, StockReleased |
| Consumes | OrderCreated, OrderCancelled, PaymentFailed |

### API

**GET /inventory/:productId** — Returns current stock level

**POST /inventory/seed** — Seeds test stock data

---

## payment-service

| Property | Value |
|----------|-------|
| Port | 8003 |
| Language | Node.js 20 |
| Database | MongoDB (payments-db) |
| Publishes | PaymentCompleted, PaymentFailed, RefundCompleted |
| Consumes | StockReserved, OrderCancelled |

**Note:** Payment is simulated. `PAYMENT_FAILURE_RATE` env var controls failure probability (default: 10%).

---

## notification-service

| Property | Value |
|----------|-------|
| Port | 8004 |
| Language | Node.js 20 |
| Database | MongoDB (notifications-db) |
| Publishes | NotificationSent |
| Consumes | OrderCreated, OrderConfirmed, OrderCancelled, PaymentCompleted, PaymentFailed, RefundCompleted |

Notifications are simulated (logged to console + saved to DB). No real email/SMS sent.

---

## Event Bus

| Property | Value |
|----------|-------|
| Broker | RabbitMQ |
| Exchange | ecommerce-events (topic, durable) |
| DLQ Exchange | ecommerce-events.dlq (topic, durable) |
| Message persistence | `persistent: true` |
| Queue durability | `durable: true` |

---

## Shared Event Schema

```json
{
  "eventId": "uuid",
  "eventType": "string",
  "version": "1.0",
  "timestamp": "2025-01-01T10:00:00Z",
  "correlationId": "uuid",
  "payload": {}
}
```
