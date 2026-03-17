const mongoose = require('mongoose')

const paymentSchema = new mongoose.Schema({
  paymentId:    { type: String, required: true, unique: true },
  orderId:      { type: String, required: true },
  customerId:   { type: String, required: true },
  amount:       { type: Number, required: true },
  currency:     { type: String, default: 'USD' },
  status:       { type: String, enum: ['COMPLETED', 'FAILED', 'REFUNDED'], required: true },
  failureReason:{ type: String },
  transactionRef:{ type: String },
  createdAt:    { type: Date, default: Date.now },
})

module.exports = mongoose.model('Payment', paymentSchema)
