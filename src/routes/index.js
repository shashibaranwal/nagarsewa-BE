const express = require('express');
const { REPORT_STATUSES, REPORT_CATEGORIES, ROLES } = require('../config/constants');

const router = express.Router();

router.use('/auth', require('./authRoutes'));
router.use('/reports', require('./reportRoutes'));
router.use('/comments', require('./commentRoutes'));
router.use('/notifications', require('./notificationRoutes'));
router.use('/users', require('./userRoutes'));

// Lets the client populate dropdowns without hardcoding enums.
router.get('/meta', (req, res) =>
  res.json({
    success: true,
    data: {
      statuses: REPORT_STATUSES,
      categories: REPORT_CATEGORIES,
      roles: Object.values(ROLES),
    },
  })
);

module.exports = router;
