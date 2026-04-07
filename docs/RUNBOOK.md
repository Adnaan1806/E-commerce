# Runbook

## Starting the Platform

### Prerequisites
- RabbitMQ running: `amqp://localhost:5672`
- MongoDB running: `mongodb://localhost:27017`

### Start all services (in order)

```bash
# 1. Start order-service
cd microservices/order-service
npm install
npm start

# 2. Start inventory-service
cd microservices/inventory-service
npm install
npm start

# 3. Start payment-service
cd microservices/payment-service
npm install
npm start

# 4. Start notification-service
cd microservices/notification-service
npm install
npm start
```

### Seed inventory (required before placing orders)

```bash
curl -X POST http://localhost:8002/inventory/seed
```

---

## Placing a Test Order

```bash
curl -X POST http://localhost:8001/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "customer-123",
    "items": [{ "productId": "product-1", "quantity": 1, "price": 99.99 }]
  }'
```

Check order status:
```bash
curl http://localhost:8001/orders/<orderId>
```

---

## Observability

### Distributed Traces
View traces at [ui.honeycomb.io](https://ui.honeycomb.io):
1. Select dataset (e.g. `order-service`)
2. Click **Traces** tab
3. Click any trace → **View Trace** for waterfall across all 4 services

### Key trace attributes
- `trace.trace_id` — links all spans for one order
- `messaging.correlation_id` — correlationId from event envelope
- `messaging.event_type` — the event type processed

---

## Troubleshooting

### Service fails to connect to RabbitMQ
- Verify RabbitMQ is running: open `http://localhost:15672` (guest/guest)
- Check `RABBITMQ_URL` in the service's `.env`
- Services auto-retry connection — restart the service once RabbitMQ is up

### Order stuck in PENDING
- Check inventory-service logs — may be out of stock
- Verify inventory is seeded: `GET http://localhost:8002/inventory/product-1`

### Order stuck in STOCK_RESERVED
- Check payment-service logs for payment processing errors
- Check `payment-service-queue.dlq` in RabbitMQ management UI for failed messages

### Messages in Dead Letter Queue
1. Open RabbitMQ management: `http://localhost:15672`
2. Navigate to **Queues** → find `*.dlq` queues
3. Click queue → **Get Messages** to inspect the failed message
4. Fix the underlying issue, then republish the message manually

### High payment failure rate
Set `PAYMENT_FAILURE_RATE=0` in `microservices/payment-service/.env` for 100% success during demos.

---

## Environment Variables

| Variable | Services | Description |
|----------|----------|-------------|
| `PORT` | all | HTTP port |
| `MONGODB_URI` | all | MongoDB connection string |
| `RABBITMQ_URL` | all | RabbitMQ connection string |
| `SERVICE_NAME` | all | Name reported to OpenTelemetry |
| `HONEYCOMB_API_KEY` | all | Honeycomb API key for traces |
| `PAYMENT_FAILURE_RATE` | payment | Float 0–1, default 0.1 (10% failure) |
