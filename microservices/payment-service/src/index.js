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
