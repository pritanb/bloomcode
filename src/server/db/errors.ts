export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const missing = () => new ApiError(404, 'NOT_FOUND', 'Record not found');
export const conflict = (message = 'Stale version') => new ApiError(409, 'CONFLICT', message);
