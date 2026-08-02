// Thin indirection over the realtime transport. Socket.IO is optional: if the
// package is not installed the app still works and these calls become no-ops.
let io = null;

function initRealtime(httpServer) {
  let Server;
  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    ({ Server } = require('socket.io'));
  } catch (err) {
    console.warn('socket.io not installed - realtime notifications disabled');
    return null;
  }

  const env = require('../config/env');
  const { verifyToken } = require('../utils/jwt');

  io = new Server(httpServer, {
    cors: { origin: env.corsOrigin === '*' ? '*' : env.corsOrigin.split(',') },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('Authentication token required'));
    try {
      const payload = verifyToken(token);
      socket.userId = payload.sub;
      socket.role = payload.role;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.userId}`);
    if (socket.role === 'official' || socket.role === 'admin') socket.join('officials');
  });

  return io;
}

function emitToUser(userId, event, payload) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, payload);
}

function emitToOfficials(event, payload) {
  if (!io) return;
  io.to('officials').emit(event, payload);
}

module.exports = { initRealtime, emitToUser, emitToOfficials };
