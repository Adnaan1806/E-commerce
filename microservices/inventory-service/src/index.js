require('dotenv').config()
require('./tracing')

const express   = require('express')
const mongoose  = require('mongoose')
const { Stock } = require('./models')
const { connectProducer } = require('./producer')
const { startConsumer }   = require('./consumer')

const app  = express()
const PORT = process.env.PORT || 8000

app.use(express.json())

// ─── Health Check ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'inventory-service' })
})

// ─── GET /inventory/:productId ────────────────────────────────
app.get('/inventory/:productId', async (req, res) => {
  try {
    const stock = await Stock.findOne({ productId: req.params.productId })
    if (!stock) return res.status(404).json({ error: 'Product not found' })

    res.json({
      productId:   stock.productId,
      productName: stock.productName,
      available:   stock.quantity - stock.reserved,
      reserved:    stock.reserved,
      total:       stock.quantity,
    })
  } catch (err) {
    console.error('[GET /inventory/:productId]', err.message)
    res.status(500).json({ error: 'Failed to fetch inventory' })
  }
})

// ─── POST /inventory/reserve ──────────────────────────────────
app.post('/inventory/reserve', async (req, res) => {
  try {
    const { productId, quantity, orderId } = req.body
    if (!productId || !quantity || !orderId)
      return res.status(400).json({ error: 'productId, quantity and orderId are required' })

    const stock = await Stock.findOne({ productId })
    if (!stock) return res.status(404).json({ error: 'Product not found' })

    const available = stock.quantity - stock.reserved
    if (available < quantity)
      return res.status(409).json({ error: 'Insufficient stock', available })

    stock.reserved += quantity
    await stock.save()

    res.json({ productId, reserved: quantity, available: stock.quantity - stock.reserved })
  } catch (err) {
    res.status(500).json({ error: 'Failed to reserve stock' })
  }
})

// ─── POST /inventory/release ──────────────────────────────────
app.post('/inventory/release', async (req, res) => {
  try {
    const { productId, quantity } = req.body
    if (!productId || !quantity)
      return res.status(400).json({ error: 'productId and quantity are required' })

    const stock = await Stock.findOne({ productId })
    if (!stock) return res.status(404).json({ error: 'Product not found' })

    stock.reserved = Math.max(0, stock.reserved - quantity)
    await stock.save()

    res.json({ productId, released: quantity, available: stock.quantity - stock.reserved })
  } catch (err) {
    res.status(500).json({ error: 'Failed to release stock' })
  }
})

// ─── POST /inventory/seed ─────────────────────────────────────
app.post('/inventory/seed', async (_req, res) => {
  await Stock.deleteMany({})
  await Stock.insertMany([
    { productId: 'PROD-001', productName: 'Laptop',      quantity: 50 },
    { productId: 'PROD-002', productName: 'Headphones',  quantity: 100 },
    { productId: 'PROD-003', productName: 'Mouse',       quantity: 200 },
    { productId: 'PROD-004', productName: 'Keyboard',    quantity: 150 },
  ])
  res.json({ message: 'Stock seeded' })
})

// ─── Seed initial stock ───────────────────────────────────────
async function seedStock() {
  const count = await Stock.countDocuments()
  if (count > 0) return

  await Stock.insertMany([
    { productId: 'PROD-001', productName: 'Laptop',     quantity: 50 },
    { productId: 'PROD-002', productName: 'Headphones',  quantity: 100 },
    { productId: 'PROD-003', productName: 'Mouse',       quantity: 200 },
    { productId: 'PROD-004', productName: 'Keyboard',    quantity: 150 },
  ])
  console.log('[DB] Seeded initial stock')
}

// ─── Startup ──────────────────────────────────────────────────
async function start() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/inventory_db')
    console.log('[DB] Connected to MongoDB (inventory_db)')

    await seedStock()
    await connectProducer()
    await startConsumer()

    app.listen(PORT, () => {
      console.log(`[Server] inventory-service running on port ${PORT}`)
    })
  } catch (err) {
    console.error('[Startup] Failed:', err.message)
    process.exit(1)
  }
}

start()
