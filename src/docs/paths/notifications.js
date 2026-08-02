const { envelope, paginatedEnvelope, ref, objectId } = require('../components');

const param = (name) => ({ $ref: `#/components/parameters/${name}` });
const response = (name) => ({ $ref: `#/components/responses/${name}` });

const notificationIdParam = {
  in: 'path',
  name: 'id',
  required: true,
  schema: objectId,
  description: 'Notification id.',
};

module.exports = {
  '/notifications': {
    get: {
      tags: ['Notifications'],
      summary: 'List your notifications',
      description: 'The `meta` block carries an extra `unreadCount` alongside the usual pagination fields.',
      parameters: [
        param('PageParam'),
        param('LimitParam'),
        {
          in: 'query',
          name: 'unreadOnly',
          schema: { type: 'string', enum: ['true', 'false'], default: 'false' },
        },
      ],
      responses: {
        200: {
          description: 'A page of notifications, newest first.',
          content: {
            'application/json': {
              schema: paginatedEnvelope(ref('Notification'), {
                unreadCount: { type: 'integer', example: 3 },
              }),
            },
          },
        },
        400: response('ValidationError'),
        401: response('Unauthorized'),
      },
    },
  },

  '/notifications/unread-count': {
    get: {
      tags: ['Notifications'],
      summary: 'Get your unread notification count',
      responses: {
        200: {
          description: 'The unread count.',
          content: {
            'application/json': {
              schema: envelope({
                type: 'object',
                properties: { unreadCount: { type: 'integer', example: 3 } },
              }),
            },
          },
        },
        401: response('Unauthorized'),
      },
    },
  },

  '/notifications/read-all': {
    patch: {
      tags: ['Notifications'],
      summary: 'Mark every notification as read',
      responses: {
        200: {
          description: 'How many notifications were updated.',
          content: {
            'application/json': {
              schema: envelope({
                type: 'object',
                properties: { updated: { type: 'integer', example: 3 } },
              }),
            },
          },
        },
        401: response('Unauthorized'),
      },
    },
  },

  '/notifications/{id}/read': {
    patch: {
      tags: ['Notifications'],
      summary: 'Mark one notification as read',
      parameters: [notificationIdParam],
      responses: {
        200: {
          description: 'The updated notification.',
          content: { 'application/json': { schema: envelope(ref('Notification')) } },
        },
        401: response('Unauthorized'),
        404: response('NotFound'),
      },
    },
  },

  '/notifications/{id}': {
    delete: {
      tags: ['Notifications'],
      summary: 'Delete a notification',
      parameters: [notificationIdParam],
      responses: {
        200: {
          description: 'Notification deleted.',
          content: {
            'application/json': {
              schema: envelope({ nullable: true }),
              example: { success: true, message: 'Notification deleted', data: null },
            },
          },
        },
        401: response('Unauthorized'),
        404: response('NotFound'),
      },
    },
  },
};
