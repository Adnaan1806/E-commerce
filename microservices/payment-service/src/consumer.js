const amqp = require('amqplib')
const api = require('@opentelemetry/api')
const { v4: uuidv4 } = require('uuid')
const Payment = require('./models')
const { publishEvent } = require('./producer')

const EXCHANGE     = 'ecommerce-events'
const DLQ_EXCHANGE = 'ecommerce-events.dlq'
const QUEUE        = 'payment-service-queue'
const DLQ_QUEUE    = 'payment-service-queue.dlq'

const processedEvents = new Set()

function simulatePayment() {
  const failureRate = parseFloat(process.env.PAYMENT_FAILURE_RATE || '0.1')
  return Math.random() >= failureRate
}

async function handleStockReserved(payload, correlationId) {
  const { orderId } = payload
  const paymentId   = uuidv4()
  const success     = simulatePayment()

  if (success) {
    await Payment.create({
      paymentId, orderId,
      customerId: payload.customerId || 'unknown',
      amount: payload.totalAmount || 0,
      status: 'COMPLETED',
      transactionRef: `TXN-${Date.now()}`,
    })
    await publishEvent(EXCHANGE, 'PaymentCompleted', {
      orderId, paymentId,
      customerId: payload.customerId || 'unknown',
      amount: payload.totalAmount || 0,
      currency: 'USD', method: 'CREDIT_CARD',
      transactionRef: `TXN-${Date.now()}`,
    }, correlationId)
    console.log(`[Consumer] Payment completed for order ${orderId}`)
  } else {
    const reason = ['INSUFFICIENT_FUNDS', 'CARD_DECLINED', 'TIMEOUT'][Math.floor(Math.random() * 3)]
    await Payment.create({
      paymentId, orderId,
      customerId: payload.customerId || 'unknown',
      amount: payload.totalAmount || 0,
      status: 'FAILED', failureReason: reason,
    })
    await publishEvent(EXCHANGE, 'PaymentFailed', {
      orderId, paymentId,
      customerId: payload.customerId || 'unknown',
      amount: payload.totalAmount || 0,
      failureReason: reason, retryable: reason === 'TIMEOUT',
    }, correlationId)
    console.log(`[Consumer] Payment failed for order ${orderId} — ${reason}`)
  }
}

async function handleOrderCancelled(payload, correlationId) {
  const payment = await Payment.findOne({ orderId: payload.orderId, status: 'COMPLETED' })
  if (!payment) return

  payment.status = 'REFUNDED'
  await payment.save()

  await publishEvent(EXCHANGE, 'RefundCompleted', {
    orderId: payload.orderId, paymentId: payment.paymentId,
    refundId: uuidv4(), amount: payment.amount, currency: payment.currency,
  }, correlationId)
  console.log(`[Consumer] Refund issued for order ${payload.orderId}`)
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

  await channel.bindQueue(QUEUE, EXCHANGE, 'StockReserved')
  await channel.bindQueue(QUEUE, EXCHANGE, 'OrderCancelled')

  channel.prefetch(1)

  channel.consume(QUEUE, async (msg) => {
    if (!msg) return
    const event = JSON.parse(msg.content.toString())
    const { eventId, eventType, payload, correlationId } = event

    if (processedEvents.has(eventId)) {
      channel.ack(msg)
      return
    }
    processedEvents.add(eventId)
    console.log(`[Consumer] Received ${eventType}`)

    // Extract trace context from message headers to continue the distributed trace
    const parentContext = api.propagation.extract(api.ROOT_CONTEXT, msg.properties.headers || {})
    const tracer = api.trace.getTracer(process.env.SERVICE_NAME || 'payment-service')

    await api.context.with(parentContext, async () => {
      const span = tracer.startSpan(`process ${eventType}`, { kind: api.SpanKind.CONSUMER })
      await api.context.with(api.trace.setSpan(api.context.active(), span), async () => {
        span.setAttribute('messaging.event_type', eventType)
        span.setAttribute('messaging.correlation_id', correlationId)
        try {
          switch (eventType) {
            case 'StockReserved':  await handleStockReserved(payload, correlationId); break
            case 'OrderCancelled': await handleOrderCancelled(payload, correlationId); break
            default: console.log(`[Consumer] Unhandled: ${eventType}`)
          }
          channel.ack(msg)
          span.setStatus({ code: api.SpanStatusCode.OK })
        } catch (err) {
          console.error(`[Consumer] Error:`, err.message)
          span.recordException(err)
          span.setStatus({ code: api.SpanStatusCode.ERROR, message: err.message })
          channel.nack(msg, false, false)
        } finally {
          span.end()
        }
      })
    })
  })

  console.log(`[Consumer] payment-service listening on queue: ${QUEUE}`)
}

module.exports = { startConsumer }
