# Step 05b — Generate Distributed Tracing Documentation

**Output file:** `{output_folder}/{challenge_name}-tracing.md`

Generate the complete distributed tracing deliverable based on the implemented OpenTelemetry setup.

---

## Actions

1. Read each service's tracing.py for collector/exporter config
2. Read docker-compose.yml for Jaeger service configuration
3. Read otel-collector-config.yaml if present

## Generate Document

Write the following to `{output_folder}/{challenge_name}-tracing.md`:

```markdown
# Distributed Tracing Implementation

## Tracing Architecture

### Components

```
[Service] → [OTel SDK] → [OTLP Exporter] → [Jaeger]
                                                ↓
                                         [Jaeger UI :16686]
```

| Component | Technology | Purpose |
|---|---|---|
| SDK | opentelemetry-sdk 1.x | Instrumentation in each service |
| Exporter | JaegerExporter (Thrift UDP) | Ships spans to Jaeger agent |
| Backend | Jaeger all-in-one | Collects, stores, visualizes traces |
| Propagation | W3C TraceContext | Carries trace context across Kafka messages |

### Collector Setup

Jaeger runs as an all-in-one container in docker-compose.yml:

```yaml
jaeger:
  image: jaegertracing/all-in-one:latest
  ports:
    - "6831:6831/udp"   # Jaeger agent (Thrift compact)
    - "16686:16686"      # Jaeger UI
    - "14250:14250"      # gRPC collector (for OTel collector)
  environment:
    - COLLECTOR_OTLP_ENABLED=true
```

### Sampling Strategy

| Environment | Strategy | Rate |
|---|---|---|
| Development | AlwaysOn | 100% of traces |
| Staging | TraceIdRatio | 10% |
| Production | ParentBased + TraceIdRatio | 1% (adaptive) |

```python
# Development: AlwaysOnSampler (default)
provider = TracerProvider(resource=resource)

# Production: TraceIdRatioBased
from opentelemetry.sdk.trace.sampling import TraceIdRatioBased
provider = TracerProvider(
    sampler=TraceIdRatioBased(0.01),
    resource=resource
)
```

---

## Instrumentation

### Shared Tracing Module (tracing.py)

Each service uses an identical tracing.py:

```python
import os
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.jaeger.thrift import JaegerExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

def setup_tracing(service_name: str):
    resource = Resource.create({"service.name": service_name})

    jaeger_exporter = JaegerExporter(
        agent_host_name=os.getenv("JAEGER_HOST", "localhost"),
        agent_port=int(os.getenv("JAEGER_PORT", "6831")),
    )

    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(jaeger_exporter))
    trace.set_tracer_provider(provider)

    return trace.get_tracer(service_name)

def inject_trace_context(headers: dict) -> dict:
    """Inject W3C TraceContext into Kafka message headers."""
    propagator = TraceContextTextMapPropagator()
    propagator.inject(headers)
    return headers

def extract_trace_context(headers: dict):
    """Extract W3C TraceContext from Kafka message headers."""
    propagator = TraceContextTextMapPropagator()
    return propagator.extract(headers)
```

### Automatic Instrumentation

FastAPI is automatically instrumented in each service's main.py:

```python
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from tracing import setup_tracing

tracer = setup_tracing(os.getenv("SERVICE_NAME", "order-service"))
app = FastAPI()
FastAPIInstrumentor().instrument_app(app)
```

This automatically creates spans for every HTTP request with:
- `http.method`, `http.url`, `http.status_code`
- Request duration
- Exception recording on errors

### Custom Spans

Each service adds domain-specific spans:

**order-service:**
```python
@app.post("/orders")
async def create_order(request: CreateOrderRequest):
    with tracer.start_as_current_span("validate-order") as span:
        span.set_attribute("order.customer_id", request.customerId)
        span.set_attribute("order.item_count", len(request.items))
        order = validate_and_create(request)

    with tracer.start_as_current_span("publish-event") as span:
        span.set_attribute("event.type", "OrderCreated")
        span.set_attribute("order.id", order.id)
        publish_order_created(order)

    return order
```

**inventory-service:**
```python
def handle_order_created(event: dict, ctx):
    with tracer.start_as_current_span(
        "reserve-stock", context=ctx
    ) as span:
        span.set_attribute("order.id", event["payload"]["orderId"])
        span.set_attribute("product.id", event["payload"]["items"][0]["productId"])
        result = attempt_reservation(event)

    with tracer.start_as_current_span("publish-event") as span:
        span.set_attribute("event.type", result.event_type)
        publish_result(result)
```

**payment-service:**
```python
def handle_stock_reserved(event: dict, ctx):
    with tracer.start_as_current_span(
        "process-payment", context=ctx
    ) as span:
        span.set_attribute("order.id", event["payload"]["orderId"])
        span.set_attribute("payment.amount", event["payload"]["totalAmount"])
        result = charge_customer(event)
        span.set_attribute("payment.status", result.status)
```

### Context Propagation via Kafka

Trace context is carried across service boundaries through Kafka message headers:

**Publishing (inject):**
```python
def publish_event(topic: str, event_type: str, payload: dict, correlation_id: str):
    headers = {}
    inject_trace_context(headers)  # Adds traceparent, tracestate headers

    event = build_event(event_type, payload, correlation_id)
    producer.send(
        topic,
        value=json.dumps(event).encode(),
        headers=[(k, v.encode()) for k, v in headers.items()]
    )
```

**Consuming (extract):**
```python
for message in consumer:
    headers = {k: v.decode() for k, v in (message.headers or [])}
    ctx = extract_trace_context(headers)  # Restores parent span context

    with tracer.start_as_current_span(
        "consume-event",
        context=ctx,
        kind=trace.SpanKind.CONSUMER
    ) as span:
        span.set_attribute("messaging.system", "kafka")
        span.set_attribute("messaging.destination", topic)
        handle_event(json.loads(message.value), ctx)
```

---

## Dashboard Configuration

### Accessing Jaeger UI

After running `docker compose up`, open: http://localhost:16686

### Key Traces to Monitor

| Trace | Service | Expected Duration | Alert Threshold |
|---|---|---|---|
| POST /orders (full saga) | order-service | < 400ms | > 500ms |
| StockReserved processing | inventory-service | < 50ms | > 100ms |
| PaymentCompleted processing | payment-service | < 250ms | > 400ms |
| NotificationSent processing | notification-service | < 150ms | > 300ms |

### Searching Traces in Jaeger

1. Open http://localhost:16686
2. Select **Service**: `order-service`
3. Select **Operation**: `POST /orders`
4. Click **Find Traces**
5. Click any trace to see the full saga waterfall

### Full Saga Trace Example

```
POST /orders [order-service] ─────────────────────── 385ms
├── validate-order ─── 5ms
├── publish-event (OrderCreated) ─── 8ms
│
├── consume-event [inventory-service] ──────────────── 35ms
│   ├── check-availability ─── 5ms
│   ├── reserve-stock ─── 20ms
│   └── publish-event (StockReserved) ─── 7ms
│
├── consume-event [payment-service] ────────────────── 220ms
│   ├── process-payment ─── 195ms
│   └── publish-event (PaymentCompleted) ─── 8ms
│
├── consume-event [order-service] ──────────────────── 12ms
│   └── update-order-status (CONFIRMED) ─── 5ms
│
└── consume-event [notification-service] ───────────── 105ms
    ├── send-notification (email) ─── 90ms
    └── publish-event (NotificationSent) ─── 8ms
```

### Service Dependency Graph

Jaeger automatically generates a service dependency graph at:
http://localhost:16686/dependencies

Expected graph:
```
order-service ──→ inventory-service
order-service ──→ payment-service (via inventory)
order-service ──→ notification-service
inventory-service ──→ payment-service
inventory-service ──→ notification-service
payment-service ──→ notification-service
```

### SLO Tracking

| SLO | Target | Measurement |
|---|---|---|
| Order saga P95 latency | < 500ms | Trace duration for POST /orders |
| Eventual consistency | < 5s | Time from OrderCreated to NotificationSent |
| Error rate | < 1% | Failed traces / total traces |
| Availability | > 99.9% | Successful /health checks |

### Alert Setup (Production)

Configure alerts on:
1. **P95 saga latency > 500ms** — check payment-service spans first
2. **DLQ topic lag > 0** — consumer processing failures
3. **Missing spans** — service not instrumented or exporter down
4. **High error rate** — payment failures or inventory issues
```
