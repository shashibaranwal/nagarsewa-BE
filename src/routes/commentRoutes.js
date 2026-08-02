const express = require('express');
const commentController = require('../controllers/commentController');
const voteController = require('../controllers/voteController');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { updateCommentSchema, voteSchema, paginationSchema } = require('../validators/schemas');

const router = express.Router();

router.get(
  '/:commentId/replies',
  optionalAuth,
  validate(paginationSchema, 'query'),
  commentController.listReplies
);
router.patch(
  '/:commentId',
  requireAuth,
  validate(updateCommentSchema),
  commentController.updateComment
);
router.delete('/:commentId', requireAuth, commentController.deleteComment);
router.post('/:commentId/vote', requireAuth, validate(voteSchema), voteController.voteComment);

module.exports = router;
