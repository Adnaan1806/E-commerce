const amqp = require('amqplib')
const api = require('@opentelemetry/api')
const { v4: uuidv4 } = require('uuid')
const Notification = require('./models')
const { publishEvent } = require('./producer')

const EXCHANGE     = 'ecommerce-events'
const DLQ_EXCHANGE = 'ecommerce-events.dlq'
const QUEUE        = 'notification-service-queue'
const DLQ_QUEUE    = 'notification-service-queue.dlq'

const processedEvents = new Set()

const TEMPLATES = {
  OrderCreated:     { type: 'ORDER_RECEIVED',   subject: 'We received your order!',         body: (p) => `Your order ${p.orderId} is being processed. Total: $${p.totalAmount}` },
  OrderConfirmed:   { type: 'ORDER_CONFIRMED',   subject: 'Your order is confirmed!',         body: (p) => `Order ${p.orderId} confirmed. Estimated delivery: ${p.estimatedDelivery}` },
  OrderCancelled:   { type: 'ORDER_CANCELLED',   subject: 'Your order has been cancelled',    body: (p) => `Order ${p.orderId} cancelled. Reason: ${p.reason}` },
  PaymentCompleted: { type: 'PAYMENT_SUCCESS',   subject: 'Payment successful',               body: (p) => `Payment of $${p.amount} for order ${p.orderId} successful. Ref: ${p.transactionRef}` },
  PaymentFailed:    { type: 'PAYMENT_FAILED',    subject: 'Payment failed',                   body: (p) => `Payment for order ${p.orderId} failed: ${p.failureReason}` },
  RefundCompleted:  { type: 'REFUND_ISSUED',     subject: 'Refund issued',                    body: (p) => `Refund of $${p.amount} for order ${p.orderId} issued. Ref: ${p.refundId}` },
}

async function sendNotification(eventType, payload, correlationId) {
  const template = TEMPLATES[eventType]
  if (!template) return

  const messageId  = uuidv4()
  const customerId = payload.customerId || 'unknown'
  const subject    = template.subject
  const body       = template.body(payload)

  console.log(`[NOTIFY] type=${template.type} orderId=${payload.orderId} customerId=${customerId}`)
  console.log(`[NOTIFY] subject="${subject}"`)
  console.log(`[NOTIFY] body="${body}"`)

  await Notification.create({
    messageId, orderId: payload.orderId, customerId,
    notificationType: template.type, channel: 'EMAIL', subject, body,
  })

  await publishEvent(EXCHANGE, 'NotificationSent', {
    orderId: payload.orderId, customerId,
    notificationType: template.type, channel: 'EMAIL', messageId, subject,
  }, correlationId)
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

  // Listen to all order and payment events
  await channel.bindQueue(QUEUE, EXCHANGE, 'OrderCreated')
  await channel.bindQueue(QUEUE, EXCHANGE, 'OrderConfirmed')
  await channel.bindQueue(QUEUE, EXCHANGE, 'OrderCancelled')
  await channel.bindQueue(QUEUE, EXCHANGE, 'PaymentCompleted')
  await channel.bindQueue(QUEUE, EXCHANGE, 'PaymentFailed')
  await channel.bindQueue(QUEUE, EXCHANGE, 'RefundCompleted')

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
    const tracer = api.trace.getTracer(process.env.SERVICE_NAME || 'notification-service')

    await api.context.with(parentContext, async () => {
      const span = tracer.startSpan(`process ${eventType}`, { kind: api.SpanKind.CONSUMER })
      await api.context.with(api.trace.setSpan(api.context.active(), span), async () => {
        span.setAttribute('messaging.event_type', eventType)
        span.setAttribute('messaging.correlation_id', correlationId)
        try {
          await sendNotification(eventType, payload, correlationId)
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

  console.log(`[Consumer] notification-service listening on queue: ${QUEUE}`)
}

module.exports = { startConsumer }
