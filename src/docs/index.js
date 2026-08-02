const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const helmet = require('helmet');
const env = require('../config/env');
const { schemas, parameters, responses, securitySchemes } = require('./components');

const paths = {
  ...require('./paths/auth'),
  ...require('./paths/reports'),
  ...require('./paths/comments'),
  ...require('./paths/notifications'),
  ...require('./paths/users'),
  ...require('./paths/meta'),
  // /health lives outside the /api prefix, so it overrides the server URL.
  '/health': {
    get: {
      tags: ['Meta'],
      summary: 'Liveness probe',
      security: [],
      servers: [{ url: env.publicBaseUrl }],
      responses: {
        200: {
          description: 'The service is up.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: true },
                  status: { type: 'string', example: 'ok' },
                  uptime: { type: 'number', example: 1043.21 },
                  env: { type: 'string', example: 'development' },
                },
              },
            },
          },
        },
      },
    },
  },
};

const definition = {
  openapi: '3.0.3',
  info: {
    title: 'Nagar Sewa API',
    version: require('../../package.json').version,
    description: [
      'REST API for Nagar Sewa, a municipal problem reporting platform.',
      '',
      '**Authentication.** Register or log in, then send the returned JWT as `Authorization: Bearer <token>`.',
      'Click **Authorize** above and paste the raw token - the `Bearer ` prefix is added for you.',
      '',
      '**Response shape.** Every endpoint answers with `{ success, message, data }`.',
      'List endpoints add a `meta` block with `page`, `limit`, `total`, `totalPages` and `hasNextPage`.',
      'Errors answer with `{ success: false, message }` plus an `errors` array when validation failed.',
      '',
      '**Roles.** `citizen` reports and discusses, `official` moves reports through their lifecycle,',
      '`admin` additionally manages accounts.',
    ].join('\n'),
  },
  servers: [
    { url: `${env.publicBaseUrl}/api`, description: 'Current environment' },
    { url: 'http://localhost:5000/api', description: 'Local development' },
  ],
  tags: [
    { name: 'Auth', description: 'Registration, login and the signed-in profile.' },
    { name: 'Reports', description: 'Submitting, browsing and moderating problem reports.' },
    { name: 'Comments', description: 'Threaded discussion on a report (one level of replies).' },
    { name: 'Votes', description: 'Upvotes and downvotes on reports and comments.' },
    { name: 'Reposts', description: 'Sharing a report onto your own timeline.' },
    { name: 'Notifications', description: 'Per-user activity feed.' },
    { name: 'Users', description: 'Public profiles and admin account management.' },
    { name: 'Meta', description: 'Service health and the enums the UI needs.' },
  ],
  // Applied to every operation; endpoints that allow anonymous access set
  // `security: []` to opt out.
  security: [{ bearerAuth: [] }],
  components: { securitySchemes, schemas, parameters, responses },
  paths,
};

// `apis` is empty by design - the spec lives in src/docs - but swagger-jsdoc
// still merges any `@openapi` JSDoc blocks added to route files later.
const spec = swaggerJsdoc({ definition, apis: ['./src/routes/*.js'] });

const uiOptions = {
  customSiteTitle: 'Nagar Sewa API docs',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    docExpansion: 'none',
    filter: true,
    tagsSorter: 'alpha',
  },
};

// Swagger UI ships inline scripts, which helmet's default CSP blocks - so the
// docs route gets its own relaxed helmet and must be mounted before the global
// one in app.js.
function mountDocs(app, route = '/api/docs') {
  const relaxed = helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false });

  app.get(`${route}.json`, relaxed, (req, res) => res.json(spec));
  app.use(route, relaxed, swaggerUi.serve, swaggerUi.setup(spec, uiOptions));
}

module.exports = { spec, mountDocs };
