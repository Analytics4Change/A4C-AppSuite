---
status: current
last_updated: 2026-02-10
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Integration with NIH RxNorm API for standardized medication data, including search, classification, controlled substance checking, and psychotropic status determination. Provides client-side caching with IndexedDB for offline capability and performance optimization.

**When to read**:
- Implementing medication search functionality
- Adding controlled substance or psychotropic medication detection
- Understanding medication data flow from API to database
- Troubleshooting medication search or classification issues
- Optimizing medication search performance

**Prerequisites**: [medications table](../../reference/database/tables/medications.md), [medication_history table](../../reference/database/tables/medication_history.md)

**Key topics**: `rxnorm`, `medication-search`, `nih-api`, `indexeddb`, `caching`, `controlled-substances`, `psychotropic`, `atc-codes`

**Estimated read time**: 20 minutes
<!-- TL;DR-END -->

# RxNorm Integration Guide

## Overview

The A4C AppSuite integrates with the NIH RxNorm API to provide standardized medication data for clinical operations. RxNorm is a normalized naming system for generic and branded drugs maintained by the National Library of Medicine, providing unique concept identifiers (RxCUI) and relationships between medications.

This integration enables:
- Real-time medication search with autocomplete
- Medication classification and categorization
- Controlled substance detection via DEA schedules
- Psychotropic medication identification via ATC codes
- Medication purpose/indication lookup via MEDRT
- Offline functionality via client-side caching

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                          │
├─────────────────────────────────────────────────────────────────┤
│  RXNormMedicationApi (IMedicationApi)                           │
│  └─> Implements medication search interface                     │
│      └─> Uses MedicationSearchService                           │
├─────────────────────────────────────────────────────────────────┤
│  MedicationSearchService                                         │
│  └─> Orchestrates search with caching                           │
│      ├─> Checks IndexedDB cache                                 │
│      ├─> Falls back to RXNormAdapter                            │
│      └─> Updates cache on API success                           │
├─────────────────────────────────────────────────────────────────┤
│  RXNormAdapter                                                   │
│  └─> HTTP client for RxNorm API                                 │
│      ├─> Fetches display names                                  │
│      ├─> Checks controlled status (DEA schedules)               │
│      ├─> Checks psychotropic status (ATC codes)                 │
│      └─> Gets medication purposes (MEDRT)                       │
├─────────────────────────────────────────────────────────────────┤
│  IndexedDB Cache                                                 │
│  └─> Client-side persistent storage                             │
│      ├─> medications store (full display names dataset)         │
│      ├─> searchCache store (search result cache)                │
│      └─> metadata store (cache timestamps, version)             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
         ┌────────────────────────────────────┐
         │   NIH RxNorm REST API              │
         ├────────────────────────────────────┤
         │  https://rxnav.nlm.nih.gov/REST    │
         │  ├─> /displaynames.json            │
         │  ├─> /rxclass/class/byDrugName.json│
         │  └─> Publicly accessible           │
         └────────────────────────────────────┘
                              │
                              ▼
         ┌────────────────────────────────────┐
         │   Medication Selection             │
         │   ├─> User selects medication      │
         │   ├─> Frontend creates record      │
         │   └─> Saved to medications table   │
         └────────────────────────────────────┘
                              │
                              ▼
         ┌────────────────────────────────────┐
         │   Database (PostgreSQL)            │
         │   ├─> medications table            │
         │   └─> medication_history table     │
         └────────────────────────────────────┘
```

## RxNorm API Endpoints

### Base Configuration

**Base URL**: `https://rxnav.nlm.nih.gov/REST`
**Authentication**: None required (public API)
**Rate Limiting**: Not enforced but use responsibly
**Default Timeout**: 10 seconds
**Retry Strategy**: 2 retries with exponential backoff

Configuration is centralized in `/frontend/src/config/medication-search.config.ts`:

```typescript
export const API_CONFIG = {
  rxnormBaseUrl: 'https://rxnav.nlm.nih.gov/REST',
  displayNamesEndpoint: '/displaynames.json',
  requestTimeout: 10000,
  maxRetries: 3,
  retryDelay: 1000
};
```

### Display Names Endpoint

**Purpose**: Retrieve comprehensive list of medication display names

**Endpoint**: `GET /displaynames.json`

**Response Format**:
```json
{
  "displayTermsList": {
    "term": [
      "Acetaminophen 500 MG Oral Tablet",
      "Ibuprofen 200 MG Oral Capsule",
      "..."
    ]
  }
}
```

**Usage in Codebase**:
```typescript
// RXNormAdapter.ts
const response = await this.httpClient.request<RXNormDisplayNamesResponse>({
  url: this.baseUrl,
  timeout: 30000,
  retries: 2
});
```

**Caching Strategy**:
- Fetched once on application startup
- Cached in IndexedDB for 6 hours
- 45MB storage limit (iOS safe)
- Stale cache used if API fails

### Controlled Substance Classification

**Purpose**: Check if medication is DEA controlled substance

**Endpoint**: `GET /rxclass/class/byDrugName.json?drugName={name}&relaSource=RXNORM&relas=has_schedule`

**Response Format**:
```json
{
  "rxclassDrugInfoList": {
    "rxclassDrugInfo": [
      {
        "rxclassMinConceptItem": {
          "classId": "...",
          "className": "Schedule II substance"
        },
        "rela": "has_schedule"
      }
    ]
  }
}
```

**Usage in Codebase**:
```typescript
// RXNormAdapter.ts
const status = await adapter.checkControlledStatus(drugName);
// Returns: { isControlled: true, scheduleClass: "Schedule II" }
```

**Schedule Values**:
- Schedule II: High potential for abuse (e.g., oxycodone, morphine)
- Schedule III: Moderate potential (e.g., codeine combinations)
- Schedule IV: Low potential (e.g., alprazolam, diazepam)
- Schedule V: Lowest potential (e.g., cough syrups with codeine)

**Note**: Schedule I is excluded (illegal substances)

### Psychotropic Medication Classification

**Purpose**: Identify medications affecting mental/cognitive function

**Endpoint**: `GET /rxclass/class/byDrugName.json?drugName={name}&relaSource=ATC`

**Response Format**:
```json
{
  "rxclassDrugInfoList": {
    "rxclassDrugInfo": [
      {
        "rxclassMinConceptItem": {
          "classId": "N06A",
          "className": "ANTIDEPRESSANTS"
        }
      }
    ]
  }
}
```

**Usage in Codebase**:
```typescript
// RXNormAdapter.ts
const status = await adapter.checkPsychotropicStatus(drugName);
// Returns: { isPsychotropic: true, atcCodes: ["N06A"], category: "Antidepressant" }
```

**ATC Code Classification**:
- **N05A**: Antipsychotics
- **N05B**: Anxiolytics
- **N05C**: Hypnotics/Sedatives
- **N06A**: Antidepressants
- **N06B**: Psychostimulants
- **N06C**: Combination Psychotropics
- **N06D**: Anti-dementia agents

### Medication Purpose/Indication

**Purpose**: Retrieve diseases/conditions medication treats or prevents

**Endpoint**: `GET /rxclass/class/byDrugName.json?drugName={name}&relaSource=MEDRT&relas=may_treat+may_prevent`

**Response Format**:
```json
{
  "rxclassDrugInfoList": {
    "rxclassDrugInfo": [
      {
        "rxclassMinConceptItem": {
          "className": "Hypertension",
          "classType": "Disease"
        },
        "rela": "may_treat"
      }
    ]
  }
}
```

**Usage in Codebase**:
```typescript
// RXNormAdapter.ts
const purposes = await adapter.getMedicationPurposes(drugName);
// Returns: [{ className: "Hypertension", classType: "Disease", rela: "may_treat" }]
```

## Data Flow

### Medication Search Flow

```
User types "Acet" in search box
    │
    ├─> MedicationSearchService.search()
    │   ├─> Check IndexedDB searchCache
    │   │   └─> Cache hit? Return cached results
    │   │
    │   └─> Cache miss? Fetch from adapter
    │       ├─> RXNormAdapter.fetchDisplayNames()
    │       │   ├─> Check memory cache (6 hour TTL)
    │       │   ├─> Check IndexedDB medications store
    │       │   └─> Fetch from RxNorm API if needed
    │       │
    │       ├─> Filter medications matching "Acet"
    │       │   └─> Fuzzy matching with threshold 0.3
    │       │
    │       ├─> Parse medication info
    │       │   ├─> Extract generic name
    │       │   ├─> Extract brand names
    │       │   ├─> Categorize (simplified)
    │       │   └─> Generate stable ID (hash)
    │       │
    │       └─> Store in searchCache
    │
    └─> Return results to UI
        └─> Display in SearchableDropdown
```

### Medication Selection and Storage Flow

```
User selects "Acetaminophen 500mg Tablet"
    │
    ├─> RXNormMedicationApi.saveMedication()
    │   ├─> Create DosageInfo object
    │   ├─> Store in medicationHistory map (in-memory)
    │   └─> Cache medication in medicationCache
    │
    └─> Future: Persist to database
        ├─> medications table
        │   ├─> organization_id (for RLS)
        │   ├─> name, generic_name, brand_names
        │   ├─> rxnorm_cui (if available)
        │   ├─> category_broad, category_specific
        │   ├─> is_controlled, controlled_substance_schedule
        │   ├─> is_psychotropic
        │   └─> flags (requiresMonitoring, isHighAlert)
        │
        └─> medication_history table
            ├─> client_id
            ├─> medication_id (FK to medications)
            ├─> prescription details
            ├─> dosage information
            └─> compliance tracking
```

## Client-Side Caching Strategy

### IndexedDB Structure

**Database Name**: `MedicationSearchDB`
**Version**: 1

**Object Stores**:

1. **medications** - Full dataset of medication display names
   - **Key**: Auto-incrementing ID
   - **Data**: Array of Medication objects
   - **TTL**: 6 hours
   - **Size**: ~30-45MB (iOS safe limit: 45MB)

2. **searchCache** - Search result cache
   - **Key**: Search query string
   - **Data**: { medications: Medication[], timestamp: number }
   - **TTL**: 30 minutes
   - **Eviction**: LRU (max 100 entries)

3. **metadata** - Cache metadata
   - **Key**: 'lastFetchTime', 'version', 'totalMedications'
   - **Data**: Timestamp and version info

### Cache Configuration

```typescript
// /frontend/src/config/medication-search.config.ts
export const CACHE_CONFIG: CacheConfig = {
  maxMemoryEntries: 100,
  memoryTTL: 30 * 60 * 1000,        // 30 minutes
  maxIndexedDBSize: 45 * 1024 * 1024, // 45MB (iOS safe)
  indexedDBTTL: 24 * 60 * 60 * 1000,  // 24 hours
  evictionPolicy: 'lru'
};
```

### Cache Validation

**Memory Cache**:
- Validated on every access
- Age check: `Date.now() - lastFetchTime < memoryTTL`
- Stale cache: Re-fetch from IndexedDB or API

**IndexedDB Cache**:
- Validated on application startup
- Version check prevents schema mismatches
- Stale cache: Re-fetch from API but use as fallback on error

**Offline Behavior**:
- If API fails and cache exists: Use stale cache with warning log
- If API fails and no cache: Return empty array
- IndexedDB failure: Fall back to API only (no caching)

## RXNormAdapter Implementation

### Core Responsibilities

1. **HTTP Communication**: Resilient HTTP client with retry logic
2. **Data Transformation**: Parse RxNorm responses to application models
3. **Medication Parsing**: Extract generic names, brands from display names
4. **Categorization**: Simplified medication categorization
5. **ID Generation**: Stable hash-based IDs for medications
6. **Health Monitoring**: Track API health and circuit breaker status

### Key Methods

#### `fetchDisplayNames(forceRefresh = false): Promise<Medication[]>`

Fetches full medication dataset from RxNorm API.

**Caching**:
- In-memory cache: 6 hours
- Checks `lastFetchTime` before fetching
- Returns cached data if valid

**Error Handling**:
- Retries: 2 attempts with exponential backoff
- Timeout: 30 seconds (large payload)
- Fallback: Return stale cache on API failure
- Last resort: Empty array

**Performance**:
- Typical payload: ~30,000 medications
- Fetch time: 2-5 seconds
- Processing time: 500ms-1s

#### `parseMedicationInfo(displayName: string): Medication`

Parses medication display name into structured data.

**Name Patterns**:
- `Generic (Brand)` → generic=Generic, brandNames=[Brand]
- `Brand [Generic]` → generic=Generic, brandNames=[Brand]
- `Plain Name` → generic=Plain Name, brandNames=[]

**Categorization Logic** (simplified):
- Pain medications: Contains ibuprofen, acetaminophen, aspirin
- Antibiotics: Ends with -cillin, -mycin
- Cardiovascular: Ends with -pril, -olol
- Diabetes: Contains metformin, insulin, glipizide
- Mental Health: Contains sertraline, fluoxetine, lorazepam
- Cholesterol: Ends with -statin

**ID Generation**:
```typescript
function generateMedicationId(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit
  }
  return `rxnorm-${Math.abs(hash)}`;
}
```

#### `checkControlledStatus(drugName: string): Promise<ControlledStatus>`

Queries RxNorm for DEA controlled substance schedule.

**Parameters**:
- `drugName`: Medication name (e.g., "Oxycodone")

**Returns**:
```typescript
interface ControlledStatus {
  isControlled: boolean;
  scheduleClass?: string;  // "Schedule II", "Schedule III", etc.
  error?: string;
}
```

**API Query**:
- Endpoint: `/rxclass/class/byDrugName.json`
- Parameters: `relaSource=RXNORM`, `relas=has_schedule`
- Timeout: 10 seconds
- Retries: 1

#### `checkPsychotropicStatus(drugName: string): Promise<PsychotropicStatus>`

Queries RxNorm for ATC classification to detect psychotropic medications.

**Parameters**:
- `drugName`: Medication name (e.g., "Sertraline")

**Returns**:
```typescript
interface PsychotropicStatus {
  isPsychotropic: boolean;
  atcCodes?: string[];      // ["N06A"]
  category?: string;        // "Antidepressant"
  error?: string;
}
```

**API Query**:
- Endpoint: `/rxclass/class/byDrugName.json`
- Parameters: `relaSource=ATC`
- Timeout: 10 seconds
- Retries: 1

**ATC Code Detection**:
- Checks if classId starts with N05 or N06
- Maps to category (Antipsychotic, Anxiolytic, Antidepressant, etc.)

#### `getMedicationPurposes(drugName: string): Promise<MedicationPurpose[]>`

Queries RxNorm for medication indications via MEDRT.

**Parameters**:
- `drugName`: Medication name

**Returns**:
```typescript
interface MedicationPurpose {
  className: string;    // "Hypertension"
  classType: string;    // "Disease"
  rela: string;         // "may_treat" or "may_prevent"
}
```

**API Query**:
- Endpoint: `/rxclass/class/byDrugName.json`
- Parameters: `relaSource=MEDRT`, `relas=may_treat may_prevent`
- Timeout: 10 seconds
- Retries: 1
- Deduplication: Removes duplicate className entries

## Environment Configuration

### Required Environment Variables

```bash
# RxNorm API Configuration
VITE_RXNORM_BASE_URL=https://rxnav.nlm.nih.gov/REST
VITE_RXNORM_TIMEOUT=10000

# Cache Configuration
VITE_CACHE_MEMORY_TTL=1800000       # 30 minutes
VITE_CACHE_INDEXEDDB_TTL=86400000   # 24 hours
VITE_CACHE_MAX_MEMORY_ENTRIES=100

# Circuit Breaker Configuration
VITE_CIRCUIT_FAILURE_THRESHOLD=5
VITE_CIRCUIT_RESET_TIMEOUT=60000    # 1 minute

# Search Configuration
VITE_SEARCH_MIN_LENGTH=1
VITE_SEARCH_MAX_RESULTS=15
VITE_SEARCH_DEBOUNCE_MS=300
```

### Environment-Specific Overrides

**Development**:
- Shorter cache TTLs (5 min memory, 1 hour IndexedDB)
- Faster debounce (300ms)
- Verbose logging enabled

**Test**:
- Zero-ms debounce (instant search)
- Cache disabled (always fresh data)
- Mock API responses

**Production**:
- Standard cache TTLs (30 min memory, 24 hour IndexedDB)
- Standard debounce (300ms)
- Console logging removed by Vite

### Validation

Environment variables are validated at startup using Zod schemas in `/frontend/src/config/env-validation.ts`:

```typescript
const frontendEnvSchema = z.object({
  VITE_RXNORM_BASE_URL: z.string().url().default('https://rxnav.nlm.nih.gov/REST'),
  VITE_RXNORM_TIMEOUT: numberString(10000),
  VITE_CACHE_MEMORY_TTL: numberString(1800000),
  // ... other fields
});
```

**Validation Errors**: Application startup fails with clear error message if required variables are missing or invalid.

## Performance Considerations

### Search Performance

**Typical Search Flow**:
1. User types 3 characters: ~10ms (cache hit)
2. Cache miss: ~50-100ms (IndexedDB lookup)
3. API fetch (first load): ~2-5s (full dataset)
4. Subsequent searches: <10ms (memory cache)

**Optimization Strategies**:
- Debouncing: 300ms prevents excessive API calls
- Memory cache: 100 entries with LRU eviction
- IndexedDB cache: 6-hour TTL reduces API load
- Fuzzy matching: Threshold 0.3 balances relevance vs speed

### Memory Usage

**Frontend Memory Footprint**:
- Full dataset in memory: ~10-15MB
- Search results cache: ~1-2MB (100 entries)
- Component state: <1MB
- **Total**: ~15-20MB typical usage

**IndexedDB Storage**:
- Full dataset: ~30-45MB
- Search cache: ~5-10MB
- Metadata: <1MB
- **Total**: ~40-50MB max

**iOS Considerations**:
- iOS Safari IndexedDB limit: 50MB per domain
- Config uses 45MB max to stay within safe limits
- Eviction warnings: Not expected with current dataset size

### API Rate Limiting

**Current Usage Pattern**:
- Display names fetch: Once per session (or every 6 hours)
- Classification queries: On-demand (user-triggered)
- Typical session: 1-5 API calls total

**NIH RxNorm**:
- No explicit rate limits published
- Fair use policy applies
- Recommended: Cache aggressively to minimize calls

### Network Resilience

**Circuit Breaker Pattern**:
- Failure threshold: 5 consecutive failures
- Reset timeout: 60 seconds
- Half-open state: Test with 3 requests
- Benefits: Prevents cascading failures, fast-fail behavior

**Retry Strategy**:
- Exponential backoff: 1s, 2s, 4s
- Max retries: 2 (3 attempts total)
- Timeout: 10-30s depending on endpoint

**Offline Mode**:
- Stale cache serves as fallback
- User warned of potentially outdated data
- Full functionality maintained for cached medications

## Database Integration

### Medications Table Mapping

When a user selects a medication from search results, the frontend creates a record in the `medications` table:

```typescript
// Conceptual mapping (implementation pending)
const medicationRecord = {
  organization_id: currentOrgId,
  name: medication.name,                    // "Acetaminophen 500mg Tablet"
  generic_name: medication.genericName,     // "acetaminophen"
  brand_names: medication.brandNames,       // ["Tylenol", "Panadol"]
  rxnorm_cui: null,                         // Not available from displaynames
  category_broad: medication.categories.broad,    // "Analgesics"
  category_specific: medication.categories.specific, // "Non-Opioid"
  is_psychotropic: medication.flags.isPsychotropic, // false
  is_controlled: medication.flags.isControlled,     // false
  is_formulary: true,
  is_active: true
};
```

**Note**: Current implementation uses in-memory storage. Database persistence is planned but not yet implemented.

### RxNorm CUI Limitation

**Current Limitation**: The `/displaynames.json` endpoint returns medication names but NOT RxCUI (Concept Unique Identifiers).

**Impact**:
- `medications.rxnorm_cui` column remains NULL for current implementation
- Cannot link to external systems requiring RxCUI
- Cannot use RxCUI-based relationships in RxNorm

**Future Enhancement**:
- Use `/rxcui.json` endpoint for individual lookups
- Store RxCUI during medication selection
- Enable advanced RxNorm features (drug interactions, alternatives)

### Medication History Mapping

When prescribing a medication, the frontend creates a record in `medication_history`:

```typescript
const prescriptionRecord = {
  organization_id: currentOrgId,
  client_id: selectedClientId,
  medication_id: savedMedicationId,  // FK to medications table
  prescription_date: new Date(),
  start_date: dosageInfo.startDate,
  dosage_amount: dosageInfo.amount,
  dosage_unit: dosageInfo.unit,
  dosage_form: dosageInfo.form,
  frequency: dosageInfo.frequency,
  route: dosageInfo.route,
  instructions: dosageInfo.instructions,
  status: 'active'
};
```

**See**:
- [medications table documentation](../../reference/database/tables/medications.md)
- [medication_history table documentation](../../reference/database/tables/medication_history.md)

## Error Handling

### API Error Scenarios

#### Network Timeout
```typescript
// Symptom: Request exceeds 10-30s timeout
// Cause: Slow connection, API overload
// Resolution:
// 1. Return stale cache if available
// 2. Log warning with retry recommendation
// 3. User sees cached data with warning indicator
```

#### API Rate Limit (Hypothetical)
```typescript
// Symptom: 429 Too Many Requests
// Cause: Exceeded fair use limits
// Resolution:
// 1. Circuit breaker opens
// 2. All requests fail-fast for 60s
// 3. User sees "Service temporarily unavailable"
// 4. Cache serves existing data
```

#### Invalid Response
```typescript
// Symptom: Response doesn't match expected schema
// Cause: API schema change, corrupted response
// Resolution:
// 1. Log error with response details
// 2. Return empty array
// 3. Alert developers via monitoring
```

### Cache Error Scenarios

#### IndexedDB Quota Exceeded
```typescript
// Symptom: QuotaExceededError
// Cause: Browser storage limit reached
// Resolution:
// 1. Clear old cache entries (LRU eviction)
// 2. Reduce cache size
// 3. Fall back to memory-only caching
// 4. Warn user to clear browser data
```

#### IndexedDB Unavailable
```typescript
// Symptom: IndexedDB not supported/blocked
// Cause: Private browsing mode, old browser
// Resolution:
// 1. Detect on initialization
// 2. Disable IndexedDB caching
// 3. Use memory cache only
// 4. Fetch from API more frequently
```

### Logging Strategy

**Log Levels**:
- `debug`: Search queries, cache hits/misses
- `info`: API fetches, cache updates, classification results
- `warn`: Stale cache usage, API failures
- `error`: Network errors, parsing failures, quota exceeded

**Log Categories**:
- `api`: All RxNorm API interactions
- `cache`: Cache operations and health
- `adapter`: Data transformation and parsing

**Example Logs**:
```typescript
log.info('Fetched 30,245 medications from RxNorm in 3,456ms');
log.debug('Using cached RxNorm display names', { age: '45 minutes' });
log.warn('Using stale cached data due to API failure');
log.error('Failed to fetch RxNorm display names', error);
```

## Testing

### Unit Tests

**RXNormAdapter Tests**:
```typescript
describe('RXNormAdapter', () => {
  test('fetchDisplayNames returns medications', async () => {
    const adapter = new RXNormAdapter();
    const meds = await adapter.fetchDisplayNames();
    expect(meds.length).toBeGreaterThan(0);
    expect(meds[0]).toHaveProperty('id');
    expect(meds[0]).toHaveProperty('name');
  });

  test('checkControlledStatus identifies Schedule II', async () => {
    const adapter = new RXNormAdapter();
    const status = await adapter.checkControlledStatus('Oxycodone');
    expect(status.isControlled).toBe(true);
    expect(status.scheduleClass).toBe('Schedule II');
  });

  test('checkPsychotropicStatus identifies antidepressant', async () => {
    const adapter = new RXNormAdapter();
    const status = await adapter.checkPsychotropicStatus('Sertraline');
    expect(status.isPsychotropic).toBe(true);
    expect(status.category).toBe('Antidepressant');
  });
});
```

**Cache Tests**:
```typescript
describe('Medication Cache', () => {
  test('cache hit returns cached data', async () => {
    const service = new MedicationSearchService();
    await service.initialize();

    // First search - cache miss
    const results1 = await service.search('Acet');

    // Second search - cache hit
    const results2 = await service.search('Acet');

    expect(results1).toEqual(results2);
  });

  test('stale cache triggers refresh', async () => {
    // Advance time past TTL
    jest.advanceTimersByTime(7 * 60 * 60 * 1000); // 7 hours

    const service = new MedicationSearchService();
    const results = await service.search('Acet');

    // Verify API was called, not cache
    expect(mockFetch).toHaveBeenCalled();
  });
});
```

### Integration Tests

**End-to-End Search Flow**:
```typescript
test('user can search and select medication', async () => {
  // Navigate to medication search
  await page.goto('/medications/add');

  // Type search query
  await page.fill('[data-testid="medication-search"]', 'Acet');

  // Wait for results
  await page.waitForSelector('[data-testid="search-result"]');

  // Verify results displayed
  const results = await page.$$('[data-testid="search-result"]');
  expect(results.length).toBeGreaterThan(0);

  // Select first result
  await results[0].click();

  // Verify medication selected
  const selected = await page.$('[data-testid="selected-medication"]');
  expect(selected).toBeTruthy();
});
```

### Performance Tests

**Search Response Time**:
```typescript
test('search completes within 100ms (cached)', async () => {
  const service = new MedicationSearchService();
  await service.initialize(); // Prime cache

  const start = performance.now();
  await service.search('Acet');
  const duration = performance.now() - start;

  expect(duration).toBeLessThan(100);
});

test('initial fetch completes within 10s', async () => {
  const adapter = new RXNormAdapter();

  const start = performance.now();
  await adapter.fetchDisplayNames(true); // Force refresh
  const duration = performance.now() - start;

  expect(duration).toBeLessThan(10000);
});
```

## Troubleshooting

### Common Issues

#### Search Returns No Results

**Symptom**: Medication search returns empty array despite valid input

**Diagnosis**:
```typescript
// Check if API is reachable
const health = await adapter.getHealthStatus();
console.log('API Health:', health);

// Check cache state
const cached = await indexedDB.open('MedicationSearchDB');
console.log('Cache available:', cached);

// Check console for errors
// Look for: "Failed to fetch RxNorm display names"
```

**Resolution**:
1. Verify `VITE_RXNORM_BASE_URL` is correct
2. Check network connectivity
3. Clear IndexedDB cache: Dev Tools → Application → IndexedDB
4. Force refresh: `adapter.fetchDisplayNames(true)`

#### Controlled Substance Detection Failing

**Symptom**: `is_controlled` always false despite controlled substance

**Diagnosis**:
```typescript
const status = await adapter.checkControlledStatus('Oxycodone');
console.log('Controlled status:', status);

// Check API response directly
const url = 'https://rxnav.nlm.nih.gov/REST/rxclass/class/byDrugName.json?drugName=Oxycodone&relaSource=RXNORM&relas=has_schedule';
const response = await fetch(url);
console.log('API Response:', await response.json());
```

**Resolution**:
1. Verify drug name spelling (RxNorm is case-sensitive)
2. Try generic name if brand name fails
3. Check if medication actually has DEA schedule
4. Verify API endpoint is accessible

#### Cache Quota Exceeded

**Symptom**: `QuotaExceededError` in browser console

**Diagnosis**:
```javascript
// Check IndexedDB usage
navigator.storage.estimate().then(estimate => {
  console.log('Usage:', estimate.usage / 1024 / 1024, 'MB');
  console.log('Quota:', estimate.quota / 1024 / 1024, 'MB');
});
```

**Resolution**:
1. Clear old cache entries: `service.clearCache()`
2. Reduce `VITE_CACHE_MAX_MEMORY_ENTRIES`
3. Lower `VITE_CACHE_INDEXEDDB_TTL` for faster eviction
4. Instruct user to clear browser storage

#### Stale Data in Production

**Symptom**: Medication data doesn't reflect recent RxNorm updates

**Diagnosis**:
```typescript
const metadata = await indexedDB.open('MedicationSearchDB').metadata;
console.log('Last fetch:', new Date(metadata.lastFetchTime));
```

**Resolution**:
1. Force cache refresh: Call `adapter.fetchDisplayNames(true)`
2. Lower cache TTL in production config
3. Implement manual refresh button for users
4. Monitor RxNorm update announcements

### Performance Issues

#### Slow Initial Load

**Symptom**: First medication search takes 5+ seconds

**Expected Behavior**: Initial load fetches full dataset (~30,000 meds) from API

**Optimizations**:
1. Display loading indicator during initial fetch
2. Initialize service in background on app load
3. Implement progressive loading (fetch on-demand)
4. Consider server-side caching

#### High Memory Usage

**Symptom**: Browser tab using excessive memory (>100MB)

**Diagnosis**:
```javascript
// Chrome DevTools → Memory → Take Heap Snapshot
// Look for MedicationSearchService objects
```

**Resolution**:
1. Reduce `VITE_CACHE_MAX_MEMORY_ENTRIES`
2. Clear unused cache entries more aggressively
3. Implement cache size limits
4. Profile with DevTools to identify memory leaks

## Future Enhancements

### RxCUI Integration

**Current Limitation**: Display names endpoint doesn't provide RxCUI

**Enhancement**:
1. Use `/rxcui.json` endpoint for individual lookups
2. Store RxCUI in `medications.rxnorm_cui` column
3. Enable advanced RxNorm features:
   - Drug interaction checking
   - Therapeutic alternatives
   - Brand/generic relationships

### Advanced Classification

**Current Limitation**: Simplified category detection via name patterns

**Enhancement**:
1. Use RxNorm RxClass API for accurate classification
2. Implement pharmacological class hierarchy
3. Add therapeutic equivalence (AB ratings)
4. Integrate with FDA NDC database

### Offline Support

**Current State**: Stale cache serves as fallback

**Enhancement**:
1. Service Worker for true offline capability
2. Background sync for cache updates
3. Offline indicator in UI
4. Differential sync for cache updates

### Performance Optimization

**Opportunities**:
1. Server-side caching via Edge Function
2. Incremental loading (paginated search)
3. WebWorker for fuzzy matching
4. Compressed cache storage

## Related Documentation

- **Database Tables**:
  - [medications](../../reference/database/tables/medications.md) - Medication catalog table
  - [medication_history](../../reference/database/tables/medication_history.md) - Prescription tracking table

- **Frontend Architecture**:
  - [Frontend CLAUDE.md](../../../../frontend/CLAUDE.md) - Frontend development guidelines
  - [Authentication Architecture](../../../architecture/authentication/frontend-auth-architecture.md) - Auth and JWT claims

- **API Implementation**:
  - `/frontend/src/services/api/RXNormMedicationApi.ts` - API service implementation
  - `/frontend/src/services/adapters/RXNormAdapter.ts` - RxNorm HTTP adapter
  - `/frontend/src/config/medication-search.config.ts` - Configuration file

- **External Resources**:
  - [RxNorm API Documentation](https://rxnav.nlm.nih.gov/RxNormAPIs.html) - NIH RxNorm API reference
  - [RxClass API](https://mor.nlm.nih.gov/RxClass/) - Drug classification API
  - [RxNorm Browser](https://mor.nlm.nih.gov/RxNav/) - Browse RxNorm concepts

## See Also

- **Configuration Management**: [Environment Variables](../../operations/configuration/ENVIRONMENT_VARIABLES.md) - Frontend environment setup
- **Caching Strategy**: Frontend caching patterns and IndexedDB usage
- **Error Handling**: Frontend error handling and logging patterns

---

**Last Updated**: 2026-02-10
**Applies To**: Frontend v1.0, RxNorm API (current)
**Status**: current
