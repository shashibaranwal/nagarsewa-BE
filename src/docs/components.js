const {
  ROLES,
  REPORT_STATUSES,
  REPORT_CATEGORIES,
  NOTIFICATION_TYPES,
} = require('../config/constants');

const objectId = { type: 'string', pattern: '^[0-9a-fA-F]{24}$', example: '66d1f4a2b8c1a4e2f0a91c33' };

// Every handler answers with { success, message, data } - `envelope` wraps a
// data schema in that shape so each operation can declare its real payload.
function envelope(dataSchema, extra = {}) {
  return {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      message: { type: 'string', example: 'Success' },
      data: dataSchema,
      ...extra,
    },
  };
}

// Paginated lists put the items in `data` and the page info in `meta`.
function paginatedEnvelope(itemSchema, metaExtra = {}) {
  return {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      message: { type: 'string', example: 'Success' },
      data: { type: 'array', items: itemSchema },
      meta: {
        type: 'object',
        properties: {
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 10 },
          total: { type: 'integer', example: 42 },
          totalPages: { type: 'integer', example: 5 },
          hasNextPage: { type: 'boolean', example: true },
          ...metaExtra,
        },
      },
    },
  };
}

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

const schemas = {
  ObjectId: objectId,

  Error: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: false },
      message: { type: 'string', example: 'Report not found' },
      errors: {
        type: 'array',
        description: 'Present on validation failures.',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string', example: 'title' },
            message: { type: 'string', example: 'String must contain at least 5 character(s)' },
          },
        },
      },
    },
  },

  AuthorSummary: {
    type: 'object',
    description: 'Populated author reference (name, avatar, role, ward, city).',
    properties: {
      _id: objectId,
      name: { type: 'string', example: 'Asha Verma' },
      avatarUrl: { type: 'string', nullable: true, example: 'https://cdn.example.com/a.jpg' },
      role: { type: 'string', enum: Object.values(ROLES) },
      ward: { type: 'string', nullable: true, example: 'Ward 12' },
      city: { type: 'string', nullable: true, example: 'Indore' },
    },
  },

  User: {
    type: 'object',
    properties: {
      id: objectId,
      name: { type: 'string', example: 'Asha Verma' },
      email: { type: 'string', format: 'email', example: 'asha@example.com' },
      phone: { type: 'string', nullable: true, example: '9876543210' },
      role: { type: 'string', enum: Object.values(ROLES), example: ROLES.CITIZEN },
      avatarUrl: { type: 'string', nullable: true },
      ward: { type: 'string', nullable: true, example: 'Ward 12' },
      city: { type: 'string', nullable: true, example: 'Indore' },
      department: { type: 'string', nullable: true, example: 'Sanitation' },
      isActive: { type: 'boolean', example: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },

  AuthPayload: {
    type: 'object',
    properties: {
      user: ref('User'),
      token: { type: 'string', description: 'JWT bearer token.', example: 'eyJhbGciOiJIUzI1NiIs...' },
    },
  },

  ReportImage: {
    type: 'object',
    description: 'Hosted on ImageKit; the API never serves report images itself.',
    properties: {
      url: {
        type: 'string',
        description: 'Absolute CDN URL. ImageKit transformations can be appended as query params.',
        example: 'https://ik.imagekit.io/demo/nagar-sewa/reports/1725-ab12.jpg',
      },
      thumbnailUrl: {
        type: 'string',
        nullable: true,
        example: 'https://ik.imagekit.io/demo/tr:n-ik_ml_thumbnail/nagar-sewa/reports/1725-ab12.jpg',
      },
      filename: { type: 'string', example: '1725-ab12.jpg' },
      fileId: {
        type: 'string',
        nullable: true,
        description: 'ImageKit file id.',
        example: '66d1f4a2b8c1a4e2f0a91c99',
      },
      filePath: {
        type: 'string',
        nullable: true,
        example: '/nagar-sewa/reports/1725-ab12.jpg',
      },
      mimeType: { type: 'string', example: 'image/jpeg' },
      size: { type: 'integer', description: 'Bytes.', example: 483920 },
    },
  },

  ReportLocation: {
    type: 'object',
    properties: {
      address: { type: 'string', example: 'MG Road, near bus stop' },
      ward: { type: 'string', nullable: true, example: 'Ward 12' },
      city: { type: 'string', nullable: true, example: 'Indore' },
      coordinates: {
        type: 'object',
        nullable: true,
        description: 'GeoJSON point. Only present when the reporter sent lat/lng.',
        properties: {
          type: { type: 'string', enum: ['Point'] },
          coordinates: {
            type: 'array',
            description: '[longitude, latitude]',
            items: { type: 'number' },
            example: [75.8577, 22.7196],
          },
        },
      },
    },
  },

  StatusHistoryEntry: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: REPORT_STATUSES },
      changedBy: ref('AuthorSummary'),
      note: { type: 'string', nullable: true, example: 'Crew assigned' },
      changedAt: { type: 'string', format: 'date-time' },
    },
  },

  Report: {
    type: 'object',
    properties: {
      _id: objectId,
      title: { type: 'string', example: 'Large pothole on MG Road' },
      description: { type: 'string', example: 'A deep pothole has been widening for two weeks.' },
      category: { type: 'string', enum: REPORT_CATEGORIES, example: 'pothole' },
      image: ref('ReportImage'),
      location: ref('ReportLocation'),
      reportedBy: ref('AuthorSummary'),
      status: { type: 'string', enum: REPORT_STATUSES, example: 'untouched' },
      statusHistory: { type: 'array', items: ref('StatusHistoryEntry') },
      assignedTo: { allOf: [ref('AuthorSummary')], nullable: true },
      resolvedAt: { type: 'string', format: 'date-time', nullable: true },
      upvoteCount: { type: 'integer', example: 12 },
      downvoteCount: { type: 'integer', example: 1 },
      score: { type: 'integer', example: 11 },
      commentCount: { type: 'integer', example: 4 },
      repostCount: { type: 'integer', example: 2 },
      isDeleted: { type: 'boolean', example: false },
      myVote: {
        type: 'integer',
        enum: [-1, 0, 1],
        description: "The viewer's own vote; 0 when they have not voted or are anonymous.",
      },
      hasReposted: { type: 'boolean', description: 'Whether the viewer has reposted this report.' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },

  ReportStats: {
    type: 'object',
    properties: {
      total: { type: 'integer', example: 128 },
      byStatus: {
        type: 'object',
        additionalProperties: { type: 'integer' },
        example: { untouched: 40, read: 30, working: 38, completed: 20 },
      },
      byCategory: {
        type: 'object',
        additionalProperties: { type: 'integer' },
        example: { pothole: 52, garbage: 41, other: 35 },
      },
      resolutionRate: {
        type: 'number',
        description: 'completed / total, rounded to 3 decimals.',
        example: 0.156,
      },
    },
  },

  Comment: {
    type: 'object',
    properties: {
      _id: objectId,
      report: objectId,
      author: ref('AuthorSummary'),
      body: { type: 'string', example: 'This has damaged two scooters already.' },
      parent: { allOf: [objectId], nullable: true, description: 'Null for top-level comments.' },
      replyCount: { type: 'integer', example: 3 },
      upvoteCount: { type: 'integer', example: 5 },
      downvoteCount: { type: 'integer', example: 0 },
      score: { type: 'integer', example: 5 },
      isDeleted: { type: 'boolean', example: false },
      myVote: { type: 'integer', enum: [-1, 0, 1] },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },

  VoteResult: {
    type: 'object',
    properties: {
      targetType: { type: 'string', enum: ['Report', 'Comment'] },
      targetId: objectId,
      myVote: {
        type: 'integer',
        enum: [-1, 0, 1],
        description: 'Resulting vote. 0 means the vote was toggled off.',
      },
      upvoteCount: { type: 'integer', example: 13 },
      downvoteCount: { type: 'integer', example: 1 },
      score: { type: 'integer', example: 12 },
      isNewVote: { type: 'boolean', example: true },
      previousVote: { type: 'integer', enum: [-1, 0, 1], example: 0 },
    },
  },

  Repost: {
    type: 'object',
    properties: {
      _id: objectId,
      report: objectId,
      user: objectId,
      caption: { type: 'string', nullable: true, example: 'Still not fixed!' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },

  Reposter: {
    type: 'object',
    properties: {
      _id: objectId,
      report: objectId,
      user: ref('AuthorSummary'),
      caption: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },

  RepostTimelineItem: {
    type: 'object',
    description: 'A repost with the full underlying report, as rendered on a profile timeline.',
    properties: {
      _id: objectId,
      user: ref('AuthorSummary'),
      caption: { type: 'string', nullable: true },
      report: ref('Report'),
      createdAt: { type: 'string', format: 'date-time' },
    },
  },

  Notification: {
    type: 'object',
    properties: {
      _id: objectId,
      recipient: objectId,
      actor: { allOf: [ref('AuthorSummary')], nullable: true },
      type: { type: 'string', enum: Object.values(NOTIFICATION_TYPES) },
      report: {
        type: 'object',
        nullable: true,
        description: 'Populated with title, status, image and location.',
        properties: {
          _id: objectId,
          title: { type: 'string' },
          status: { type: 'string', enum: REPORT_STATUSES },
          image: ref('ReportImage'),
          location: ref('ReportLocation'),
        },
      },
      comment: { allOf: [objectId], nullable: true },
      message: { type: 'string', example: 'Asha Verma upvoted "Large pothole on MG Road"' },
      isRead: { type: 'boolean', example: false },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },

  Meta: {
    type: 'object',
    properties: {
      statuses: { type: 'array', items: { type: 'string' }, example: REPORT_STATUSES },
      categories: { type: 'array', items: { type: 'string' }, example: REPORT_CATEGORIES },
      roles: { type: 'array', items: { type: 'string' }, example: Object.values(ROLES) },
    },
  },
};

const parameters = {
  PageParam: {
    in: 'query',
    name: 'page',
    schema: { type: 'integer', minimum: 1, default: 1 },
    description: '1-based page number.',
  },
  LimitParam: {
    in: 'query',
    name: 'limit',
    schema: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
    description: 'Items per page.',
  },
  ReportIdParam: {
    in: 'path',
    name: 'id',
    required: true,
    schema: objectId,
    description: 'Report id.',
  },
  CommentIdParam: {
    in: 'path',
    name: 'commentId',
    required: true,
    schema: objectId,
    description: 'Comment id.',
  },
  UserIdParam: {
    in: 'path',
    name: 'id',
    required: true,
    schema: objectId,
    description: 'User id.',
  },
};

function errorResponse(description, example) {
  return {
    description,
    content: {
      'application/json': {
        schema: ref('Error'),
        example: { success: false, message: example },
      },
    },
  };
}

const responses = {
  BadRequest: errorResponse('Malformed request.', 'An image of the problem is required'),
  ValidationError: {
    description: 'Request body or query failed validation.',
    content: {
      'application/json': {
        schema: ref('Error'),
        example: {
          success: false,
          message: 'Validation failed',
          errors: [{ field: 'title', message: 'String must contain at least 5 character(s)' }],
        },
      },
    },
  },
  Unauthorized: errorResponse('Missing or invalid bearer token.', 'Authentication required'),
  Forbidden: errorResponse('Authenticated but not allowed.', 'You can only edit your own reports'),
  NotFound: errorResponse('Resource does not exist.', 'Report not found'),
  Conflict: errorResponse('Conflicts with existing state.', 'Email is already registered'),
  TooManyRequests: errorResponse('Rate limit exceeded.', 'Too many requests, please try again later'),
};

module.exports = {
  schemas,
  parameters,
  responses,
  securitySchemes: {
    bearerAuth: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'Paste the token returned by `/api/auth/login` or `/api/auth/register`.',
    },
  },
  envelope,
  paginatedEnvelope,
  ref,
  objectId,
};
