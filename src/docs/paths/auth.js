const { envelope, ref } = require('../components');

const jsonBody = (schema) => ({
  required: true,
  content: { 'application/json': { schema } },
});

const authResponse = (description) => ({
  description,
  content: { 'application/json': { schema: envelope(ref('AuthPayload')) } },
});

const userResponse = (description) => ({
  description,
  content: {
    'application/json': {
      schema: envelope({ type: 'object', properties: { user: ref('User') } }),
    },
  },
});

module.exports = {
  '/auth/register': {
    post: {
      tags: ['Auth'],
      summary: 'Register a citizen account',
      description:
        'Public signup always creates a `citizen`. Official and admin accounts are created by an admin via `POST /users/officials`.',
      security: [],
      requestBody: jsonBody({
        type: 'object',
        required: ['name', 'email', 'password'],
        properties: {
          name: { type: 'string', minLength: 2, maxLength: 80, example: 'Asha Verma' },
          email: { type: 'string', format: 'email', example: 'asha@example.com' },
          password: { type: 'string', minLength: 6, maxLength: 128, example: 'secret123' },
          phone: { type: 'string', maxLength: 20, example: '9876543210' },
          ward: { type: 'string', maxLength: 80, example: 'Ward 12' },
          city: { type: 'string', maxLength: 80, example: 'Indore' },
        },
      }),
      responses: {
        201: authResponse('Account created.'),
        400: { $ref: '#/components/responses/ValidationError' },
        409: { $ref: '#/components/responses/Conflict' },
        429: { $ref: '#/components/responses/TooManyRequests' },
      },
    },
  },

  '/auth/login': {
    post: {
      tags: ['Auth'],
      summary: 'Log in and receive a JWT',
      security: [],
      requestBody: jsonBody({
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email', example: 'asha@example.com' },
          password: { type: 'string', example: 'secret123' },
        },
      }),
      responses: {
        200: authResponse('Logged in.'),
        400: { $ref: '#/components/responses/ValidationError' },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        429: { $ref: '#/components/responses/TooManyRequests' },
      },
    },
  },

  '/auth/me': {
    get: {
      tags: ['Auth'],
      summary: 'Get the signed-in user',
      responses: {
        200: userResponse('The current user.'),
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
    patch: {
      tags: ['Auth'],
      summary: 'Update your own profile',
      description: 'At least one field must be sent.',
      requestBody: jsonBody({
        type: 'object',
        minProperties: 1,
        properties: {
          name: { type: 'string', minLength: 2, maxLength: 80 },
          phone: { type: 'string', maxLength: 20 },
          avatarUrl: { type: 'string', format: 'uri' },
          ward: { type: 'string', maxLength: 80 },
          city: { type: 'string', maxLength: 80 },
        },
      }),
      responses: {
        200: userResponse('Profile updated.'),
        400: { $ref: '#/components/responses/ValidationError' },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },

  '/auth/change-password': {
    post: {
      tags: ['Auth'],
      summary: 'Change your password',
      requestBody: jsonBody({
        type: 'object',
        required: ['currentPassword', 'newPassword'],
        properties: {
          currentPassword: { type: 'string', example: 'secret123' },
          newPassword: { type: 'string', minLength: 6, maxLength: 128, example: 'newsecret456' },
        },
      }),
      responses: {
        200: {
          description: 'Password changed.',
          content: {
            'application/json': {
              schema: envelope({ nullable: true }),
              example: { success: true, message: 'Password changed successfully', data: null },
            },
          },
        },
        400: { $ref: '#/components/responses/BadRequest' },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },
};
