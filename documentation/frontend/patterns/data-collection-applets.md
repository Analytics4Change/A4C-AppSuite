---
status: aspirational
last_updated: 2026-02-16
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: All data collection applets require a precursor location/status question using canonical values before any data entry begins.

**When to read**:
- Building a new data collection applet
- Adding the precursor question component to an existing applet
- Validating canonical location/status values

**Key topics**: `data-collection`, `precursor-question`, `canonical-values`

**Estimated read time**: 2 minutes
<!-- TL;DR-END -->

# Data Collection Applets

> **Note**: This feature is not yet implemented. This document describes planned functionality.

## Precursor Question

Every data collection applet MUST present a precursor question before any data entry. This question captures the client's current location/program status using a fixed set of canonical values.

### Canonical Values

| Value | Description |
|-------|-------------|
| `IN_PROGRAM` | Client is present in the program |
| `OUT_OF_PROGRAM_WORK` | Client is out of program for work |
| `OUT_OF_PROGRAM_HOME_VISIT` | Client is out on a home visit |
| `OUT_OF_PROGRAM_OFF_CAMPUS` | Client is off campus |
| `OUT_OF_PROGRAM_AWOL` | Client is absent without leave |
| `OUT_OF_PROGRAM_HOSPITAL` | Client is hospitalized |
| `OUT_OF_PROGRAM_SCHOOLING` | Client is attending school |
| `OUT_OF_PROGRAM_DETENTION` | Client is in detention |

### Behavior

- The precursor question is always the first step in any data collection flow
- The selected value is stored with the collected data record
- Subsequent data entry fields may vary based on the selected status

## Related Documentation

- [ui-patterns.md](ui-patterns.md) - Modal and dropdown patterns used in applet UI
- [EVENT-DRIVEN-GUIDE.md](../../frontend/guides/EVENT-DRIVEN-GUIDE.md) - CQRS patterns for persisting collected data
