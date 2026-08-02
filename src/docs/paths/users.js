const { ROLES } = require('../../config/constants');
const { envelope, paginatedEnvelope, ref, objectId } = require('../components');

const param = (name) => ({ $ref: `#/components/parameters/${name}` });
const response = (name) => ({ $ref: `#/components/responses/${name}` });

const userResponse = (description) => ({
  description,
  content: {
    'application/json': {
      schema: envelope({ type: 'object', properties: { user: ref('User') } }),
    },
  },
});

module.exports = {
  '/users': {
    get: {
      tags: ['Users'],
      summary: 'List users',
      description: 'Admins only.',
      parameters: [
        param('PageParam'),
        param('LimitParam'),
        { in: 'query', name: 'role', schema: { type: 'string', enum: Object.values(ROLES) } },
        {
          in: 'query',
          name: 'search',
          schema: { type: 'string', maxLength: 80 },
          description: 'Substring match on name or email.',
        },
      ],
      responses: {
        200: {
          description: 'A page of users.',
          content: { 'application/json': { schema: paginatedEnvelope(ref('User')) } },
        },
        400: response('ValidationError'),
        401: response('Unauthorized'),
        403: response('Forbidden'),
      },
    },
  },

  '/users/officials': {
    post: {
      tags: ['Users'],
      summary: 'Create an official or admin account',
      description: 'Admins only.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['name', 'email', 'password'],
              properties: {
                name: { type: 'string', minLength: 2, maxLength: 80, example: 'Ravi Kumar' },
                email: { type: 'string', format: 'email', example: 'ravi@nagar.gov.in' },
                password: { type: 'string', minLength: 6, maxLength: 128, example: 'secret123' },
                phone: { type: 'string', maxLength: 20 },
                ward: { type: 'string', maxLength: 80, example: 'Ward 12' },
                city: { type: 'string', maxLength: 80, example: 'Indore' },
                role: {
                  type: 'string',
                  enum: [ROLES.OFFICIAL, ROLES.ADMIN],
                  default: ROLES.OFFICIAL,
                },
                department: { type: 'string', maxLength: 120, example: 'Sanitation' },
              },
            },
          },
        },
      },
      responses: {
        201: userResponse('Account created.'),
        400: response('ValidationError'),
        401: response('Unauthorized'),
        403: response('Forbidden'),
        409: response('Conflict'),
      },
    },
  },

  '/users/{id}/role': {
    patch: {
      tags: ['Users'],
      summary: "Change a user's role or posting",
      description: 'Admins only. An admin cannot change their own role.',
      parameters: [param('UserIdParam')],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['role'],
              properties: {
                role: { type: 'string', enum: Object.values(ROLES), example: ROLES.OFFICIAL },
                department: { type: 'string', maxLength: 120, example: 'Sanitation' },
                ward: { type: 'string', maxLength: 80 },
                city: { type: 'string', maxLength: 80 },
              },
            },
          },
        },
      },
      responses: {
        200: userResponse('User updated.'),
        400: response('BadRequest'),
        401: response('Unauthorized'),
        403: response('Forbidden'),
        404: response('NotFound'),
      },
    },
  },

  '/users/{id}/toggle-active': {
    patch: {
      tags: ['Users'],
      summary: 'Activate or deactivate a user',
      description: 'Admins only. An admin cannot deactivate their own account.',
      parameters: [param('UserIdParam')],
      responses: {
        200: userResponse('Account activated or deactivated.'),
        400: response('BadRequest'),
        401: response('Unauthorized'),
        403: response('Forbidden'),
        404: response('NotFound'),
      },
    },
  },

  '/users/{id}': {
    get: {
      tags: ['Users'],
      summary: 'Get a public profile',
      security: [],
      parameters: [param('UserIdParam')],
      responses: {
        200: {
          description: 'The profile with its activity counts.',
          content: {
            'application/json': {
              schema: envelope({
                type: 'object',
                properties: {
                  user: ref('User'),
                  stats: {
                    type: 'object',
                    properties: {
                      reportCount: { type: 'integer', example: 7 },
                      commentCount: { type: 'integer', example: 21 },
                      repostCount: { type: 'integer', example: 3 },
                      resolvedCount: { type: 'integer', example: 2 },
                    },
                  },
                },
              }),
            },
          },
        },
        404: response('NotFound'),
      },
    },
  },

  '/users/{userId}/reposts': {
    get: {
      tags: ['Reposts'],
      summary: "List a user's reposts",
      description: 'Each item embeds the full underlying report, as rendered on a profile timeline.',
      security: [],
      parameters: [
        { in: 'path', name: 'userId', required: true, schema: objectId, description: 'User id.' },
        param('PageParam'),
        param('LimitParam'),
      ],
      responses: {
        200: {
          description: 'A page of reposts.',
          content: { 'application/json': { schema: paginatedEnvelope(ref('RepostTimelineItem')) } },
        },
        400: response('ValidationError'),
      },
    },
  },
};
