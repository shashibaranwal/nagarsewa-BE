const ApiError = require('../utils/ApiError');

// Validates a request segment against a zod schema and replaces it with the
// parsed (coerced, defaulted) result.
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || source,
        message: issue.message,
      }));
      return next(ApiError.badRequest('Validation failed', details));
    }
    if (source === 'query') req.validatedQuery = result.data;
    else req[source] = result.data;
    next();
  };
}

module.exports = { validate };
