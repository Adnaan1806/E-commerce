require('dotenv').config()
require('./tracing')

const express  = require('express')
const mongoose = require('mongoose')
const Payment  = require('./models')
const { connectProducer } = require('./producer')
const { startConsumer }   = require('./consumer')

const app  = express()
const PORT = process.env.PORT || 8000

app.use(express.json())

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'payment-service' })
})

// GET /payments/:orderId — check payment status for an order
app.get('/payments/:orderId', async (req, res) => {
  try {
    const payment = await Payment.findOne({ orderId: req.params.orderId })
    if (!payment) return res.status(404).json({ error: 'Payment not found' })
    res.json(payment)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch payment' })
  }
})

// POST /payments — process a payment (internal)
app.post('/payments', async (req, res) => {
  try {
    const { orderId, customerId, amount } = req.body
    if (!orderId || !customerId || !amount)
      return res.status(400).json({ error: 'orderId, customerId and amount are required' })

    const existing = await Payment.findOne({ orderId, status: 'COMPLETED' })
    if (existing) return res.status(409).json({ error: 'Payment already completed', payment: existing })

    const { v4: uuidv4 } = require('uuid')
    const payment = await Payment.create({
      paymentId: uuidv4(), orderId, customerId, amount,
      status: 'COMPLETED', transactionRef: `TXN-${Date.now()}`,
    })
    res.status(201).json(payment)
  } catch (err) {
    res.status(500).json({ error: 'Failed to process payment' })
  }
})

// POST /payments/:id/refund — refund a payment (internal)
app.post('/payments/:id/refund', async (req, res) => {
  try {
    const payment = await Payment.findOne({ paymentId: req.params.id })
    if (!payment) return res.status(404).json({ error: 'Payment not found' })
    if (payment.status !== 'COMPLETED')
      return res.status(409).json({ error: `Cannot refund payment with status ${payment.status}` })

    payment.status = 'REFUNDED'
    await payment.save()
    res.json({ message: 'Refund successful', payment })
  } catch (err) {
    res.status(500).json({ error: 'Failed to process refund' })
  }
})

async function start() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/payments_db')
    console.log('[DB] Connected to MongoDB (payments_db)')

    await connectProducer()
    await startConsumer()

    app.listen(PORT, () => {
      console.log(`[Server] payment-service running on port ${PORT}`)
    })
  } catch (err) {
    console.error('[Startup] Failed:', err.message)
    process.exit(1)
  }
}

start()
