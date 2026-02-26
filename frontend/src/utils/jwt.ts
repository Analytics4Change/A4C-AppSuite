/**
 * JWT Utility
 *
 * Shared utilities for decoding JWT tokens to extract custom claims.
 * Used by services that need direct access to JWT payload fields
 * (e.g., org_id, sub) without going through the auth provider abstraction.
 */

/**
 * Minimal decoded JWT claims used by data-access services.
 *
 * These services only need org_id and sub from the token to scope
 * their queries correctly. For the full claims shape used by the
 * auth layer see JWTClaims in auth.types.ts.
 */
export interface DecodedJWTClaims {
  org_id?: string;
  sub?: string;
}

/**
 * Decode a JWT access token and return the raw payload.
 *
 * Returns an empty object when the token is missing, malformed, or
 * cannot be base64-decoded, so callers can safely destructure the
 * result without additional null checks.
 *
 * @param token - A JWT string in the format header.payload.signature
 * @returns The decoded payload, or an empty object on any decoding error
 */
export function decodeJWT(token: string): DecodedJWTClaims {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(globalThis.atob(payload));
  } catch {
    return {};
  }
}
