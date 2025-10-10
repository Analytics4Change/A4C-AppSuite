# A4C AppSuite

Analytics4Change monorepo containing frontend and infrastructure components.

## Repository Structure

```
A4C-AppSuite/
├── frontend/          # React/TypeScript frontend application
└── infrastructure/    # Terraform infrastructure as code
```

## Overview

This monorepo consolidates the Analytics4Change (A4C) platform:

- **Frontend**: React-based medication management application
- **Infrastructure**: Terraform configurations for Zitadel (auth) and Supabase (database)

## Getting Started

### Frontend

```bash
cd frontend
npm install
npm run dev
```

See `frontend/CLAUDE.md` for detailed frontend development guidance.

### Infrastructure

```bash
cd infrastructure/terraform/environments/dev
terraform init
terraform plan
```

See `infrastructure/CLAUDE.md` for detailed infrastructure guidance.

## Git-Crypt

This repository uses git-crypt to encrypt sensitive files. After cloning:

```bash
git-crypt unlock /path/to/A4C-*.key
```

## Migration Notice

This repository was created by merging:
- `Analytics4Change/A4C-FrontEnd` → `frontend/`
- `Analytics4Change/A4C-Infrastructure` → `infrastructure/`

All commit history from both repositories has been preserved.

## Documentation

- Frontend Documentation: `frontend/CLAUDE.md`
- Infrastructure Documentation: `infrastructure/CLAUDE.md`
- Combined Guidance: `CLAUDE.md`
