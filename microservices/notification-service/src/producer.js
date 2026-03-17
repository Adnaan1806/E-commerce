const amqp = require('amqplib')
const { v4: uuidv4 } = require('uuid')

const EXCHANGE = 'ecommerce-events'
let channel = null

async function connectProducer() {
  const connection = await amqp.connect(process.env.RABBITMQ_URL)
  channel = await connection.createChannel()
  await channel.assertExchange(EXCHANGE, 'topic', { durable: true })
  console.log('[Producer] Connected to RabbitMQ')
}

async function publishEvent(exchange, eventType, payload, correlationId) {
  if (!channel) await connectProducer()

  const event = {
    eventId:       uuidv4(),
    eventType,
    timestamp:     new Date().toISOString(),
    version:       '1.0',
    correlationId: correlationId || uuidv4(),
    payload,
  }

  channel.publish(
    EXCHANGE,
    eventType,
    Buffer.from(JSON.stringify(event)),
    { persistent: true }
  )

  console.log(`[Producer] Published ${eventType}`)
  return event
}

module.exports = { connectProducer, publishEvent }
