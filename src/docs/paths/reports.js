const { REPORT_STATUSES, REPORT_CATEGORIES } = require('../../config/constants');
const { envelope, paginatedEnvelope, ref } = require('../components');

const param = (name) => ({ $ref: `#/components/parameters/${name}` });
const response = (name) => ({ $ref: `#/components/responses/${name}` });

const reportResponse = (description) => ({
  description,
  content: { 'application/json': { schema: envelope(ref('Report')) } },
});

const reportListResponse = (description) => ({
  description,
  content: { 'application/json': { schema: paginatedEnvelope(ref('Report')) } },
});

module.exports = {
  '/reports': {
    get: {
      tags: ['Reports'],
      summary: 'List reports (public feed)',
      description:
        'Open to anonymous callers. Send a token to have `myVote` and `hasReposted` filled in. Pass `lat` + `lng` to restrict the feed to a radius.',
      security: [],
      parameters: [
        param('PageParam'),
        param('LimitParam'),
        { in: 'query', name: 'status', schema: { type: 'string', enum: REPORT_STATUSES } },
        { in: 'query', name: 'category', schema: { type: 'string', enum: REPORT_CATEGORIES } },
        { in: 'query', name: 'ward', schema: { type: 'string' }, description: 'Exact match, case-insensitive.' },
        { in: 'query', name: 'city', schema: { type: 'string' }, description: 'Exact match, case-insensitive.' },
        { in: 'query', name: 'reportedBy', schema: ref('ObjectId') },
        {
          in: 'query',
          name: 'search',
          schema: { type: 'string', maxLength: 140 },
          description: 'Full-text search over title, description and address.',
        },
        {
          in: 'query',
          name: 'sort',
          schema: { type: 'string', enum: ['recent', 'oldest', 'top', 'discussed'], default: 'recent' },
        },
        { in: 'query', name: 'lat', schema: { type: 'number', minimum: -90, maximum: 90 } },
        { in: 'query', name: 'lng', schema: { type: 'number', minimum: -180, maximum: 180 } },
        {
          in: 'query',
          name: 'radius',
          schema: { type: 'number', minimum: 1, maximum: 50000, default: 2000 },
          description: 'Radius in metres; only applied together with lat and lng.',
        },
      ],
      responses: {
        200: reportListResponse('A page of reports.'),
        400: response('ValidationError'),
      },
    },

    post: {
      tags: ['Reports'],
      summary: 'Submit a report',
      description:
        'Multipart form. Exactly one image is required under the `image` field (JPEG, PNG, WEBP or HEIC). The file is uploaded to ImageKit and the report stores the resulting CDN URL. Rate limited per user.',
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['title', 'description', 'address', 'image'],
              properties: {
                image: { type: 'string', format: 'binary', description: 'Photo of the problem.' },
                title: { type: 'string', minLength: 5, maxLength: 140, example: 'Large pothole on MG Road' },
                description: {
                  type: 'string',
                  minLength: 10,
                  maxLength: 3000,
                  example: 'A deep pothole has been widening for two weeks.',
                },
                category: { type: 'string', enum: REPORT_CATEGORIES, default: 'other' },
                address: { type: 'string', minLength: 3, maxLength: 300, example: 'MG Road, near bus stop' },
                ward: { type: 'string', maxLength: 80, example: 'Ward 12' },
                city: { type: 'string', maxLength: 80, example: 'Indore' },
                latitude: { type: 'number', minimum: -90, maximum: 90, example: 22.7196 },
                longitude: { type: 'number', minimum: -180, maximum: 180, example: 75.8577 },
              },
            },
          },
        },
      },
      responses: {
        201: reportResponse('Report created.'),
        400: response('ValidationError'),
        401: response('Unauthorized'),
        429: response('TooManyRequests'),
      },
    },
  },

  '/reports/stats': {
    get: {
      tags: ['Reports'],
      summary: 'Aggregate report counts',
      security: [],
      parameters: [
        { in: 'query', name: 'ward', schema: { type: 'string' } },
        { in: 'query', name: 'city', schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Counts by status and category.',
          content: { 'application/json': { schema: envelope(ref('ReportStats')) } },
        },
      },
    },
  },

  '/reports/mine': {
    get: {
      tags: ['Reports'],
      summary: "List the signed-in user's own reports",
      parameters: [param('PageParam'), param('LimitParam')],
      responses: {
        200: reportListResponse('A page of your reports.'),
        401: response('Unauthorized'),
      },
    },
  },

  '/reports/{id}': {
    get: {
      tags: ['Reports'],
      summary: 'Get a single report',
      security: [],
      parameters: [param('ReportIdParam')],
      responses: {
        200: reportResponse('The report, with status history populated.'),
        404: response('NotFound'),
      },
    },

    patch: {
      tags: ['Reports'],
      summary: 'Edit a report',
      description:
        'The reporter may edit their own report only while it is still `untouched`. Officials and admins may edit any report at any time.',
      parameters: [param('ReportIdParam')],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              minProperties: 1,
              properties: {
                title: { type: 'string', minLength: 5, maxLength: 140 },
                description: { type: 'string', minLength: 10, maxLength: 3000 },
                category: { type: 'string', enum: REPORT_CATEGORIES },
                address: { type: 'string', minLength: 3, maxLength: 300 },
                ward: { type: 'string', maxLength: 80 },
                city: { type: 'string', maxLength: 80 },
              },
            },
          },
        },
      },
      responses: {
        200: reportResponse('Report updated.'),
        400: response('ValidationError'),
        401: response('Unauthorized'),
        403: response('Forbidden'),
        404: response('NotFound'),
      },
    },

    delete: {
      tags: ['Reports'],
      summary: 'Delete a report',
      description: 'Soft delete. Allowed for the reporter or an admin.',
      parameters: [param('ReportIdParam')],
      responses: {
        200: {
          description: 'Report deleted.',
          content: {
            'application/json': {
              schema: envelope({ nullable: true }),
              example: { success: true, message: 'Report deleted', data: null },
            },
          },
        },
        401: response('Unauthorized'),
        403: response('Forbidden'),
        404: response('NotFound'),
      },
    },
  },

  '/reports/{id}/status': {
    patch: {
      tags: ['Reports'],
      summary: 'Move a report through its lifecycle',
      description: 'Officials and admins only. Appends an entry to `statusHistory` and notifies the reporter.',
      parameters: [param('ReportIdParam')],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['status'],
              properties: {
                status: { type: 'string', enum: REPORT_STATUSES, example: 'working' },
                note: { type: 'string', maxLength: 500, example: 'Repair crew scheduled for Monday' },
                assignedTo: ref('ObjectId'),
              },
            },
          },
        },
      },
      responses: {
        200: reportResponse('Status updated.'),
        400: response('BadRequest'),
        401: response('Unauthorized'),
        403: response('Forbidden'),
        404: response('NotFound'),
      },
    },
  },

  '/reports/{id}/comments': {
    get: {
      tags: ['Comments'],
      summary: 'List top-level comments on a report',
      description: 'Replies are fetched separately via `/comments/{commentId}/replies`.',
      security: [],
      parameters: [param('ReportIdParam'), param('PageParam'), param('LimitParam')],
      responses: {
        200: {
          description: 'A page of comments, sorted by score.',
          content: { 'application/json': { schema: paginatedEnvelope(ref('Comment')) } },
        },
        400: response('ValidationError'),
      },
    },

    post: {
      tags: ['Comments'],
      summary: 'Comment on a report',
      description: 'Pass `parent` to reply to a top-level comment. Only one level of threading is allowed.',
      parameters: [param('ReportIdParam')],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['body'],
              properties: {
                body: { type: 'string', minLength: 1, maxLength: 1000, example: 'This damaged two scooters already.' },
                parent: ref('ObjectId'),
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: 'Comment created.',
          content: { 'application/json': { schema: envelope(ref('Comment')) } },
        },
        400: response('BadRequest'),
        401: response('Unauthorized'),
        404: response('NotFound'),
      },
    },
  },

  '/reports/{id}/vote': {
    post: {
      tags: ['Votes'],
      summary: 'Upvote or downvote a report',
      description: 'Sending the same value twice removes the vote; sending the opposite value flips it.',
      parameters: [param('ReportIdParam')],
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

  '/reports/{id}/repost': {
    post: {
      tags: ['Reposts'],
      summary: 'Repost a report',
      description: 'A user can repost a given report only once.',
      parameters: [param('ReportIdParam')],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { caption: { type: 'string', maxLength: 500, example: 'Still not fixed!' } },
            },
          },
        },
      },
      responses: {
        201: {
          description: 'Report reposted.',
          content: { 'application/json': { schema: envelope(ref('Repost')) } },
        },
        401: response('Unauthorized'),
        404: response('NotFound'),
        409: response('Conflict'),
      },
    },

    delete: {
      tags: ['Reposts'],
      summary: 'Undo your repost',
      parameters: [param('ReportIdParam')],
      responses: {
        200: {
          description: 'Repost removed.',
          content: {
            'application/json': {
              schema: envelope({ nullable: true }),
              example: { success: true, message: 'Repost removed', data: null },
            },
          },
        },
        401: response('Unauthorized'),
        404: response('NotFound'),
      },
    },
  },

  '/reports/{id}/reposts': {
    get: {
      tags: ['Reposts'],
      summary: 'List who reposted a report',
      security: [],
      parameters: [param('ReportIdParam'), param('PageParam'), param('LimitParam')],
      responses: {
        200: {
          description: 'A page of reposts.',
          content: { 'application/json': { schema: paginatedEnvelope(ref('Reposter')) } },
        },
        400: response('ValidationError'),
      },
    },
  },
};
