import * as Joi from 'joi';

export const validationSchema = Joi.object({
  PORT: Joi.number().default(3000),
  MONGODB_URI: Joi.string().required(),
  REDIS_PROVIDER: Joi.string().valid('local', 'upstash').default('local'),
  REDIS_URL: Joi.string().optional().allow(''),
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  JWT_SECRET: Joi.string().required(),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  CORS_ORIGIN: Joi.string().default('*'),
  BASE_URL: Joi.string().default('http://localhost:3000'),
  FRONTEND_URL: Joi.string().uri().default('http://localhost:3000'),
  SHORT_URL_BASE: Joi.string().uri().required(),
  WORKER_ENABLED: Joi.boolean().default(true),
});
