# Documentation Management Scripts

This directory contains automation scripts for managing documentation across the A4C-AppSuite monorepo.

## Scripts Overview

### 1. find-markdown-files.js

Finds all markdown files in the repository, excluding build artifacts and internal directories.

**Purpose**: Inventory all documentation files for migration and auditing.

**Usage**:
```bash
# List all markdown files
node scripts/documentation/find-markdown-files.js

# Get count only
node scripts/documentation/find-markdown-files.js --count-only

# Output as JSON
node scripts/documentation/find-markdown-files.js --json
```

**Excludes**:
- `node_modules/`
- `.git/`
- `dev/` (active development tracking)
- `.next/`, `dist/`, `build/`, `coverage/` (build artifacts)
- `.temporal/` (Temporal working directory)

**Output**:
- Human-readable: Files grouped by directory
- JSON: Array of relative file paths
- Count only: Just the number

**Example**:
```bash
$ node scripts/documentation/find-markdown-files.js --count-only
162
```

**Current Repository Stats**:
- **162 markdown files** total
- Organized across frontend, infrastructure, workflows, and planning directories

---

### 2. categorize-files.js

Categorizes markdown files as "stay in place" or "move to documentation/" based on project rules.

**Purpose**: Automate file categorization for documentation consolidation.

**Usage**:
```bash
# Show full categorization report
node scripts/documentation/categorize-files.js

# Only show files to move
node scripts/documentation/categorize-files.js --move-only

# Only show files that stay
node scripts/documentation/categorize-files.js --stay-only

# Output as JSON
node scripts/documentation/categorize-files.js --json
```

**Categorization Rules**:

**Files that STAY**:
- All `CLAUDE.md` files (developer guidance)
- All `README.md` files (GitHub convention)
- All files in `.claude/` (Claude Code infrastructure)
- All files in `dev/` (development tracking)
- API contracts in `infrastructure/supabase/contracts/` (stay near source)

**Files that MOVE**:
- Everything else moves to `documentation/`
- Script suggests destination paths based on content
- Planning documentation (`.plans/`, `.archived_plans/`) flagged for manual review

**Output Example**:
```
================================================================================
FILES THAT STAY IN PLACE (44 files)
================================================================================

CLAUDE.md
  Reason: Developer guidance (CLAUDE.md)

.claude/agents/frontend-accessibility-checker.md
  Reason: Claude Code infrastructure

================================================================================
FILES TO MOVE (118 files)
================================================================================

--- Ready to Move (103) ---

frontend/docs/api/medication-service.md
  → documentation/frontend/reference/api/medication-service.md

infrastructure/supabase/JWT_CUSTOM_CLAIMS.md
  → documentation/infrastructure/guides/supabase/JWT_CUSTOM_CLAIMS.md

--- Needs Manual Review (15) ---

.plans/supabase-auth-integration/overview.md
  → NEEDS MANUAL REVIEW - See Phase 3.5

================================================================================
SUMMARY
================================================================================
Stay in place: 44 files
Move to documentation/: 118 files
Total: 162 files
```

**Current Repository Breakdown**:
- **44 files stay** in place
- **118 files move** to documentation/
  - **~103 files** ready to move with suggested destinations
  - **~15 planning docs** need manual categorization (aspirational vs. current vs. deprecated)

---

### 3. validate-links.js

Validates internal markdown links to detect broken references.

**Purpose**: Ensure all internal documentation links work correctly, especially after file moves.

**Usage**:
```bash
# Validate all links in repository
node scripts/documentation/validate-links.js

# Validate specific directory
node scripts/documentation/validate-links.js documentation/

# Show all links, not just broken ones
node scripts/documentation/validate-links.js --verbose

# Output as JSON
node scripts/documentation/validate-links.js --json
```

**What it checks**:
- Finds all markdown links: `[text](path)`
- Validates internal file references (not external URLs)
- Checks if linked files exist
- Resolves relative paths correctly
- Reports line numbers for broken links

**What it skips**:
- External URLs (`http://`, `https://`)
- Anchor-only links (`#section`)
- Mailto links (`mailto:`)

**Output Example**:
```
================================================================================
frontend/docs/architecture/auth-flow.md
================================================================================
Total links: 12
Internal links: 8
Broken links: 2

BROKEN LINKS:
  Line 45: [Authentication Guide](../guides/authentication.md)
    Resolved to: frontend/docs/guides/authentication.md
    Status: FILE NOT FOUND
  Line 78: [API Reference](../../api/auth-api.md)
    Resolved to: frontend/api/auth-api.md
    Status: FILE NOT FOUND

================================================================================
SUMMARY
================================================================================
Files scanned: 162
Total links: 503
Internal links: 256
Broken links: 9

⚠️  Found 9 broken link(s) in 6 file(s)
```

**Exit codes**:
- `0`: All links valid
- `1`: Broken links found

**Current Repository Status**:
- **162 files** scanned
- **503 total links** found
- **256 internal links** checked
- **9 broken links** detected (pre-existing issues in .claude/skills and documentation/ placeholders)

---

## Documentation Grooming Workflow

These scripts support the documentation consolidation project (see `dev/active/documentation-grooming-*.md`).

### Typical Workflow

1. **Inventory files**:
   ```bash
   node scripts/documentation/find-markdown-files.js --count-only
   ```

2. **Categorize for migration**:
   ```bash
   node scripts/documentation/categorize-files.js --move-only > files-to-move.txt
   ```

3. **Move files** (manual step using `git mv`):
   ```bash
   git mv frontend/docs/api/medication-service.md documentation/frontend/reference/api/medication-service.md
   ```

4. **Validate links after moves**:
   ```bash
   node scripts/documentation/validate-links.js
   ```

5. **Fix broken links** (manual step):
   - Update relative paths in moved files
   - Fix references in files that link to moved content

6. **Re-validate**:
   ```bash
   node scripts/documentation/validate-links.js
   ```

### Integration with CI/CD

These scripts can be integrated into GitHub Actions workflows:

```yaml
- name: Validate documentation links
  run: node scripts/documentation/validate-links.js
```

**Note**: The frontend already has a documentation validation workflow (`.github/workflows/frontend-documentation-validation.yml`) that will need to be updated to reference new documentation paths.

---

## Technical Details

### Dependencies
- Node.js (built-in modules only, no external dependencies)
- Works with Node.js 18+

### Module Exports

All scripts export functions for programmatic use:

```javascript
const { findMarkdownFiles } = require('./find-markdown-files');
const { categorizeFiles, shouldStay } = require('./categorize-files');
const { validateAllLinks } = require('./validate-links');

// Use in your own scripts
const files = findMarkdownFiles('/path/to/repo');
const { stay, move } = categorizeFiles();
const results = validateAllLinks('/path/to/directory');
```

### Design Principles

1. **Zero external dependencies**: Uses only Node.js built-in modules
2. **Composable**: Each script can be used standalone or imported
3. **Multiple output formats**: Human-readable and JSON for scripting
4. **Informative**: Provides context and reasons for decisions
5. **Safe**: Read-only operations (no file modifications)

---

## Development

### Adding New Exclusions

To exclude additional directories from markdown search, edit `EXCLUDE_DIRS` in `find-markdown-files.js`:

```javascript
const EXCLUDE_DIRS = [
  'node_modules',
  '.git',
  'dev',
  'your-new-exclusion'  // Add here
];
```

### Adding New Categorization Rules

To modify categorization logic, edit `shouldStay()` in `categorize-files.js`:

```javascript
function shouldStay(filePath) {
  // Add your custom rules here
  if (filePath.startsWith('my-special-dir/')) return true;

  // Existing rules...
  return false;
}
```

### Improving Link Detection

To handle additional link formats, update `MARKDOWN_LINK_REGEX` in `validate-links.js`:

```javascript
// Current regex handles: [text](path)
const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\(([^)]+)\)/g;

// To add reference-style links: [text][ref]
// Add additional regex patterns
```

---

## Troubleshooting

### "No files found"

**Cause**: Script is running from wrong directory or all markdown files are in excluded directories.

**Solution**:
- Check current working directory
- Verify repository structure
- Check exclusion list in script

### "Permission denied"

**Cause**: Script is not executable.

**Solution**:
```bash
chmod +x scripts/documentation/*.js
```

### "Cannot find module"

**Cause**: Trying to use `categorize-files.js` or `validate-links.js` without `find-markdown-files.js`.

**Solution**: Ensure all three scripts are in the same directory.

### False positive broken links

**Cause**: Link validation doesn't understand complex path resolution or dynamic links.

**Solution**:
- Manually verify the link
- Add to known issues list
- Consider using absolute paths from repository root

---

## Contributing

When modifying these scripts:

1. Maintain backward compatibility
2. Update this README with changes
3. Test on full repository before committing
4. Ensure scripts remain zero-dependency
5. Add usage examples for new features

---

## See Also

- **Documentation Grooming Plan**: `dev/active/documentation-grooming-plan.md`
- **Documentation Grooming Tasks**: `dev/active/documentation-grooming-tasks.md`
- **Documentation Grooming Context**: `dev/active/documentation-grooming-context.md`
- **Master Documentation Index**: `documentation/README.md`
