/**
 * Backend API Configuration
 *
 * Provides validated configuration for the Backend API service.
 * The Backend API runs inside the k8s cluster and handles workflow operations
 * that require access to Temporal (which is not accessible from Edge Functions).
 *
 * Architecture (2-hop):
 * Frontend → Backend API (k8s) → Temporal → Domain Events
 *
 * Environment Variable:
 * - VITE_BACKEND_API_URL: Required for production/integration modes
 *   Example: https://api.a4c.firstovertheline.com
 *
 * See also:
 * - frontend/.env.example for configuration template
 * - dev/active/backend-api-implementation-status.md for architecture details
 */

import { getAppMode } from '@/config/deployment.config';

const backendApiUrl = import.meta.env.VITE_BACKEND_API_URL as string | undefined;

/**
 * Get the Backend API URL with lazy validation
 *
 * Validation behavior by mode:
 * - mock: Returns undefined (workflows are mocked locally)
 * - integration-auth: Requires VITE_BACKEND_API_URL, throws if missing
 * - production: Requires VITE_BACKEND_API_URL, throws if missing
 *
 * @returns Backend API URL or undefined in mock mode
 * @throws Error if URL is missing or invalid in production/integration modes
 *
 * @example
 * ```typescript
 * const apiUrl = getBackendApiUrl();
 * if (apiUrl) {
 *   const response = await fetch(`${apiUrl}/api/v1/workflows/...`);
 * }
 * ```
 */
export function getBackendApiUrl(): string | undefined {
  const mode = getAppMode();

  // Mock mode doesn't need real Backend API
  if (mode === 'mock') {
    return undefined;
  }

  // Production and integration modes require the URL
  if (!backendApiUrl) {
    throw new Error(
      'Missing Backend API configuration. ' +
      'Please set VITE_BACKEND_API_URL in .env.local ' +
      '(e.g., https://api-a4c.firstovertheline.com)'
    );
  }

  // Validate URL format
  try {
    new URL(backendApiUrl);
  } catch {
    throw new Error(
      `Invalid VITE_BACKEND_API_URL: "${backendApiUrl}". ` +
      'Must be a valid URL (e.g., https://api.a4c.firstovertheline.com)'
    );
  }

  return backendApiUrl;
}

/**
 * Backend API URL constant for direct access
 *
 * WARNING: This may be undefined. Use getBackendApiUrl() for validated access
 * that throws appropriate errors based on deployment mode.
 */
export const BACKEND_API_URL = backendApiUrl;
