require('dotenv').config();

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 5000),
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/nagarsewa',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-insecure-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 5),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || 'http://localhost:5000').replace(/\/$/, ''),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  // Report images go to ImageKit when a private key is present; without one the
  // API falls back to writing them under `uploadDir`.
  imagekit: {
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY || '',
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY || '',
    urlEndpoint: (process.env.IMAGEKIT_URL_ENDPOINT || '').replace(/\/$/, ''),
    folder: process.env.IMAGEKIT_FOLDER || '/nagar-sewa/reports',
  },
};

if (env.nodeEnv === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}

module.exports = env;
