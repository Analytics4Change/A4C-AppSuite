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

      // Bans direct .schema(*).rpc(...) calls outside the SDK helpers. The selector
      // matches any schema argument, not just 'api' — there are no .schema('public').rpc(...)
      // calls in the repo today; if that changes, broaden the override list below.
      //
      // Activated 2026-05-11 (PR-C closeout) after migrating all 11 services to
      // supabaseService.apiRpc<T> / apiRpcEnvelope<T>. The repo-wide --max-warnings 0
      // policy means new direct callers will fail the lint gate.
      // See documentation/architecture/decisions/adr-rpc-readback-pattern.md
      // §"PII handling" + dev/active/migrate-services-to-api-rpc-envelope/.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name='rpc']" +
            "[callee.object.type='CallExpression'][callee.object.callee.type='MemberExpression']" +
            "[callee.object.callee.property.name='schema']",
          message:
            "Direct .schema('api').rpc(...) calls bypass PII masking. Use " +
            "supabaseService.apiRpcEnvelope<T>(...) for envelope-shape writes or " +
            "supabaseService.apiRpc<T>(...) for read-shape RPCs. The two SDK-boundary " +
            'helpers are allow-listed at src/services/auth/supabase.service.ts and ' +
            'src/services/api/envelope.ts.',
        },
      ],
    },
  },

  // SDK boundary — this is the only file that legitimately calls .schema('api').rpc(...).
  // The helpers exposed here (apiRpc, apiRpcEnvelope) are the only sanctioned way for
  // the rest of the codebase to invoke api.* RPCs; no-restricted-syntax above forbids
  // the pattern everywhere else. `envelope.ts` was previously listed defensively but
  // operates only on PostgrestSingleResponse objects (does not call .schema().rpc()
  // itself), so it doesn't trigger the rule — F5 PR #58 review removed the dead entry.
  {
    files: ['src/services/auth/supabase.service.ts'],
    rules: {
      'no-restricted-syntax': 'off',
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