const mongoose = require('mongoose')

// Stock levels per product
const stockSchema = new mongoose.Schema({
  productId:   { type: String, required: true, unique: true },
  productName: { type: String, required: true },
  quantity:    { type: Number, required: true, min: 0 },
  reserved:    { type: Number, default: 0 },   // amount currently reserved
  updatedAt:   { type: Date, default: Date.now },
})

// Tracks each reservation so we can release them correctly
const reservationSchema = new mongoose.Schema({
  reservationId: { type: String, required: true, unique: true },
  orderId:       { type: String, required: true },
  productId:     { type: String, required: true },
  quantity:      { type: Number, required: true },
  status:        { type: String, enum: ['ACTIVE', 'RELEASED'], default: 'ACTIVE' },
  createdAt:     { type: Date, default: Date.now },
})

module.exports = {
  Stock:       mongoose.model('Stock', stockSchema),
  Reservation: mongoose.model('Reservation', reservationSchema),
}
