---
status: current
last_updated: 2025-01-13
---

# Infrastructure Documentation

Documentation for the A4C-AppSuite infrastructure, including Terraform IaC, Kubernetes deployments, and Supabase resources.

## Directory Structure

- **[getting-started/](./getting-started/)** - Onboarding guides, installation, and first steps
- **[architecture/](./architecture/)** - Design decisions and high-level patterns
- **[guides/](./guides/)** - How-to guides organized by technology
  - **[database/](./guides/database/)** - Database and SQL guides
  - **[kubernetes/](./guides/kubernetes/)** - Kubernetes deployment guides
  - **[supabase/](./guides/supabase/)** - Supabase-specific guides
- **[reference/](./reference/)** - Quick lookup documentation
  - **[database/](./reference/database/)** - Database schema and reference
  - **[kubernetes/](./reference/kubernetes/)** - Kubernetes resource reference
- **[testing/](./testing/)** - Testing strategies for infrastructure
- **[operations/](./operations/)** - Deployment and operational procedures
  - **[deployment/](./operations/deployment/)** - Deployment procedures
  - **[configuration/](./operations/configuration/)** - Configuration guides
  - **[troubleshooting/](./operations/troubleshooting/)** - Troubleshooting guides

## Quick Links

### Deployment & CI/CD
- **[Docker Image Tagging Strategy](./guides/docker-image-tagging-strategy.md)** - Commit SHA-based tagging for all containerized deployments
- **[Deployment Checklist](./operations/deployment/DEPLOYMENT_CHECKLIST.md)** - Step-by-step deployment procedures

### Supabase
- **[Supabase Guides](./guides/supabase/)** - Comprehensive Supabase documentation

## See Also

- [Infrastructure CLAUDE.md](../../infrastructure/CLAUDE.md) - Developer guidance for working with infrastructure
- [Architecture Documentation](../architecture/) - Cross-cutting architectural decisions
