---
status: current
last_updated: 2025-01-13
---

# API Documentation

This directory contains API documentation for the A4C-FrontEnd application.

## Available APIs

- [Client API](./client-api.md) - Client management and data access
- [Medication API](./medication-api.md) - Medication search and management
- [Cache Service](./cache-service.md) - Caching implementation and strategy
- [Type Definitions](./types.md) - TypeScript type definitions and interfaces

## Architecture

The API layer follows a service-oriented architecture with:

- **Interface-based design** - All services implement interfaces for testability
- **Adapter pattern** - External service integration via adapters
- **Caching strategy** - Hybrid caching with memory and IndexedDB
- **Error handling** - Circuit breaker pattern for resilience

## Development Guidelines

See the main [project documentation](../../CLAUDE.md) for development patterns and best practices.

## Related Documentation

- [Architecture Overview](../architecture/overview.md)
- [Component Documentation](../components/)
- [Testing Guide](../TESTING.md)