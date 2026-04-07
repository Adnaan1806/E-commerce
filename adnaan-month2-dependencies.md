# Service Dependency Documentation

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Client / API Gateway                     │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTP POST /orders
┌─────────────────────────▼───────────────────────────────────┐
│                      Order Service                           │
│                    localhost:8001                            │
└─────────────────────────┬───────────────────────────────────┘
                          │ publishes events
┌─────────────────────────▼───────────────────────────────────┐
│            Event Bus — RabbitMQ (ecommerce-events)           │
│   OrderCreated · StockReserved · PaymentCompleted · ...      │
└──────────┬──────────────┬──────────────┬────────────────────┘
           │              │              │
┌──────────▼───┐  ┌───────▼──────┐  ┌───▼──────────────────┐
│  Inventory   │  │   Payment    │  │   Notification        │
│  Service     │  │   Service    │  │   Service             │
│  :8002       │  │   :8003      │  │   :8004               │
└──────────────┘  └──────────────┘  └───────────────────────┘
```

---

## Service Catalog

| Service | Port | Owner | Dependencies | SLA |
|---------|------|-------|--------------|-----|
| order-service | 8001 | Backend Team | RabbitMQ, MongoDB | 99.9% |
| inventory-service | 8002 | Backend Team | RabbitMQ, MongoDB | 99.9% |
| payment-service | 8003 | Backend Team | RabbitMQ, MongoDB | 99.95% |
| notification-service | 8004 | Backend Team | RabbitMQ, MongoDB | 99.5% |

### Infrastructure Dependencies

| Component | Purpose | Failover |
|-----------|---------|----------|
| RabbitMQ (CloudAMQP) | Async event bus | Messages persisted — services retry on reconnect |
| MongoDB (Atlas) | Per-service data store | Atlas managed replication |
| Honeycomb.io | Distributed tracing | Non-critical — services continue without it |

---

## Communication Matrix

| From → To | Method | Event/Endpoint | Direction |
|-----------|--------|----------------|-----------|
| Client → order-service | HTTP | POST /orders | Sync |
| order-service → inventory-service | RabbitMQ | OrderCreated | Async |
| order-service → notification-service | RabbitMQ | OrderCreated, OrderConfirmed, OrderCancelled | Async |
| inventory-service → payment-service | RabbitMQ | StockReserved | Async |
| inventory-service → order-service | RabbitMQ | StockReserved, OutOfStock | Async |
| payment-service → order-service | RabbitMQ | PaymentCompleted, PaymentFailed | Async |
| payment-service → notification-service | RabbitMQ | PaymentCompleted, PaymentFailed | Async |
| payment-service → inventory-service | RabbitMQ | PaymentFailed (triggers StockReleased) | Async |

**No direct HTTP calls between services** — all inter-service communication is async via RabbitMQ.

---

## Event Flow Diagrams

### 1. System Context Diagram

```
[Customer] ──HTTP──► [Order Service] ──events──► [RabbitMQ]
                                                      │
                          ┌───────────────────────────┤
                          │           │               │
                   [Inventory]   [Payment]    [Notification]
                   reserves      charges       emails
                   stock         card          customer
```

### 2. Service Communication Diagram

```
order-service ──── OrderCreated ────────────────────► inventory-service
order-service ◄─── StockReserved ───────────────────── inventory-service
order-service ◄─── OutOfStock ──────────────────────── inventory-service
inventory-service ─ StockReserved ──────────────────► payment-service
payment-service ─── PaymentCompleted ───────────────► order-service
payment-service ─── PaymentFailed ──────────────────► order-service
payment-service ─── PaymentFailed ──────────────────► inventory-service
order-service ──── OrderConfirmed/Cancelled ────────► notification-service
payment-service ─── PaymentCompleted/Failed ────────► notification-service
```

### 3. Saga Flow — Happy Path

```
1. Client          POST /orders
2. order-service   saves order (PENDING) → publishes OrderCreated
3. inventory-svc   reserves stock → publishes StockReserved
4. order-service   updates order (STOCK_RESERVED)
5. payment-svc     processes payment → publishes PaymentCompleted
6. order-service   updates order (CONFIRMED) → publishes OrderConfirmed
7. notification    sends confirmation email → publishes NotificationSent
```

### 4. Saga Flow — Compensation (Payment Fails)

```
1. Client          POST /orders
2. order-service   saves order (PENDING) → publishes OrderCreated
3. inventory-svc   reserves stock → publishes StockReserved
4. payment-svc     payment FAILS → publishes PaymentFailed
5. inventory-svc   releases reserved stock → publishes StockReleased  ← COMPENSATION
6. order-service   updates order (CANCELLED) → publishes OrderCancelled ← COMPENSATION
7. notification    sends failure email → publishes NotificationSent
```

### 5. Saga Flow — Out of Stock

```
1. Client          POST /orders
2. order-service   saves order (PENDING) → publishes OrderCreated
3. inventory-svc   insufficient stock → publishes OutOfStock
4. order-service   updates order (CANCELLED) → publishes OrderCancelled ← COMPENSATION
5. notification    sends cancellation email → publishes NotificationSent
```

---

## Failure Scenarios

| Service Fails | Immediate Effect | Recovery |
|---------------|-----------------|----------|
| order-service | New orders rejected (HTTP 503) | Restart — pending events still in RabbitMQ queues |
| inventory-service | OrderCreated messages queue up | Restart — reads queued messages, processes in order |
| payment-service | StockReserved messages queue up | Restart — reads queued messages; stock stays reserved |
| notification-service | Notifications delayed | Restart — reads queued messages; no data loss |
| RabbitMQ | All async communication stops | CloudAMQP HA — auto-failover; durable queues preserve messages |
| MongoDB | Service cannot read/write data | Message nack'd → goes to DLQ; Atlas replication handles failover |

---

## Runbook

### Starting the Platform

```bash
cd microservices/order-service       && npm install && npm start
cd microservices/inventory-service   && npm install && npm start
cd microservices/payment-service     && npm install && npm start
cd microservices/notification-service && npm install && npm start
```

### Seeding Inventory
```bash
curl -X POST http://localhost:8002/inventory/seed
```

### Placing a Test Order
```bash
curl -X POST http://localhost:8001/orders \
  -H "Content-Type: application/json" \
  -d '{"customerId":"c1","items":[{"productId":"PROD-001","quantity":1,"price":99.99}]}'
```

### Checking Order Status
```bash
curl http://localhost:8001/orders/<orderId>
```

### Checking Dead Letter Queues
```powershell
$cred = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("user:password"))
$headers = @{ Authorization = "Basic $cred" }
Invoke-WebRequest -Uri "https://<rabbitmq-host>/api/queues/<vhost>/order-service-queue.dlq" -Headers $headers
```

### Viewing Distributed Traces
1. Go to https://ui.honeycomb.io
2. Select dataset (e.g. `order-service`)
3. Click **Traces** tab → click any trace → **View Trace**
4. Full waterfall across all 4 services visible with timing per span

### Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | HTTP port for the service |
| `MONGO_URI` | MongoDB connection string |
| `RABBITMQ_URL` | RabbitMQ connection string (amqps://) |
| `SERVICE_NAME` | Name reported to OpenTelemetry |
| `HONEYCOMB_API_KEY` | API key for Honeycomb tracing |
| `PAYMENT_FAILURE_RATE` | Float 0–1, controls simulated payment failures (default: 0.1) |
