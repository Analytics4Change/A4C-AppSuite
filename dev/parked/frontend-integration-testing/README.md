# Frontend Integration Testing Project

**Status**: Configuration Complete, Ready for Testing
**Date**: 2025-10-30
**Date Parked**: 2025-01-12
**Original Location**: Repository root

## Overview

This project contains step-by-step testing instructions for validating the frontend integration with deployed Supabase Edge Functions for the Organization Module.

## Purpose

Provides comprehensive testing procedures for:
- Edge Functions integration (4 functions)
- Database schema validation (projection tables + event processors)
- Frontend service layer testing
- End-to-end workflow validation

## Files

- **testing-guide.md** - Complete integration testing guide with prerequisites, test data setup, and step-by-step testing procedures

## Testing Scope

- **Backend**: Supabase Edge Functions (create-organization, create-program, create-invitation, accept-invitation)
- **Database**: Projection tables and event processors
- **Frontend**: Mock-auth with real API configuration
- **Workflows**: Organization bootstrap, invitation acceptance

## Why Parked

This testing guide was moved from the repository root to `dev/parked/` as part of the documentation consolidation project. The guide was specific to a one-time integration testing effort for the Organization Module implementation.

## Current Relevance

The Organization Module is now complete and in production (see `dev/parked/organization-module/`). This testing guide remains useful as:
- Reference for similar integration testing approaches
- Historical record of testing methodology
- Example of comprehensive E2E testing procedures

## Related Documentation

For current testing documentation, see:
- Frontend Testing: `documentation/frontend/testing/` (when migrated)
- Integration Testing: `frontend/docs/testing/integration-testing.md` (when migrated)
- E2E Testing: `frontend/docs/testing/e2e-testing.md` (when migrated)

## Using This Guide

While the specific setup steps may be outdated, the testing patterns and approaches remain valuable:
- Test data setup strategies
- API integration validation
- Frontend service testing
- Error handling verification
- State management validation
