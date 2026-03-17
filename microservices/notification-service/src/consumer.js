const amqp = require('amqplib')
const { v4: uuidv4 } = require('uuid')
const Notification = require('./models')
const { publishEvent } = require('./producer')

const EXCHANGE = 'ecommerce-events'
const QUEUE    = 'notification-service-queue'

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

  await channel.assertExchange(EXCHANGE, 'topic', { durable: true })
  await channel.assertQueue(QUEUE, { durable: true })

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

    try {
      await sendNotification(eventType, payload, correlationId)
      channel.ack(msg)
    } catch (err) {
      console.error(`[Consumer] Error:`, err.message)
      channel.nack(msg, false, false)
    }
  })

  console.log(`[Consumer] notification-service listening on queue: ${QUEUE}`)
}

module.exports = { startConsumer }
