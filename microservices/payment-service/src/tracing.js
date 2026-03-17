const { NodeSDK } = require('@opentelemetry/sdk-node')
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node')
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http')
const { Resource } = require('@opentelemetry/resources')
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions')

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: process.env.SERVICE_NAME || 'payment-service',
  }),
  traceExporter: new OTLPTraceExporter({
    url: `http://${process.env.JAEGER_HOST || 'localhost'}:4318/v1/traces`,
  }),
  instrumentations: [getNodeAutoInstrumentations()],
})

sdk.start()
process.on('SIGTERM', () => sdk.shutdown())
module.exports = sdk
