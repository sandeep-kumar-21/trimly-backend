export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  mongodbUri: process.env.MONGODB_URI,
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  corsOrigin: process.env.CORS_ORIGIN || '*',
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  shortUrlBase: process.env.SHORT_URL_BASE || 'http://localhost:4000',
  workerEnabled: process.env.WORKER_ENABLED === 'true' || process.env.WORKER_ENABLED === undefined,
});
