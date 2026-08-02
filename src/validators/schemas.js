const { z } = require('zod');
const { ROLES, REPORT_STATUSES, REPORT_CATEGORIES } = require('../config/constants');

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(6).max(128),
  phone: z.string().trim().max(20).optional(),
  ward: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

const updateProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    phone: z.string().trim().max(20).optional(),
    avatarUrl: z.string().url().optional(),
    ward: z.string().trim().max(80).optional(),
    city: z.string().trim().max(80).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6).max(128),
});

// Multipart bodies arrive as strings, so coerce the numeric fields.
const createReportSchema = z.object({
  title: z.string().trim().min(5).max(140),
  description: z.string().trim().min(10).max(3000),
  category: z.enum(REPORT_CATEGORIES).default('other'),
  address: z.string().trim().min(3).max(300),
  ward: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
});

const updateReportSchema = z
  .object({
    title: z.string().trim().min(5).max(140).optional(),
    description: z.string().trim().min(10).max(3000).optional(),
    category: z.enum(REPORT_CATEGORIES).optional(),
    address: z.string().trim().min(3).max(300).optional(),
    ward: z.string().trim().max(80).optional(),
    city: z.string().trim().max(80).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

const updateStatusSchema = z.object({
  status: z.enum(REPORT_STATUSES),
  note: z.string().trim().max(500).optional(),
  assignedTo: objectId.optional(),
});

const listReportsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  status: z.enum(REPORT_STATUSES).optional(),
  category: z.enum(REPORT_CATEGORIES).optional(),
  ward: z.string().trim().optional(),
  city: z.string().trim().optional(),
  reportedBy: objectId.optional(),
  search: z.string().trim().max(140).optional(),
  sort: z.enum(['recent', 'oldest', 'top', 'discussed']).default('recent'),
  // Radius search in metres; requires lat + lng.
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radius: z.coerce.number().min(1).max(50000).default(2000),
});

const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(1000),
  parent: objectId.optional(),
});

const updateCommentSchema = z.object({
  body: z.string().trim().min(1).max(1000),
});

const voteSchema = z.object({
  value: z.union([z.literal(1), z.literal(-1), z.literal('1'), z.literal('-1')]).transform(Number),
});

const repostSchema = z.object({
  caption: z.string().trim().max(500).optional(),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const notificationListSchema = paginationSchema.extend({
  unreadOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

const createOfficialSchema = registerSchema.extend({
  role: z.enum([ROLES.OFFICIAL, ROLES.ADMIN]).default(ROLES.OFFICIAL),
  department: z.string().trim().max(120).optional(),
});

const updateUserRoleSchema = z.object({
  role: z.enum(Object.values(ROLES)),
  department: z.string().trim().max(120).optional(),
  ward: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
});

const listUsersSchema = paginationSchema.extend({
  role: z.enum(Object.values(ROLES)).optional(),
  search: z.string().trim().max(80).optional(),
});

const idParamSchema = z.object({ id: objectId });

module.exports = {
  objectId,
  registerSchema,
  loginSchema,
  updateProfileSchema,
  changePasswordSchema,
  createReportSchema,
  updateReportSchema,
  updateStatusSchema,
  listReportsSchema,
  createCommentSchema,
  updateCommentSchema,
  voteSchema,
  repostSchema,
  paginationSchema,
  notificationListSchema,
  createOfficialSchema,
  updateUserRoleSchema,
  listUsersSchema,
  idParamSchema,
};
