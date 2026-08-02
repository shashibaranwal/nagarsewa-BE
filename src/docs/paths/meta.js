const { envelope, ref } = require('../components');

module.exports = {
  '/meta': {
    get: {
      tags: ['Meta'],
      summary: 'Get the enums the UI needs',
      description: 'Report statuses, categories and roles, so the client does not hardcode them.',
      security: [],
      responses: {
        200: {
          description: 'The enum lists.',
          content: { 'application/json': { schema: envelope(ref('Meta')) } },
        },
      },
    },
  },
};
