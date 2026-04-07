# Distributed Tracing Implementation

## Tracing Architecture

### Collector Setup
- **SDK**: OpenTelemetry Node.js SDK (`@opentelemetry/sdk-node`)
- **Exporter**: OTLP HTTP (`@opentelemetry/exporter-trace-otlp-http`)
- **Backend**: Honeycomb.io (cloud-based, no local collector required)
- Each service initialises the SDK at startup via `tracing.js` before any other module loads

```javascript
const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: process.env.SERVICE_NAME,
  }),
  traceExporter: new OTLPTraceExporter({
    url: 'https://api.honeycomb.io/v1/traces',
    headers: { 'x-honeycomb-team': process.env.HONEYCOMB_API_KEY },
  }),
  instrumentations: [getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-fs': { enabled: false },
  })],
})
```

### Sampling Strategy
- **Development**: 100% sampling (all requests traced)
- **Production recommendation**: 1–10% head-based sampling to control cost

### Storage Backend
- Honeycomb.io free tier — 20M events/month
- Traces retained for 60 days
- Datasets per service: `order-service`, `inventory-service`, `payment-service`, `notification-service`

---

## Instrumentation

### Automatic Instrumentation
`@opentelemetry/auto-instrumentations-node` automatically instruments:
- **Express** — HTTP spans for every route (`POST /orders`, `GET /orders/:id`)
- **Mongoose/MongoDB** — database query spans
- **HTTP client** — outgoing HTTP request spans

### Custom Spans
Each RabbitMQ consumer creates a custom span to represent message processing:

```javascript
const span = tracer.startSpan(`process ${eventType}`, { kind: SpanKind.CONSUMER })
span.setAttribute('messaging.event_type', eventType)
span.setAttribute('messaging.correlation_id', correlationId)
// ... process event
span.setStatus({ code: SpanStatusCode.OK })
span.end()
```

On error, exceptions are recorded:
```javascript
span.recordException(err)
span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
```

### Context Propagation
W3C `traceparent` headers are injected into every RabbitMQ message by the producer:

```javascript
const headers = {}
api.propagation.inject(api.context.active(), headers)
channel.publish(EXCHANGE, eventType, buffer, { persistent: true, headers })
```

Each consumer extracts the context and continues the trace as a child span:

```javascript
const parentContext = api.propagation.extract(api.ROOT_CONTEXT, msg.properties.headers || {})
await api.context.with(parentContext, async () => {
  const span = tracer.startSpan(`process ${eventType}`, { kind: SpanKind.CONSUMER })
  // ... all downstream spans are children of the original HTTP span
})
```

This links all 4 services into a single end-to-end trace.

---

## Dashboard Configuration

### Key Traces to Monitor

**1. Order Created (Happy Path)**
Full saga visible in one trace:
```
POST /orders (order-service)               ~260ms
  └── process OrderCreated (inventory)     ~270ms
      └── process StockReserved (payment)  ~88ms
          └── process PaymentCompleted (notification) ~77ms
          └── process PaymentCompleted (order)        ~158ms
              └── process OrderConfirmed (notification) ~93ms
```

**2. Payment Failed (Compensation)**
```
POST /orders (order-service)
  └── process OrderCreated (inventory)
      └── process StockReserved (payment) → PaymentFailed
          └── process PaymentFailed (inventory) → StockReleased
          └── process PaymentFailed (order) → OrderCancelled
```

**3. Out of Stock**
```
POST /orders (order-service)
  └── process OrderCreated (inventory) → OutOfStock
      └── process OutOfStock (order) → OrderCancelled
```

### Alert Setup (Recommended)
| Alert | Condition | Threshold |
|-------|-----------|-----------|
| High latency | `duration_ms` p95 | > 2000ms |
| Payment failures | `error = true` in payment-service | > 5 per minute |
| DLQ messages | `messaging.event_type` in DLQ queue | > 0 |

### SLO Tracking
- **Order creation p99 latency**: < 500ms
- **End-to-end saga completion**: < 2000ms
- **Error rate**: < 1%

Query in Honeycomb:
- SELECT `HEATMAP(duration_ms)` WHERE `service.name = order-service`
- SELECT `COUNT` WHERE `error = true` GROUP BY `service.name`

---

## Required Tracing Features

- [x] End-to-end trace visualisation — all 4 services linked in one waterfall in Honeycomb
- [x] Service dependency graph — visible via Honeycomb Service Map
- [x] Latency breakdown by service — each span shows duration per service
- [x] Error tracking with traces — exceptions recorded on spans with `recordException()`
- [x] Context propagation — W3C traceparent headers passed through RabbitMQ messages
