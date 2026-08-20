/** Transport-agnostic application errors raised by the data access layer. */
export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode: number) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}

/** The requested item does not exist. */
export class NotFoundError extends AppError {
  constructor(message: string) {
    super('NOT_FOUND', message, 404);
  }
}

/** A conditional write failed: the item already exists or was modified concurrently. */
export class ConflictError extends AppError {
  constructor(message: string) {
    super('CONFLICT', message, 409);
  }
}

/** The caller supplied input the repository cannot turn into a valid write. */
export class ValidationError extends AppError {
  constructor(message: string) {
    super('VALIDATION_FAILED', message, 400);
  }
}

export interface FieldIssue {
  path: string;
  message: string;
}

/** Request path/query/body failed Zod validation before reaching a service. */
export class RequestValidationError extends AppError {
  readonly details: FieldIssue[];

  constructor(details: FieldIssue[], message = 'Request validation failed') {
    super('VALIDATION_ERROR', message, 400);
    this.details = details;
  }
}

/** No verified caller identity was present on the request. */
export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super('UNAUTHORIZED', message, 401);
  }
}

/** The caller is authenticated but lacks permission for the action. */
export class ForbiddenError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super('FORBIDDEN', message, 403);
  }
}

/** The requested quantity exceeds what is currently available to sell. */
export class InventoryUnavailableError extends AppError {
  constructor(message: string) {
    super('INVENTORY_UNAVAILABLE', message, 409);
  }
}
