export class AppError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, message);
  }
}

// A missing/expired/invalid access cookie - the one 401 the SPA answers by
// refreshing the session. Tagged `code: 'session'` (error.middleware.js) so a 401
// that is a real answer ("current password is incorrect", expired passkey
// challenge, ...) is never refreshed and replayed.
export class SessionExpiredError extends UnauthorizedError {
  constructor(message = 'Not authenticated') {
    super(message);
    this.code = 'session';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(404, message);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid request', details) {
    super(400, message, details);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(409, message);
  }
}
