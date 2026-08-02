const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES } = require('../config/constants');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email address'],
    },
    phone: { type: String, trim: true, maxlength: 20 },
    password: { type: String, required: true, select: false, minlength: 6 },
    role: {
      type: String,
      enum: Object.values(ROLES),
      default: ROLES.CITIZEN,
      index: true,
    },
    avatarUrl: { type: String },
    // Officials are scoped to the ward/municipality they are responsible for.
    ward: { type: String, trim: true },
    city: { type: String, trim: true },
    department: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function comparePassword(plain) {
  return bcrypt.compare(plain, this.password);
};

userSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    phone: this.phone,
    role: this.role,
    avatarUrl: this.avatarUrl,
    ward: this.ward,
    city: this.city,
    department: this.department,
    isActive: this.isActive,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('User', userSchema);
