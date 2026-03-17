require('dotenv').config()
require('./tracing')

const express      = require('express')
const mongoose     = require('mongoose')
const Notification = require('./models')
const { connectProducer } = require('./producer')
const { startConsumer }   = require('./consumer')

const app  = express()
const PORT = process.env.PORT || 8000

app.use(express.json())

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'notification-service' })
})

// GET /notifications/:orderId — view all notifications sent for an order
app.get('/notifications/:orderId', async (req, res) => {
  try {
    const notifications = await Notification.find({ orderId: req.params.orderId }).sort({ sentAt: 1 })
    res.json(notifications)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notifications' })
  }
})

async function start() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/notifications_db')
    console.log('[DB] Connected to MongoDB (notifications_db)')

    await connectProducer()
    await startConsumer()

    app.listen(PORT, () => {
      console.log(`[Server] notification-service running on port ${PORT}`)
    })
  } catch (err) {
    console.error('[Startup] Failed:', err.message)
    process.exit(1)
  }
}

start()
