require('dotenv').config()
// Tracing must be initialized before anything else
require('./tracing')

const express = require('express')
const mongoose = require('mongoose')
const { v4: uuidv4 } = require('uuid')
const Order = require('./models')
const { connectProducer, publishEvent } = require('./producer')
const { startConsumer } = require('./consumer')

const app  = express()
const PORT = process.env.PORT || 8000

app.use(express.json())

// ─── Health Check ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'order-service' })
})

// ─── POST /orders ─────────────────────────────────────────────
app.post('/orders', async (req, res) => {
  try {
    const { customerId, items } = req.body

    if (!customerId || !items || items.length === 0) {
      return res.status(400).json({ error: 'customerId and items are required' })
    }

    const totalAmount = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
    const orderId     = uuidv4()
    const correlationId = uuidv4()

    const order = await Order.create({
      orderId,
      customerId,
      items,
      totalAmount,
      correlationId,
      status: 'PENDING',
    })

    await publishEvent('ecommerce-events', 'OrderCreated', {
      orderId,
      customerId,
      items,
      totalAmount,
      status: 'PENDING',
    }, correlationId)

    res.status(201).json({
      orderId:     order.orderId,
      status:      order.status,
      totalAmount: order.totalAmount,
      createdAt:   order.createdAt,
    })
  } catch (err) {
    console.error('[POST /orders]', err.message)
    res.status(500).json({ error: 'Failed to create order' })
  }
})

// ─── GET /orders/:id ──────────────────────────────────────────
app.get('/orders/:id', async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.id })
    if (!order) return res.status(404).json({ error: 'Order not found' })

    res.json({
      orderId:     order.orderId,
      customerId:  order.customerId,
      items:       order.items,
      totalAmount: order.totalAmount,
      status:      order.status,
      createdAt:   order.createdAt,
      updatedAt:   order.updatedAt,
    })
  } catch (err) {
    console.error('[GET /orders/:id]', err.message)
    res.status(500).json({ error: 'Failed to fetch order' })
  }
})

// ─── POST /orders/:id/cancel ──────────────────────────────────
app.post('/orders/:id/cancel', async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.id })
    if (!order) return res.status(404).json({ error: 'Order not found' })

    if (order.status === 'CONFIRMED') {
      return res.status(400).json({ error: 'Cannot cancel a confirmed order' })
    }

    order.status = 'CANCELLED'
    await order.save()

    await publishEvent('ecommerce-events', 'OrderCancelled', {
      orderId:    order.orderId,
      customerId: order.customerId,
      reason:     'CustomerCancelled',
      status:     'CANCELLED',
    }, order.correlationId)

    res.json({ orderId: order.orderId, status: order.status })
  } catch (err) {
    console.error('[POST /orders/:id/cancel]', err.message)
    res.status(500).json({ error: 'Failed to cancel order' })
  }
})

// ─── Startup ──────────────────────────────────────────────────
async function start() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/orders_db')
    console.log('[DB] Connected to MongoDB (orders_db)')

    await connectProducer()
    await startConsumer()

    app.listen(PORT, () => {
      console.log(`[Server] order-service running on port ${PORT}`)
    })
  } catch (err) {
    console.error('[Startup] Failed:', err.message)
    process.exit(1)
  }
}

start()
