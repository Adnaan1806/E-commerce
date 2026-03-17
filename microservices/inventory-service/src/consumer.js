const amqp = require('amqplib')
const { v4: uuidv4 } = require('uuid')
const { Stock, Reservation } = require('./models')
const { publishEvent } = require('./producer')

const EXCHANGE = 'ecommerce-events'
const QUEUE    = 'inventory-service-queue'

const processedEvents = new Set()

async function handleOrderCreated(payload, correlationId) {
  const { orderId, items } = payload
  const item  = items[0]
  const stock = await Stock.findOne({ productId: item.productId })
  const available = stock ? stock.quantity - stock.reserved : 0

  if (!stock || available < item.quantity) {
    await publishEvent(EXCHANGE, 'OutOfStock', {
      orderId, productId: item.productId,
      requestedQuantity: item.quantity, availableQuantity: available,
    }, correlationId)
    console.log(`[Consumer] Out of stock for order ${orderId}`)
    return
  }

  const reservationId = uuidv4()
  stock.reserved += item.quantity
  await stock.save()

  await Reservation.create({ reservationId, orderId, productId: item.productId, quantity: item.quantity, status: 'ACTIVE' })

  await publishEvent(EXCHANGE, 'StockReserved', {
    orderId, productId: item.productId,
    quantity: item.quantity, reservationId, warehouseId: 'WH-001',
  }, correlationId)
  console.log(`[Consumer] Stock reserved for order ${orderId}`)
}

async function releaseStock(orderId, correlationId, reason) {
  const reservation = await Reservation.findOne({ orderId, status: 'ACTIVE' })
  if (!reservation) return

  const stock = await Stock.findOne({ productId: reservation.productId })
  if (stock) {
    stock.reserved = Math.max(0, stock.reserved - reservation.quantity)
    await stock.save()
  }
  reservation.status = 'RELEASED'
  await reservation.save()

  await publishEvent(EXCHANGE, 'StockReleased', {
    orderId, productId: reservation.productId,
    quantity: reservation.quantity, reservationId: reservation.reservationId, reason,
  }, correlationId)
  console.log(`[Consumer] Stock released for order ${orderId}`)
}

async function startConsumer() {
  const connection = await amqp.connect(process.env.RABBITMQ_URL)
  const channel    = await connection.createChannel()

  await channel.assertExchange(EXCHANGE, 'topic', { durable: true })
  await channel.assertQueue(QUEUE, { durable: true })

  await channel.bindQueue(QUEUE, EXCHANGE, 'OrderCreated')
  await channel.bindQueue(QUEUE, EXCHANGE, 'OrderCancelled')
  await channel.bindQueue(QUEUE, EXCHANGE, 'PaymentFailed')

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
      switch (eventType) {
        case 'OrderCreated':   await handleOrderCreated(payload, correlationId); break
        case 'OrderCancelled': await releaseStock(payload.orderId, correlationId, 'OrderCancelled'); break
        case 'PaymentFailed':  await releaseStock(payload.orderId, correlationId, 'PaymentFailed');  break
        default: console.log(`[Consumer] Unhandled: ${eventType}`)
      }
      channel.ack(msg)
    } catch (err) {
      console.error(`[Consumer] Error:`, err.message)
      channel.nack(msg, false, false)
    }
  })

  console.log(`[Consumer] inventory-service listening on queue: ${QUEUE}`)
}

module.exports = { startConsumer }
