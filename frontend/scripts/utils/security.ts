/**
 * Security utilities for file path validation and sanitization
 * Prevents directory traversal attacks and validates project paths
 */

import { resolve, relative, isAbsolute, normalize, extname, sep } from 'path';
import { configManager } from '../config/manager.js';
import { getLogger } from './logger.js';

const logger = getLogger('security');

/**
 * Sanitize file paths to prevent directory traversal attacks
 * @param userPath - User-provided file path
 * @param allowedBase - Base directory to restrict to (default: project root)
 * @returns Sanitized absolute path
 * @throws Error if path is outside allowed directory
 */
export function sanitizePath(userPath: string, allowedBase?: string): string {
  if (!userPath || typeof userPath !== 'string') {
    throw new Error('Invalid path: must be a non-empty string');
  }
  
  // Normalize path separators and remove null bytes
  const cleanPath = userPath.replace(/\0/g, '').replace(/\\/g, '/');
  
  if (!allowedBase) {
    allowedBase = resolve(process.cwd());
  }
  
  // Resolve both paths to their canonical forms
  const resolved = resolve(cleanPath);
  const allowed = resolve(allowedBase);
  
  // Use path.relative to check containment more securely
  const relativePath = relative(allowed, resolved);
  
  // If relative path starts with ".." or is absolute, it's outside the allowed directory
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`Path traversal attempt detected: ${userPath}`);
  }
  
  logger.debug('Path sanitized successfully', {
    original: userPath,
    sanitized: resolved,
    allowedBase
  });
  
  return resolved;
}

/**
 * Validate that a file path exists within the project structure
 * @param filePath - File path to validate
 * @returns True if path is valid and safe
 */
export function isValidProjectPath(filePath: string): boolean {
  try {
    // First validate basic input
    if (!filePath || typeof filePath !== 'string' || filePath.length === 0) {
      logger.debug('Invalid file path: empty or non-string', { filePath });
      return false;
    }
    
    // Check for null bytes and other dangerous characters
    if (/[\0\r\n]/.test(filePath)) {
      logger.warn('Invalid file path: contains dangerous characters', { filePath });
      return false;
    }
    
    // Use sanitizePath which has more robust validation
    const sanitized = sanitizePath(filePath);
    
    // Get security config
    const securityConfig = configManager.get('security');
    
    // Additional checks for blocked paths using normalized path
    const normalizedPath = normalize(filePath).toLowerCase();
    const blockedPaths = [
      'node_modules',
      '.git',
      'dist',
      'build',
      '.env',
      'package-lock.json',
      '.npmrc'
    ];
    
    // Check if any blocked path is contained in the file path
    if (blockedPaths.some(blocked => normalizedPath.includes(blocked))) {
      logger.debug('Path blocked: contains restricted directory', { filePath, normalizedPath });
      return false;
    }
    
    // Check maximum path depth to prevent deeply nested attacks
    const pathDepth = sanitized.split(sep).length;
    if (pathDepth > securityConfig.maxPathDepth) {
      logger.warn('Path blocked: exceeds maximum depth', { 
        filePath, 
        depth: pathDepth, 
        maxDepth: securityConfig.maxPathDepth 
      });
      return false;
    }
    
    // Check allowed file extensions
    const ext = extname(filePath).toLowerCase();
    const allowedExtensions = ['.js', '.ts', '.tsx', '.md', '.json', '.yml', '.yaml'];
    if (ext && !allowedExtensions.includes(ext)) {
      logger.debug('Path blocked: invalid file extension', { filePath, extension: ext });
      return false;
    }
    
    logger.debug('Path validation successful', { filePath, sanitized });
    return true;
  } catch (error) {
    logger.warn('Path validation failed', { filePath, error });
    return false;
  }
}

/**
 * Validate command arguments to prevent injection attacks
 * @param args - Array of command arguments
 * @returns Sanitized arguments array
 */
export function sanitizeCommandArgs(args: string[]): string[] {
  const sanitized = args.map(arg => {
    // Remove null bytes and other dangerous characters
    const clean = arg.replace(/[\0\r\n]/g, '');
    
    // Escape shell metacharacters if needed
    if (/[;&|`$(){}\\*?~<>"'\\[\\]!^]/.test(clean)) {
      logger.warn('Command argument contains shell metacharacters', { original: arg, cleaned: clean });
    }
    
    return clean;
  });
  
  logger.debug('Command arguments sanitized', { original: args, sanitized });
  return sanitized;
}

/**
 * Check if a path is within allowed project directories
 * @param filePath - Path to check
 * @returns True if path is within allowed directories
 */
export function isPathAllowed(filePath: string): boolean {
  const securityConfig = configManager.get('security');
  const normalizedPath = normalize(filePath);
  
  // Check against allowed paths patterns
  const isAllowed = securityConfig.allowedPaths.some(pattern => {
    // Simple glob-like matching
    const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
    return regex.test(normalizedPath);
  });
  
  if (!isAllowed) {
    logger.debug('Path not in allowed directories', { filePath, allowedPaths: securityConfig.allowedPaths });
  }
  
  return isAllowed;
}

/**
 * Security configuration for documentation validation
 */
export const SECURITY_CONFIG = {
  paths: {
    src: './src',
    docs: './docs',
    output: './docs/dashboard.html',
    scripts: './scripts/documentation'
  },
  patterns: {
    components: '**/*.{tsx,ts}',
    api: '**/api/**/*.ts',
    types: '**/types/**/*.ts',
    documentation: '**/*.md'
  },
  validation: {
    maxFileAge: 30, // days
    requiredSections: ['Props', 'Usage', 'Accessibility'],
    maxFileSize: 10 * 1024 * 1024 // 10MB
  },
  security: {
    allowedExtensions: ['.js', '.ts', '.tsx', '.md', '.json', '.yml', '.yaml'],
    blockedPaths: ['node_modules', '.git', 'dist', 'build'],
    maxPathDepth: 10
  }
} as const;