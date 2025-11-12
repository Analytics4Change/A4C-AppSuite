# Medication Search Implementation

## Overview

The medication search system has been upgraded from mock data to a production-ready architecture that can use either mock data or real RXNorm API data based on environment configuration.

## Architecture

### Core Components

1. **RXNormMedicationApi** (`/src/services/api/RXNormMedicationApi.ts`)
   - Implements `IMedicationApi` interface
   - Drop-in replacement for `MockMedicationApi`
   - Integrates all search and caching services

2. **MedicationSearchService** (`/src/services/search/MedicationSearchService.ts`)
   - Fuzzy search using Fuse.js
   - Orchestrates cache and API calls
   - Lazy loads RXNorm data on first search

3. **RXNormAdapter** (`/src/services/adapters/RXNormAdapter.ts`)
   - Fetches medication data from NIH RXNorm API
   - Transforms and normalizes data
   - Caches full medication list for 6 hours

4. **HybridCacheService** (`/src/services/cache/HybridCacheService.ts`)
   - Three-tier caching: Memory → IndexedDB → Server
   - Automatic fallback chain
   - iOS-safe with 45MB IndexedDB limit

5. **ResilientHttpClient** (`/src/services/http/ResilientHttpClient.ts`)
   - Retry logic with exponential backoff
   - Request cancellation
   - Circuit breaker integration

6. **CircuitBreaker** (`/src/services/http/CircuitBreaker.ts`)
   - Prevents cascade failures
   - Automatic recovery
   - Three states: closed, open, half-open

## Configuration

### Environment Variables

Set in `.env` file:

```bash
# Use real RXNorm API (true) or mock data (false)
VITE_USE_RXNORM_API=false

# Optional configuration overrides
VITE_RXNORM_BASE_URL=https://rxnav.nlm.nih.gov
VITE_CACHE_MEMORY_TTL=1800000
VITE_CACHE_MAX_MEMORY_ENTRIES=100
```

### Automatic Selection

- **Development**: Uses mock data by default (`VITE_USE_RXNORM_API=false`)
- **Production**: Automatically uses RXNorm API
- **Override**: Set `VITE_USE_RXNORM_API=true` to test RXNorm in development

## Caching Strategy

### Three-Tier Cache

1. **Memory Cache (Level 1)**
   - LRU eviction policy
   - 100 entry limit
   - 30-minute TTL
   - Sub-millisecond response

2. **IndexedDB Cache (Level 2)**
   - Persistent browser storage
   - 45MB limit (iOS-safe)
   - 24-hour TTL
   - ~5ms response

3. **Server Cache (Level 3)**
   - HTTP cache headers
   - CDN caching
   - Falls back to API

### iOS Compatibility

- IndexedDB limited to 45MB to prevent 7-day eviction
- Automatic size tracking and oldest-entry eviction
- Graceful degradation if IndexedDB unavailable

## Search Features

### Fuzzy Matching
- Powered by Fuse.js
- Typo tolerance
- Weighted search across name, generic name, brand names
- Relevance scoring

### Performance
- Cached queries: < 50ms
- Memory hits: < 1ms
- IndexedDB hits: < 10ms
- API calls: 200-500ms typical

### Offline Support
- Works offline with cached data
- Graceful degradation
- Automatic cache warming for common medications

## Resilience Patterns

### Circuit Breaker
- Opens after 5 consecutive failures
- Resets after 60 seconds
- Half-open state for gradual recovery

### Retry Logic
- Exponential backoff
- Max 3 retries
- Doesn't retry on 4xx errors

### Request Cancellation
- Abort controller for all requests
- Cancel on component unmount
- Prevents memory leaks

## Usage

The system automatically selects the appropriate API based on environment:

```typescript
// In useViewModel.ts
const USE_RXNORM = import.meta.env.VITE_USE_RXNORM_API === 'true' || import.meta.env.PROD;

const medicationApi: IMedicationApi = USE_RXNORM 
  ? new RXNormMedicationApi() 
  : new MockMedicationApi();
```

## Testing

### Manual Testing

1. **Test with mock data (default)**:
   ```bash
   npm run dev
   ```

2. **Test with RXNorm API**:
   ```bash
   # Set in .env
   VITE_USE_RXNORM_API=true
   npm run dev
   ```

3. **Monitor caching**:
   - Open browser DevTools
   - Check Network tab for API calls
   - Check Application → IndexedDB for cache data

### Debugging

Enable debug logging in browser console:
```javascript
localStorage.setItem('LOG_LEVEL', 'debug');
```

View cache statistics:
```javascript
// In browser console when using RXNorm API
const api = window.medicationApi; // If exposed
await api.getHealthStatus();
```

## Migration from Mock

No migration needed - the system is designed as a drop-in replacement:

1. Both APIs implement the same `IMedicationApi` interface
2. Automatic environment-based selection
3. Backward compatible with existing ViewModels
4. No changes needed to UI components

## Performance Considerations

### Initial Load
- First search triggers RXNorm data fetch (~10,000 medications)
- Subsequent searches use cached data
- Background cache warming for common searches

### Memory Usage
- Memory cache limited to 100 entries
- IndexedDB limited to 45MB
- Automatic cleanup of expired entries

### Network Usage
- Single bulk fetch of all medications
- 6-hour cache validity
- Minimal API calls after initial load

## Security Considerations

- No API keys required (public NIH service)
- HTTPS only
- No sensitive data stored
- Cache encrypted by browser

## Future Enhancements

Potential improvements:
- Server-side caching proxy
- WebWorker for search indexing
- Incremental data updates
- RxCUI integration for detailed drug information
- Drug interaction checking
- Formulary integration