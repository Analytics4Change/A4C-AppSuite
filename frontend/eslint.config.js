import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  // Apply to TypeScript and JavaScript files (browser environment)
  {
    files: ['src/**/*.{ts,tsx}', 'e2e/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parser: tsparser,
      globals: {
        // Browser globals
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        fetch: 'readonly',
        // Timer functions
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        queueMicrotask: 'readonly',
        // Performance APIs
        performance: 'readonly',
        // Web APIs
        indexedDB: 'readonly',
        URLSearchParams: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        Response: 'readonly',
        DOMException: 'readonly',
        // DOM types and interfaces
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLButtonElement: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLFormElement: 'readonly',
        HTMLSelectElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
        HTMLLIElement: 'readonly',
        HTMLUListElement: 'readonly',
        Element: 'readonly',
        Node: 'readonly',
        Document: 'readonly',
        EventTarget: 'readonly',
        Event: 'readonly',
        KeyboardEvent: 'readonly',
        MouseEvent: 'readonly',
        FocusEvent: 'readonly',
        CustomEvent: 'readonly',
        EventListener: 'readonly',
        MutationObserver: 'readonly',
        // IndexedDB types
        IDBDatabase: 'readonly',
        IDBOpenDBRequest: 'readonly',
        IDBKeyRange: 'readonly',
        // Scroll APIs
        ScrollBehavior: 'readonly',
        ScrollLogicalPosition: 'readonly',
        ScrollIntoViewOptions: 'readonly',
        // React types (for hooks)
        React: 'readonly',
        // Node.js types that might be used in browser code
        NodeJS: 'readonly',
        process: 'readonly',
        // Playwright test globals
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        Page: 'readonly',
        Locator: 'readonly',
        // Vitest globals
        vi: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // ESLint recommended rules
      ...js.configs.recommended.rules,
      
      // TypeScript ESLint recommended rules
      ...tseslint.configs.recommended.rules,
      
      // React hooks rules
      ...reactHooks.configs.recommended.rules,
      
      // Custom rules from original .eslintrc.json
      'react-refresh/only-export-components': 'warn',
      '@typescript-eslint/no-explicit-any': 'off', // Allow any in legacy code
      '@typescript-eslint/no-unused-vars': ['warn', { 
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_'
      }],
      
      // Additional helpful rules for TypeScript/React projects
      '@typescript-eslint/no-console': 'off', // Allow console statements
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-require-imports': 'off', // Allow require in Node.js files
      'prefer-const': 'warn',
      'no-var': 'error',
      'no-undef': 'error', // This should be handled by globals now
    },
  },
  
  // Apply to Node.js files (scripts, config, tests)
  {
    files: ['scripts/**/*.{js,ts,cjs}', '*.config.{js,ts}', 'vitest.config.*', 'playwright.config.*'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parser: tsparser,
      globals: {
        // Node.js globals
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        console: 'readonly',
        // Node.js timer functions
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        // Node.js types
        NodeJS: 'readonly',
        // Test globals
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        test: 'readonly',
        vi: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // ESLint recommended rules
      ...js.configs.recommended.rules,
      
      // TypeScript ESLint recommended rules
      ...tseslint.configs.recommended.rules,
      
      // React hooks rules
      ...reactHooks.configs.recommended.rules,
      
      // Custom rules from original .eslintrc.json
      'react-refresh/only-export-components': 'warn',
      '@typescript-eslint/no-explicit-any': 'off', // Allow any in legacy code
      '@typescript-eslint/no-unused-vars': ['warn', { 
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_'
      }],
      
      // Additional helpful rules for TypeScript/React projects
      '@typescript-eslint/no-console': 'off', // Allow console statements
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-require-imports': 'off', // Allow require in Node.js files
      'prefer-const': 'warn',
      'no-var': 'error',
      'no-undef': 'error', // This should be handled by globals now
    },
  },
  
  // Ignore patterns (equivalent to .eslintignore)
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
      '*.config.js',
      '*.config.ts',
      'vite.config.*',
      'playwright.config.*',
      'tailwind.config.*',
      'postcss.config.*',
    ],
  },
];