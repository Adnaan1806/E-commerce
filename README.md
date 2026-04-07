# Event-Driven E-Commerce Platform

A microservices-based e-commerce backend using RabbitMQ for async event communication and OpenTelemetry for distributed tracing.

## Architecture

```
Client / API Gateway
        |
  Order Service (POST /orders) :8001
        |
  Event Bus (RabbitMQ — ecommerce-events exchange)
   |              |               |
Inventory     Payment        Notification
Service       Service         Service
:8002         :8003           :8004
```

## Services

| Service | Port | Responsibility |
|---------|------|----------------|
| order-service | 8001 | Accept orders, track order state |
| inventory-service | 8002 | Reserve/release stock |
| payment-service | 8003 | Process payments, issue refunds |
| notification-service | 8004 | Send email/SMS notifications |

## Quick Start

### Prerequisites
- Node.js 20+
- RabbitMQ running at `amqp://localhost:5672`
- MongoDB running at `mongodb://localhost:27017`

### Run all services

```bash
# In separate terminals
cd microservices/order-service && npm install && npm start
cd microservices/inventory-service && npm install && npm start
cd microservices/payment-service && npm install && npm start
cd microservices/notification-service && npm install && npm start
```

### Test

```bash
curl -X POST http://localhost:8001/orders \
  -H "Content-Type: application/json" \
  -d '{"customerId": "c1", "items": [{"productId": "p1", "quantity": 1, "price": 99.99}]}'
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Saga Flow](docs/SAGA_FLOW.md)
- [Service Catalog](docs/SERVICE_CATALOG.md)
- [Runbook](docs/RUNBOOK.md)

## Observability

Distributed traces sent to [Honeycomb](https://ui.honeycomb.io). Set `HONEYCOMB_API_KEY` in each service's `.env`.
