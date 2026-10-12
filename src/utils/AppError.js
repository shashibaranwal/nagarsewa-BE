export class AppError extends Error {
  constructor(status, message, code, details = []) {
    super(message);
    this.status = status;
    if (code) this.code = code;
    this.details = details;
  }
}
