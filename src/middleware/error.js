const multer = require('multer');
const mongoose = require('mongoose');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

function notFound(req, res, next) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';
  let details = err.details;

  if (err instanceof multer.MulterError) {
    statusCode = 400;
    message =
      err.code === 'LIMIT_FILE_SIZE'
        ? `Image is larger than the ${env.maxUploadMb}MB limit`
        : `Upload error: ${err.message}`;
  } else if (err instanceof mongoose.Error.ValidationError) {
    statusCode = 400;
    message = 'Validation failed';
    details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
  } else if (err instanceof mongoose.Error.CastError) {
    statusCode = 400;
    message = `Invalid value for ${err.path}`;
  } else if (err.code === 11000) {
    statusCode = 409;
    message = `Duplicate value for ${Object.keys(err.keyPattern || {}).join(', ')}`;
  }

  if (statusCode >= 500) console.error(err);

  res.status(statusCode).json({
    success: false,
    message,
    ...(details ? { errors: details } : {}),
    ...(env.nodeEnv === 'development' && statusCode >= 500 ? { stack: err.stack } : {}),
  });
}

module.exports = { notFound, errorHandler };
