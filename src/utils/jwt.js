const jwt = require('jsonwebtoken');
const env = require('../config/env');

function signToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
}

function verifyToken(token) {
  return jwt.verify(token, env.jwtSecret);
}

module.exports = { signToken, verifyToken };
