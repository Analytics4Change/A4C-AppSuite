# Client Management Applet — User Notes

**Last Updated**: 2026-02-19

## Field UX Decisions

### Gender
Drop-down with two modes controlled by a settings toggle:

**Default mode** (binary):
```
Male
Female
Other → enables free-text input
```

**Expanded mode** (enabled via /settings toggle):
Full set of gender options from `client_reference_values` (Male, Female, Non-binary, Transgender Male, Transgender Female, Other, Prefer Not to Say).

### Pronouns
Drop-down (not free text):
```
He/Him/His
She/Her/Hers
They/Them/Theirs
Ze/Hir/Hirs
Other → enables free-text input
```

### Race
Multi-select dropdown (OMB categories):
```
American Indian or Alaska Native
Asian
Black or African American
Native Hawaiian or Other Pacific Islander
White
Two or more Races
Prefer not to say
```

### Ethnicity
Single-select dropdown (OMB two-question format):
```
Hispanic or Latino
Not Hispanic or Latino
Prefer not to say
```

### Primary Language
Single-select dropdown:
```
Arabic, Bengali, Cantonese, English, French, German, Hindi, Japanese,
Karen, Lahnda, Mandarin, Marathi, Portugese, Russian, Spanish, Swahili,
Tagalog, Tamil, Turkish, Urudu, Vietnamese
```

## Renamable Fields

Some fields have a fixed database column name but allow each organization to customize the **display label** shown in the UI. The underlying column and API field name never changes — only the tenant-facing label is configurable via the `client_field_definitions_projection` registry.

Example: `internal_case_number` is the DB column. Org A labels it "Youth ID", Org B labels it "Client Number".

### Renamable field list

| DB Column | Default Label | Notes |
|-----------|--------------|-------|
| `internal_case_number` | Internal Case Number | Tenant-facing unique identifier for the client |
| `external_case_number_1` | External Case Number 1 | External system reference |
| `external_case_number_2` | External Case Number 2 | External system reference |
| `external_case_number_3` | External Case Number 3 | External system reference |

Case numbers cannot be canonicalized across organizations, so they are **not** candidates for BI slicers — but they are candidates for detail-level display.

There will be no `court_case_number` field.

## Status Field

**Canonical values**: `active`, `inactive`

This is a simple lifecycle status. Program-location tracking (in-program, AWOL, hospital, detention, etc.) belongs to a future data collection applet, not client management.

## Discharge Events

- `client.discharged` — sets `discharge_date`, transitions client
- `client.reverse_discharge` — undoes an accidental or unintended discharge (restores previous state)
- `client.readmitted` — re-admits a previously discharged client who is being served again by the same provider (distinct from reverse_discharge; this is a new service engagement)
