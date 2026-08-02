const { envelope, paginatedEnvelope, ref } = require('../components');

const param = (name) => ({ $ref: `#/components/parameters/${name}` });
const response = (name) => ({ $ref: `#/components/responses/${name}` });

module.exports = {
  '/comments/{commentId}/replies': {
    get: {
      tags: ['Comments'],
      summary: 'List replies to a comment',
      security: [],
      parameters: [param('CommentIdParam'), param('PageParam'), param('LimitParam')],
      responses: {
        200: {
          description: 'A page of replies, oldest first.',
          content: { 'application/json': { schema: paginatedEnvelope(ref('Comment')) } },
        },
        400: response('ValidationError'),
      },
    },
  },

  '/comments/{commentId}': {
    patch: {
      tags: ['Comments'],
      summary: 'Edit your own comment',
      parameters: [param('CommentIdParam')],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['body'],
              properties: { body: { type: 'string', minLength: 1, maxLength: 1000 } },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Comment updated.',
          content: { 'application/json': { schema: envelope(ref('Comment')) } },
        },
        400: response('ValidationError'),
        401: response('Unauthorized'),
        403: response('Forbidden'),
        404: response('NotFound'),
      },
    },

    delete: {
      tags: ['Comments'],
      summary: 'Delete a comment',
      description: 'Soft delete. Allowed for the author, an official or an admin.',
      parameters: [param('CommentIdParam')],
      responses: {
        200: {
          description: 'Comment deleted.',
          content: {
            'application/json': {
              schema: envelope({ nullable: true }),
              example: { success: true, message: 'Comment deleted', data: null },
            },
          },
        },
        401: response('Unauthorized'),
        403: response('Forbidden'),
        404: response('NotFound'),
      },
    },
  },

  '/comments/{commentId}/vote': {
    post: {
      tags: ['Votes'],
      summary: 'Upvote or downvote a comment',
      description: 'Sending the same value twice removes the vote; sending the opposite value flips it.',
      parameters: [param('CommentIdParam')],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['value'],
              properties: { value: { type: 'integer', enum: [1, -1], example: 1 } },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Vote recorded with the refreshed counters.',
          content: { 'application/json': { schema: envelope(ref('VoteResult')) } },
        },
        400: response('ValidationError'),
        401: response('Unauthorized'),
        404: response('NotFound'),
      },
    },
  },
};
