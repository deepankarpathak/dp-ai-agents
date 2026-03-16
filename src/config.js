/**
 * API base URL for backend. Empty = same origin (use when served with backend or CRA proxy).
 * Set REACT_APP_API_URL in production if frontend is on a different host (e.g. https://api.yourdomain.com).
 */
export const API_BASE = process.env.REACT_APP_API_URL || "";
