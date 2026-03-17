const mongoose = require('mongoose')

const notificationSchema = new mongoose.Schema({
  messageId:        { type: String, required: true, unique: true },
  orderId:          { type: String, required: true },
  customerId:       { type: String, required: true },
  notificationType: { type: String, required: true },
  channel:          { type: String, default: 'EMAIL' },
  subject:          { type: String, required: true },
  body:             { type: String, required: true },
  sentAt:           { type: Date, default: Date.now },
})

module.exports = mongoose.model('Notification', notificationSchema)
