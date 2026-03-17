const mongoose = require('mongoose')

const orderItemSchema = new mongoose.Schema({
  productId: { type: String, required: true },
  quantity:  { type: Number, required: true },
  price:     { type: Number, required: true },
})

const orderSchema = new mongoose.Schema({
  orderId:       { type: String, required: true, unique: true },
  customerId:    { type: String, required: true },
  items:         [orderItemSchema],
  totalAmount:   { type: Number, required: true },
  status: {
    type: String,
    enum: ['PENDING', 'STOCK_RESERVED', 'CONFIRMED', 'CANCELLED'],
    default: 'PENDING',
  },
  correlationId: { type: String, required: true },
  createdAt:     { type: Date, default: Date.now },
  updatedAt:     { type: Date, default: Date.now },
})

orderSchema.pre('save', function (next) {
  this.updatedAt = new Date()
  next()
})

module.exports = mongoose.model('Order', orderSchema)
