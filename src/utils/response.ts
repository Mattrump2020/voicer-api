import { Response } from 'express';

export const sendSuccess = (res: Response, data: unknown = null, message = 'Success', statusCode = 200) =>
  res.status(statusCode).json({ success: true, message, data });

export const sendCreated = (res: Response, data: unknown, message = 'Created successfully') =>
  sendSuccess(res, data, message, 201);

export const sendError = (res: Response, message = 'An error occurred', statusCode = 400, errors: string[] = []) =>
  res.status(statusCode).json({ success: false, message, errors });

export const sendNotFound    = (res: Response, message = 'Resource not found') => sendError(res, message, 404);
export const sendUnauthorized = (res: Response, message = 'Unauthorized')       => sendError(res, message, 401);
export const sendForbidden   = (res: Response, message = 'Access denied')       => sendError(res, message, 403);
export const sendServerError = (res: Response, message = 'Internal server error') => sendError(res, message, 500);
