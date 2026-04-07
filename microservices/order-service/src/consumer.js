const amqp = require('amqplib')
const api = require('@opentelemetry/api')
const Order = require('./models')
const { publishEvent } = require('./producer')

const EXCHANGE     = 'ecommerce-events'
const DLQ_EXCHANGE = 'ecommerce-events.dlq'
const QUEUE        = 'order-service-queue'
const DLQ_QUEUE    = 'order-service-queue.dlq'

// Idempotency guard
const processedEvents = new Set()

async function handleStockReserved(payload, correlationId) {
  const order = await Order.findOne({ orderId: payload.orderId })
  if (!order) return
  order.status = 'STOCK_RESERVED'
  await order.save()
  console.log(`[Consumer] Order ${payload.orderId} stock reserved`)
}

async function handleOutOfStock(payload, correlationId) {
  const order = await Order.findOne({ orderId: payload.orderId })
  if (!order) return
  order.status = 'CANCELLED'
  await order.save()
  await publishEvent(EXCHANGE, 'OrderCancelled', {
    orderId: order.orderId, customerId: order.customerId,
    reason: 'OutOfStock', status: 'CANCELLED',
  }, correlationId)
  console.log(`[Consumer] Order ${payload.orderId} cancelled — out of stock`)
}

async function handlePaymentCompleted(payload, correlationId) {
  const order = await Order.findOne({ orderId: payload.orderId })
  if (!order) return
  order.status = 'CONFIRMED'
  await order.save()
  await publishEvent(EXCHANGE, 'OrderConfirmed', {
    orderId: order.orderId, customerId: order.customerId,
    totalAmount: order.totalAmount,
    estimatedDelivery: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    status: 'CONFIRMED',
  }, correlationId)
  console.log(`[Consumer] Order ${payload.orderId} confirmed`)
}

async function handlePaymentFailed(payload, correlationId) {
  const order = await Order.findOne({ orderId: payload.orderId })
  if (!order) return
  order.status = 'CANCELLED'
  await order.save()
  await publishEvent(EXCHANGE, 'OrderCancelled', {
    orderId: order.orderId, customerId: order.customerId,
    reason: 'PaymentFailed', status: 'CANCELLED',
  }, correlationId)
  console.log(`[Consumer] Order ${payload.orderId} cancelled — payment failed`)
}

async function startConsumer() {
  const connection = await amqp.connect(process.env.RABBITMQ_URL)
  const channel    = await connection.createChannel()

  // Main exchange
  await channel.assertExchange(EXCHANGE, 'topic', { durable: true })

  // Dead Letter Queue setup
  await channel.assertExchange(DLQ_EXCHANGE, 'topic', { durable: true })
  await channel.assertQueue(DLQ_QUEUE, { durable: true })
  await channel.bindQueue(DLQ_QUEUE, DLQ_EXCHANGE, '#')

  // Main queue with DLQ routing on nack
  await channel.assertQueue(QUEUE, {
    durable: true,
    arguments: { 'x-dead-letter-exchange': DLQ_EXCHANGE },
  })

  // Bind to events this service cares about
  await channel.bindQueue(QUEUE, EXCHANGE, 'StockReserved')
  await channel.bindQueue(QUEUE, EXCHANGE, 'OutOfStock')
  await channel.bindQueue(QUEUE, EXCHANGE, 'PaymentCompleted')
  await channel.bindQueue(QUEUE, EXCHANGE, 'PaymentFailed')

  channel.prefetch(1)

  channel.consume(QUEUE, async (msg) => {
    if (!msg) return
    const event = JSON.parse(msg.content.toString())
    const { eventId, eventType, payload, correlationId } = event

    // Idempotency check
    if (processedEvents.has(eventId)) {
      console.log(`[Consumer] Duplicate skipped: ${eventId}`)
      channel.ack(msg)
      return
    }
    processedEvents.add(eventId)
    console.log(`[Consumer] Received ${eventType}`)

    // Extract trace context from message headers to continue the distributed trace
    const parentContext = api.propagation.extract(api.ROOT_CONTEXT, msg.properties.headers || {})
    const tracer = api.trace.getTracer(process.env.SERVICE_NAME || 'order-service')

    await api.context.with(parentContext, async () => {
      const span = tracer.startSpan(`process ${eventType}`, { kind: api.SpanKind.CONSUMER })
      await api.context.with(api.trace.setSpan(api.context.active(), span), async () => {
        span.setAttribute('messaging.event_type', eventType)
        span.setAttribute('messaging.correlation_id', correlationId)
        try {
          switch (eventType) {
            case 'StockReserved':    await handleStockReserved(payload, correlationId);    break
            case 'OutOfStock':       await handleOutOfStock(payload, correlationId);       break
            case 'PaymentCompleted': await handlePaymentCompleted(payload, correlationId); break
            case 'PaymentFailed':    await handlePaymentFailed(payload, correlationId);    break
            default: console.log(`[Consumer] Unhandled: ${eventType}`)
          }
          channel.ack(msg)
          span.setStatus({ code: api.SpanStatusCode.OK })
        } catch (err) {
          console.error(`[Consumer] Error processing ${eventType}:`, err.message)
          span.recordException(err)
          span.setStatus({ code: api.SpanStatusCode.ERROR, message: err.message })
          channel.nack(msg, false, false) // routes to DLQ
        } finally {
          span.end()
        }
      })
    })
  })

  console.log(`[Consumer] order-service listening on queue: ${QUEUE}`)
}

module.exports = { startConsumer }
