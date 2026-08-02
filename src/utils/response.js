function ok(res, data, message = 'Success', statusCode = 200) {
  return res.status(statusCode).json({ success: true, message, data });
}

function created(res, data, message = 'Created') {
  return ok(res, data, message, 201);
}

function paginated(res, items, { page, limit, total }, message = 'Success') {
  return res.status(200).json({
    success: true,
    message,
    data: items,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasNextPage: page * limit < total,
    },
  });
}

module.exports = { ok, created, paginated };
