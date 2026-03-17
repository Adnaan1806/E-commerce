const amqp = require('amqplib')
const Order = require('./models')
const { publishEvent } = require('./producer')

const EXCHANGE = 'ecommerce-events'
const QUEUE    = 'order-service-queue'

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

  await channel.assertExchange(EXCHANGE, 'topic', { durable: true })
  await channel.assertQueue(QUEUE, { durable: true })

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

    try {
      switch (eventType) {
        case 'StockReserved':    await handleStockReserved(payload, correlationId);    break
        case 'OutOfStock':       await handleOutOfStock(payload, correlationId);       break
        case 'PaymentCompleted': await handlePaymentCompleted(payload, correlationId); break
        case 'PaymentFailed':    await handlePaymentFailed(payload, correlationId);    break
        default: console.log(`[Consumer] Unhandled: ${eventType}`)
      }
      channel.ack(msg)
    } catch (err) {
      console.error(`[Consumer] Error processing ${eventType}:`, err.message)
      channel.nack(msg, false, false) // send to dead letter
    }
  })

  console.log(`[Consumer] order-service listening on queue: ${QUEUE}`)
}

module.exports = { startConsumer }
