const path = require('path');

/**
 * Sanitize file paths to prevent directory traversal attacks
 * @param {string} userPath - User-provided file path
 * @param {string} allowedBase - Base directory to restrict to (default: project root)
 * @returns {string} - Sanitized absolute path
 * @throws {Error} - If path is outside allowed directory
 */
function sanitizePath(userPath, allowedBase = null) {
  if (!userPath || typeof userPath !== 'string') {
    throw new Error('Invalid path: must be a non-empty string');
  }
  
  // Normalize path separators and remove null bytes
  const cleanPath = userPath.replace(/\0/g, '').replace(/\\/g, '/');
  
  if (!allowedBase) {
    allowedBase = path.resolve(process.cwd());
  }
  
  // Resolve both paths to their canonical forms
  const resolved = path.resolve(cleanPath);
  const allowed = path.resolve(allowedBase);
  
  // Use path.relative to check containment more securely
  const relativePath = path.relative(allowed, resolved);
  
  // If relative path starts with ".." or is absolute, it's outside the allowed directory
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Path traversal attempt detected: ${userPath}`);
  }
  
  return resolved;
}


/**
 * Validate that a file path exists within the project structure
 * @param {string} filePath - File path to validate
 * @returns {boolean} - True if path is valid and safe
 */
function isValidProjectPath(filePath) {
  try {
    // First validate basic input
    if (!filePath || typeof filePath !== 'string' || filePath.length === 0) {
      return false;
    }
    
    // Check for null bytes and other dangerous characters
    if (/[\0\r\n]/.test(filePath)) {
      return false;
    }
    
    // Use sanitizePath which has more robust validation
    const sanitized = sanitizePath(filePath);
    
    // Additional checks for blocked paths using normalized path
    const normalizedPath = path.normalize(filePath).toLowerCase();
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
      return false;
    }
    
    // Check maximum path depth to prevent deeply nested attacks
    const pathDepth = sanitized.split(path.sep).length;
    if (pathDepth > DOC_CONFIG.security.maxPathDepth) {
      return false;
    }
    
    // Check allowed file extensions
    const ext = path.extname(filePath).toLowerCase();
    if (ext && !DOC_CONFIG.security.allowedExtensions.includes(ext)) {
      return false;
    }
    
    return true;
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
  isValidProjectPath,
  DOC_CONFIG
};