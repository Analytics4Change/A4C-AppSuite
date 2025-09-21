const path = require('path');

/**
 * Sanitize file paths to prevent directory traversal attacks
 * @param {string} userPath - User-provided file path
 * @param {string} allowedBase - Base directory to restrict to (default: project root)
 * @returns {string} - Sanitized absolute path
 * @throws {Error} - If path is outside allowed directory
 */
function sanitizePath(userPath, allowedBase = null) {
  if (!allowedBase) {
    allowedBase = path.resolve(process.cwd());
  }
  
  const resolved = path.resolve(userPath);
  const allowed = path.resolve(allowedBase);
  
  if (!resolved.startsWith(allowed)) {
    throw new Error(`Invalid path outside allowed directory: ${userPath}`);
  }
  
  return resolved;
}

/**
 * Escape shell arguments to prevent command injection
 * @param {string} arg - Shell argument to escape
 * @returns {string} - Escaped argument
 */
function escapeShellArg(arg) {
  // Handle common shell metacharacters
  return arg.replace(/[;&|`$(){}[\]\\'"<>?*]/g, '\\$&');
}

/**
 * Validate that a file path exists within the project structure
 * @param {string} filePath - File path to validate
 * @returns {boolean} - True if path is valid and safe
 */
function isValidProjectPath(filePath) {
  try {
    const sanitized = sanitizePath(filePath);
    const projectRoot = path.resolve(process.cwd());
    
    // Must be within project
    if (!sanitized.startsWith(projectRoot)) {
      return false;
    }
    
    // Must not contain suspicious patterns
    const suspiciousPatterns = [
      /\.\./,  // Parent directory traversal
      /\/\//,  // Double slashes
      /node_modules/,  // Avoid scanning dependencies
      /\.git/  // Avoid git internals
    ];
    
    return !suspiciousPatterns.some(pattern => pattern.test(filePath));
  } catch {
    return false;
  }
}

/**
 * Configuration for documentation validation
 */
const DOC_CONFIG = {
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
};

module.exports = {
  sanitizePath,
  escapeShellArg,
  isValidProjectPath,
  DOC_CONFIG
};