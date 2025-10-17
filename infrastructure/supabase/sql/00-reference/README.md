# Reference Code Archive

This directory contains code that was written but never deployed to production. These files are kept for reference purposes only.

## Why Archive Instead of Delete?

- **Learning resource**: Contains useful patterns (circuit breaker, retry logic)
- **Historical context**: Documents architectural decisions and evolution
- **Future reference**: May be useful for understanding original design intentions

## Archived Files

### `zitadel-bootstrap-reference.sql`

**Original purpose**: PostgreSQL-based organization bootstrap orchestration with Zitadel integration.

**Why archived**:
- Never deployed to production (greenfield project)
- Replaced by Temporal workflow orchestration for better:
  - Retry handling (built-in Temporal retry policies)
  - Observability (Temporal UI)
  - Real API integration (not SQL simulations)
  - Scalability (workers scale independently)
  - Maintainability (TypeScript vs SQL for complex logic)

**Useful patterns to extract**:
- Circuit breaker pattern for external API calls
- Retry logic with exponential backoff
- Event emission strategy (CQRS)
- Error handling and recovery

**Architecture decision**: Use Temporal workflows for orchestration, PostgreSQL for event store and CQRS projections only.

**Date archived**: 2025-10-17
**Archived by**: Claude Code during Temporal-first implementation
**Related commit**: Initial Temporal infrastructure setup

## Usage

These files are **NOT** included in production deployments. They exist only for:
- Reference when implementing similar patterns
- Documentation of architectural evolution
- Training and onboarding materials

Do not source or execute these files in production environments.
