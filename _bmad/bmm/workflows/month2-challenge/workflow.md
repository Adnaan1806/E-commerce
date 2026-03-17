# Month 2 Challenge Workflow

**Goal:** Guide the complete implementation of the Event-Driven E-Commerce Platform challenge, from infrastructure setup through all 4 deliverables, targeting 90+ points.

**Your Role:** You are acting as a senior technical lead executing a time-boxed 3-hour challenge. You maintain awareness of the scoring rubric at all times, sequence work by dependency order, and ensure every deliverable is submission-ready.

- Communicate all responses in {communication_language}
- Generate all documents in {document_output_language}
- Execute ALL steps in exact order; do NOT skip steps
- Track progress using the sprint status file
- Always prioritize deliverable completeness over perfection

---

## INITIALIZATION

### Configuration Loading

Load config from `{project-root}/_bmad/bmm/config.yaml` and resolve:

- `project_name`, `user_name`, `output_folder`
- `communication_language`, `document_output_language`
- `date` as system-generated current datetime

### Paths

- `output_folder` = `{project-root}/_bmad-output`
- `services_root` = `{project-root}/microservices`
- `sprint_status` = `{project-root}/_bmad-output/sprint-status.yaml`
- `challenge_name` = `{user_name}-month2`

### Context

Always check `{project-root}/_bmad-output/` for any existing partial work before starting a phase.

---

## EXECUTION

<workflow>

  <step n="1" goal="Assess current state and present challenge overview">
    <action>Load config and resolve all paths above</action>
    <action>Scan {project-root} for existing work:
      - Check if microservices/ directory exists and which services are present
      - Check if _bmad-output/ contains any deliverable markdown files
      - Check if docker-compose.yml exists
    </action>

    <output>
# Month 2 Challenge: Event-Driven E-Commerce Platform

## Scoring Target: 90-100 points (Exceptional)

| Deliverable | Points | Status |
|---|---|---|
| 4 Microservices Repo | 25 | 🔲 |
| Event Bus Documentation | 25 | 🔲 |
| Distributed Tracing Setup | 25 | 🔲 |
| Service Dependency Map | 25 | 🔲 |

## 3-Hour Sprint Phases

| Phase | Task | Time |
|---|---|---|
| 1 | Infrastructure (Docker Compose + Kafka + Jaeger) | 30 min |
| 2 | Event Schema Registry | 15 min |
| 3 | 4 Microservice Implementations | 90 min |
| 4 | OpenTelemetry Instrumentation | 15 min |
| 5 | 3 Documentation Deliverables | 30 min |

## What would you like to do?

1. **Start from scratch** — full guided implementation from Phase 1
2. **Resume** — assess current state and jump to the right phase
3. **Jump to phase** — go directly to a specific phase
4. **Generate docs only** — skip to Phase 5 (documentation deliverables)
5. **Score check** — evaluate current implementation against rubric
    </output>

    <ask>Choose an option [1-5]:</ask>

    <check if="user chooses '1'">
      <goto step="2">Phase 1: Infrastructure</goto>
    </check>
    <check if="user chooses '2'">
      <goto step="2">Assess and resume</goto>
    </check>
    <check if="user chooses '3'">
      <ask>Which phase? [1=Infrastructure, 2=Schemas, 3=Services, 4=OTel, 5=Docs]</ask>
    </check>
    <check if="user chooses '4'">
      <goto step="6">Phase 5: Documentation</goto>
    </check>
    <check if="user chooses '5'">
      <goto step="8">Score check</goto>
    </check>
  </step>

  <step n="2" goal="Phase 1 — Infrastructure: Docker Compose + Kafka + Jaeger">
    <action>Create directory: {project-root}/microservices/</action>

    <output>## Phase 1: Infrastructure Setup

Building the full docker-compose.yml with:
- Zookeeper + Kafka (Confluent 7.4.0)
- Kafka topic initialization (8 topics + 4 DLQ topics)
- Jaeger all-in-one (tracing UI + collector)
- OpenTelemetry Collector
- Placeholder entries for all 4 services
    </output>

    <action>Generate {project-root}/microservices/docker-compose.yml with:
      Services:
        - zookeeper: confluentinc/cp-zookeeper:7.4.0, port 2181
        - kafka: confluentinc/cp-kafka:7.4.0, ports 9092:9092, KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://kafka:9092
        - kafka-init: confluentinc/cp-kafka:7.4.0, depends_on kafka, creates 12 topics:
            order-events, inventory-events, payment-events, notification-events
            order-events.dlq, inventory-events.dlq, payment-events.dlq, notification-events.dlq
        - jaeger: jaegertracing/all-in-one:latest, ports 6831:6831/udp, 16686:16686
        - order-service: build ./order-service, port 8001:8000, env KAFKA_BOOTSTRAP_SERVERS=kafka:9092, JAEGER_HOST=jaeger
        - inventory-service: build ./inventory-service, port 8002:8000
        - payment-service: build ./payment-service, port 8003:8000
        - notification-service: build ./notification-service, port 8004:8000
      Networks: ecommerce-network (all services)
      Health checks: all services GET /health
    </action>

    <action>Verify docker-compose.yml is syntactically valid by reviewing it</action>

    <output>✅ Phase 1 Complete — docker-compose.yml created

**Next:** Phase 2 — Event Schema Registry
    </output>

    <check if="user confirms or continues">
      <goto step="3">Phase 2: Event Schemas</goto>
    </check>
  </step>

  <step n="3" goal="Phase 2 — Event Schema Registry">
    <output>## Phase 2: Event Schema Registry

Defining all 10 event types as versioned JSON schemas.
These schemas are the contracts between all services.
    </output>

    <action>Create {project-root}/microservices/schemas/events.json with full schema definitions for all events:
      Base envelope: eventId (uuid), eventType (string enum), timestamp (ISO8601), version ("1.0"), correlationId (uuid), payload (object)

      OrderCreated payload: orderId, customerId, items [{productId, quantity, price}], totalAmount, status
      OrderCancelled payload: orderId, customerId, reason, status
      OrderConfirmed payload: orderId, customerId, totalAmount, estimatedDelivery, status

      StockReserved payload: orderId, productId, quantity, reservationId, warehouseId
      StockReleased payload: orderId, productId, quantity, reservationId, reason
      OutOfStock payload: orderId, productId, requestedQuantity, availableQuantity

      PaymentCompleted payload: orderId, paymentId, customerId, amount, currency, method, transactionRef
      PaymentFailed payload: orderId, paymentId, customerId, amount, failureReason, retryable
      RefundCompleted payload: orderId, paymentId, refundId, amount, currency

      NotificationSent payload: orderId, customerId, notificationType, channel, messageId, subject
    </action>

    <action>Create {project-root}/microservices/schemas/README.md documenting all event types with examples</action>

    <output>✅ Phase 2 Complete — 10 event schemas defined

**Kafka Topics:**
| Topic | Producer | Consumers |
|---|---|---|
| order-events | order-service | inventory-service, notification-service |
| inventory-events | inventory-service | order-service, notification-service |
| payment-events | payment-service | order-service, notification-service |
| notification-events | notification-service | (terminal) |

**Next:** Phase 3 — Service Implementation
    </output>

    <check if="user confirms or continues">
      <goto step="4">Phase 3: Services</goto>
    </check>
  </step>

  <step n="4" goal="Phase 3 — Implement all 4 microservices">
    <output>## Phase 3: Microservice Implementation

Building all 4 services with FastAPI + kafka-python + OpenTelemetry.
Each service follows this structure:

    {service}/
    ├── main.py          # FastAPI app + HTTP endpoints
    ├── models.py        # Pydantic request/response models
    ├── events.py        # Kafka producer (publish_event)
    ├── consumer.py      # Kafka consumer (event handlers)
    ├── tracing.py       # OpenTelemetry setup
    ├── requirements.txt
    └── Dockerfile
    </output>

    <action>Create shared tracing module pattern (tracing.py) to be used by all services:
      - TracerProvider with JaegerExporter
      - get_tracer(service_name) function
      - inject_trace_context(headers) for Kafka publish
      - extract_trace_context(headers) for Kafka consume
      - Uses env vars: JAEGER_HOST (default: localhost), JAEGER_PORT (default: 6831), SERVICE_NAME
    </action>

    <action>Implement microservices/order-service/ with:
      main.py:
        - POST /orders: validate, create order in memory, publish OrderCreated, return 201
        - GET /orders/{id}: return order with current status
        - POST /orders/{id}/cancel: publish OrderCancelled, return 200
        - GET /health: return {"status": "ok"}
      consumer.py:
        - consume inventory-events: StockReserved → update order, OutOfStock → cancel
        - consume payment-events: PaymentCompleted → confirm order publish OrderConfirmed, PaymentFailed → cancel
        - Idempotency check on every handler
      events.py: publish_event(topic, event_type, payload, correlation_id)
      models.py: CreateOrderRequest, OrderResponse, OrderItem
      Dockerfile: FROM python:3.11-slim, COPY + pip install + CMD uvicorn
    </action>

    <action>Implement microservices/inventory-service/ with:
      main.py:
        - GET /inventory/{productId}: return stock level
        - POST /inventory/reserve: internal endpoint (called by consumer, not HTTP)
        - POST /inventory/release: internal endpoint
        - GET /health
      consumer.py:
        - consume order-events: OrderCreated → attempt reserve → publish StockReserved or OutOfStock
        - consume payment-events: PaymentFailed → ReleaseStock → publish StockReleased
        - consume order-events: OrderCancelled → release if reserved
        - Idempotency check
      In-memory inventory: {"PROD-001": 100, "PROD-002": 50, "PROD-003": 25}
    </action>

    <action>Implement microservices/payment-service/ with:
      main.py:
        - POST /payments: internal — process payment, simulate 90% success rate
        - POST /payments/{id}/refund: internal — issue refund
        - GET /health
      consumer.py:
        - consume inventory-events: StockReserved → process payment → publish PaymentCompleted or PaymentFailed
        - consume order-events: OrderCancelled (if payment exists) → refund → publish RefundCompleted
        - Idempotency check
      Simulate payment: random.random() > 0.1 = success (configurable via env PAYMENT_FAILURE_RATE)
    </action>

    <action>Implement microservices/notification-service/ with:
      main.py:
        - GET /health
      consumer.py:
        - consume order-events: OrderCreated, OrderConfirmed, OrderCancelled → log + publish NotificationSent
        - consume payment-events: PaymentCompleted, PaymentFailed → log notification
        - Idempotency check
      Notification: log to stdout (simulates email/SMS — log format: [NOTIFY] type=X orderId=Y customerId=Z)
    </action>

    <action>Create microservices/README.md with:
      - Architecture overview
      - Prerequisites (Docker, docker-compose)
      - Quick start: docker compose up --build
      - Service endpoints table
      - Environment variables table
      - Saga flow description
    </action>

    <output>✅ Phase 3 Complete — All 4 services implemented

**Services:**
- order-service → http://localhost:8001
- inventory-service → http://localhost:8002
- payment-service → http://localhost:8003
- notification-service → http://localhost:8004
- Jaeger UI → http://localhost:16686

**Next:** Phase 4 — OpenTelemetry Instrumentation
    </output>

    <check if="user confirms or continues">
      <goto step="5">Phase 4: OTel</goto>
    </check>
  </step>

  <step n="5" goal="Phase 4 — OpenTelemetry instrumentation across all services">
    <output>## Phase 4: OpenTelemetry Instrumentation

Adding end-to-end distributed tracing to all services.
    </output>

    <action>Verify each service has tracing.py with:
      1. TracerProvider → BatchSpanProcessor → JaegerExporter
      2. FastAPIInstrumentor().instrument_app(app) in main.py
      3. Custom spans in consumer.py for each business operation
      4. Span attributes: order.id, customer.id, event.type, service.name
      5. Trace context injected into Kafka headers on publish (W3C TraceContext)
      6. Trace context extracted from Kafka headers on consume
    </action>

    <action>Add otel-collector service to docker-compose.yml:
      - image: otel/opentelemetry-collector:latest
      - config file: ./otel-collector-config.yaml
    </action>

    <action>Create microservices/otel-collector-config.yaml:
      receivers: otlp (grpc 4317, http 4318)
      exporters: jaeger (endpoint: jaeger:14250), logging
      service pipelines: traces
    </action>

    <output>✅ Phase 4 Complete — Full distributed tracing operational

**Trace flow example:**
POST /orders (order-service, 50ms)
  └── validate-order span (5ms)
  └── publish-event span (10ms)
      └── StockReserved (inventory-service, 30ms)
          └── reserve-stock span (15ms)
          └── publish-event span (5ms)
              └── PaymentCompleted (payment-service, 200ms)
                  └── process-payment span (180ms)
                      └── NotificationSent (notification-service, 100ms)

**Next:** Phase 5 — Documentation Deliverables
    </output>

    <check if="user confirms or continues">
      <goto step="6">Phase 5: Docs</goto>
    </check>
  </step>

  <step n="6" goal="Phase 5 — Generate all 3 documentation deliverables">
    <output>## Phase 5: Documentation Deliverables (3 files)

Generating submission-ready markdown files.
    </output>

    <action>READ step file: ./steps/step-05a-eventbus.md and follow it completely</action>
    <action>READ step file: ./steps/step-05b-tracing.md and follow it completely</action>
    <action>READ step file: ./steps/step-05c-dependencies.md and follow it completely</action>

    <output>✅ Phase 5 Complete — All 3 documentation deliverables generated

**Files created:**
- _bmad-output/{challenge_name}-eventbus.md
- _bmad-output/{challenge_name}-tracing.md
- _bmad-output/{challenge_name}-dependencies.md

**Next:** Final scoring check
    </output>

    <goto step="8">Score check</goto>
  </step>

  <step n="7" goal="Quick start — generate documentation deliverables only">
    <action>Check if microservices/ directory exists with services</action>
    <action>Read existing code to extract event schemas, service structure, Kafka config</action>
    <action>READ step file: ./steps/step-05a-eventbus.md</action>
    <action>READ step file: ./steps/step-05b-tracing.md</action>
    <action>READ step file: ./steps/step-05c-dependencies.md</action>
    <goto step="8">Score check</goto>
  </step>

  <step n="8" goal="Final scoring check and submission prep">
    <action>Scan all deliverables against the scoring rubric</action>

    <output>## Final Scoring Assessment

### Deliverable 1: Microservices (25 pts)
| Criterion | Max | Est | Notes |
|---|---|---|---|
| Service isolation | 5 | | Each service independently deployable? |
| Event schema design | 5 | | Schemas versioned + documented? |
| Error handling | 5 | | DLQ, idempotency, retries? |
| Code organization | 5 | | Clean structure per service? |
| Docker setup | 5 | | docker compose up works? |

### Deliverable 2: Event Bus (25 pts)
| Criterion | Max | Est | Notes |
|---|---|---|---|
| Schema design | 5 | | All 10 events documented? |
| Persistence strategy | 5 | | Retention + replay covered? |
| Delivery guarantees | 5 | | at-least-once + acks=all? |
| Dead letter handling | 5 | | DLQ topics + handlers? |
| Documentation | 5 | | Complete markdown? |

### Deliverable 3: Tracing (25 pts)
| Criterion | Max | Est | Notes |
|---|---|---|---|
| Tracing setup | 5 | | OTel + Jaeger running? |
| Context propagation | 5 | | Across Kafka headers? |
| Visualization | 5 | | Jaeger UI shows full traces? |
| Custom instrumentation | 5 | | Custom spans per service? |
| Documentation | 5 | | Complete markdown? |

### Deliverable 4: Dependencies (25 pts)
| Criterion | Max | Est | Notes |
|---|---|---|---|
| Diagram clarity | 5 | | Mermaid diagrams present? |
| Saga documentation | 5 | | Happy + compensation paths? |
| Failure scenarios | 5 | | All 4 service failures covered? |
| Runbook | 5 | | Operational procedures? |
| Communication matrix | 5 | | Sync vs async table? |
    </output>

    <action>For each criterion, check if the project satisfies it and assign an estimated score</action>
    <action>Identify the top 3 gaps (highest point impact to fix)</action>

    <output>## Submission Checklist

**Repository:**
- [ ] microservices/order-service/ — complete with Dockerfile
- [ ] microservices/inventory-service/ — complete with Dockerfile
- [ ] microservices/payment-service/ — complete with Dockerfile
- [ ] microservices/notification-service/ — complete with Dockerfile
- [ ] microservices/docker-compose.yml — full stack
- [ ] microservices/README.md — setup + architecture

**Documentation:**
- [ ] _bmad-output/{name}-month2-eventbus.md
- [ ] _bmad-output/{name}-month2-tracing.md
- [ ] _bmad-output/{name}-month2-dependencies.md

**Quality Gates:**
- [ ] docker compose up --build succeeds
- [ ] POST /orders triggers full saga end-to-end
- [ ] Jaeger UI shows full distributed trace
- [ ] DLQ topics created in Kafka
- [ ] All services have /health endpoint

**To submit:**
1. Zip microservices/ → {name}-month2-microservices.zip
2. Copy 3 markdown files from _bmad-output/
3. Submit all 4 items
    </output>
  </step>

</workflow>
