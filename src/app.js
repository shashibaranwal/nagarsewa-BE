const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const env = require('./config/env');
const routes = require('./routes');
const { apiLimiter } = require('./middleware/rateLimit');
const { notFound, errorHandler } = require('./middleware/error');
const { uploadRoot } = require('./services/storageService');
const { mountDocs } = require('./docs');

const app = express();

app.set('trust proxy', 1);

// Mounted before the global helmet: Swagger UI needs a relaxed CSP of its own.
mountDocs(app);

// crossOriginResourcePolicy is relaxed so the frontend on another origin can
// display images served from /uploads.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(
  cors({
    origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(',').map((o) => o.trim()),
    credentials: true,
  })
);
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
if (env.nodeEnv !== 'test') app.use(morgan(env.nodeEnv === 'development' ? 'dev' : 'combined'));

app.use(`/${env.uploadDir}`, express.static(uploadRoot, { maxAge: '7d' }));

app.get('/health', (req, res) =>
  res.json({ success: true, status: 'ok', uptime: process.uptime(), env: env.nodeEnv })
);

app.use('/api', apiLimiter, routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
