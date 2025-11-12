# Medication API

## Overview

The Medication API provides comprehensive functionality for medication search, management, and history tracking within the A4C-FrontEnd application. It supports both mock implementations for development/testing and integration with external services like RXNorm for production use.

## Interface Definition

```typescript
interface IMedicationApi {
  searchMedications(query: string): Promise<Medication[]>;
  getMedication(id: string): Promise<Medication>;
  saveMedication(dosageInfo: DosageInfo): Promise<void>;
  getMedicationHistory(clientId: string): Promise<MedicationHistory[]>;
  updateMedication(id: string, dosageInfo: Partial<DosageInfo>): Promise<void>;
  deleteMedication(id: string): Promise<void>;
  clearCache(): Promise<void>;
  getHealthStatus(): Promise<any>;
  cancelAllRequests(): void;
}
```

## Methods

### searchMedications(query: string)

Searches for medications based on a text query.

**Parameters:**

- `query` (string): Search term for medication name, active ingredient, or brand name

**Returns:**

- `Promise<Medication[]>`: Array of matching medications

**Example Usage:**

```typescript
const medicationApi = new RXNormMedicationApi();

// Search for medications
const results = await medicationApi.searchMedications('lisinopril');
console.log(results); // Array of Medication objects

// Search with partial name
const partialResults = await medicationApi.searchMedications('aspir');
// Returns: [{ name: 'Aspirin', ... }, { name: 'Aspirin Low Dose', ... }]
```

**Error Handling:**

```typescript
try {
  const medications = await medicationApi.searchMedications('invalid-query');
} catch (error) {
  if (error instanceof NetworkError) {
    console.error('Network issue:', error.message);
  } else if (error instanceof ValidationError) {
    console.error('Invalid query:', error.message);
  }
}
```

### getMedication(id: string)

Retrieves detailed information for a specific medication.

**Parameters:**

- `id` (string): Unique medication identifier

**Returns:**

- `Promise<Medication>`: Complete medication details

**Example Usage:**

```typescript
// Get specific medication
const medication = await medicationApi.getMedication('med_12345');

console.log(medication);
// {
//   id: 'med_12345',
//   name: 'Lisinopril',
//   activeIngredient: 'lisinopril',
//   strength: '10mg',
//   form: 'tablet',
//   manufacturer: 'Generic Pharma',
//   rxNormCode: '314076'
// }
```

**Error Handling:**

```typescript
try {
  const medication = await medicationApi.getMedication('non-existent');
} catch (error) {
  if (error instanceof NotFoundError) {
    console.error('Medication not found');
  }
}
```

### saveMedication(dosageInfo: DosageInfo)

Saves a new medication prescription with dosage information.

**Parameters:**

- `dosageInfo` (DosageInfo): Complete medication and dosage information

**Returns:**

- `Promise<void>`: Resolves when save is complete

**Example Usage:**

```typescript
const dosageInfo: DosageInfo = {
  clientId: 'client_123',
  medication: {
    id: 'med_456',
    name: 'Metformin',
    activeIngredient: 'metformin hydrochloride',
    strength: '500mg',
    form: 'tablet'
  },
  dosage: {
    amount: 500,
    unit: 'mg',
    frequency: 'twice daily',
    route: 'oral',
    instructions: 'Take with meals'
  },
  startDate: new Date('2024-01-15'),
  prescribedBy: 'Dr. Smith'
};

await medicationApi.saveMedication(dosageInfo);
console.log('Medication saved successfully');
```

### getMedicationHistory(clientId: string)

Retrieves medication history for a specific client.

**Parameters:**

- `clientId` (string): Client identifier

**Returns:**

- `Promise<MedicationHistory[]>`: Array of historical medication records

**Example Usage:**

```typescript
const history = await medicationApi.getMedicationHistory('client_123');

console.log(history);
// [
//   {
//     id: 'hist_001',
//     medication: { name: 'Lisinopril', ... },
//     dosage: { amount: 10, unit: 'mg', ... },
//     startDate: '2024-01-01',
//     endDate: '2024-06-01',
//     status: 'completed',
//     prescribedBy: 'Dr. Johnson'
//   },
//   // ... more history records
// ]
```

### updateMedication(id: string, dosageInfo: Partial<DosageInfo>)

Updates an existing medication prescription.

**Parameters:**

- `id` (string): Medication record identifier
- `dosageInfo` (Partial<DosageInfo>): Fields to update

**Returns:**

- `Promise<void>`: Resolves when update is complete

**Example Usage:**

```typescript
// Update dosage amount
await medicationApi.updateMedication('prescription_789', {
  dosage: {
    amount: 20, // Increase from 10mg to 20mg
    unit: 'mg',
    frequency: 'once daily'
  }
});

// Update instructions only
await medicationApi.updateMedication('prescription_789', {
  dosage: {
    instructions: 'Take on empty stomach'
  }
});
```

### deleteMedication(id: string)

Removes a medication prescription (typically marks as discontinued).

**Parameters:**

- `id` (string): Medication record identifier

**Returns:**

- `Promise<void>`: Resolves when deletion is complete

**Example Usage:**

```typescript
// Discontinue medication
await medicationApi.deleteMedication('prescription_789');
console.log('Medication discontinued');
```

### clearCache()

Clears all internal caches for testing or memory management purposes.

**Parameters:**

- None

**Returns:**

- `Promise<void>`: Resolves when cache clearing is complete

**Example Usage:**

```typescript
// Clear all caches
await medicationApi.clearCache();
console.log('All caches cleared');

// Useful for testing scenarios
beforeEach(async () => {
  await medicationApi.clearCache(); // Start with clean cache
});
```

### getHealthStatus()

Retrieves API health status and performance statistics.

**Parameters:**

- None

**Returns:**

- `Promise<any>`: Health status object with API statistics

**Example Usage:**

```typescript
// Get API health information
const healthStatus = await medicationApi.getHealthStatus();

console.log(healthStatus);
// {
//   status: 'healthy',
//   uptime: 3600000,
//   cacheSize: 1024,
//   requestCount: 150,
//   averageResponseTime: 250,
//   errorRate: 0.02
// }

// Check if API is available
if (healthStatus.status === 'healthy') {
  console.log('API is operating normally');
} else {
  console.warn('API may be experiencing issues');
}
```

### cancelAllRequests()

Cancels all pending API requests immediately.

**Parameters:**

- None

**Returns:**

- `void`: Synchronous operation

**Example Usage:**

```typescript
// Cancel all pending requests (e.g., on component unmount)
medicationApi.cancelAllRequests();
console.log('All pending requests cancelled');

// In React component cleanup
useEffect(() => {
  return () => {
    medicationApi.cancelAllRequests();
  };
}, []);

// During navigation away from medication search
const handlePageLeave = () => {
  medicationApi.cancelAllRequests();
  navigate('/other-page');
};
```

## Data Types

### Medication

```typescript
interface Medication {
  id: string;
  name: string;
  activeIngredient: string;
  rxNormCode?: string;
  strength?: string;
  form: DosageForm;
  manufacturer?: string;
  brandNames?: string[];
  genericNames?: string[];
  therapeuticClass?: string;
  controlled?: boolean;
  fdaApproved?: boolean;
}
```

### DosageInfo

```typescript
interface DosageInfo {
  clientId: string;
  medication: Medication;
  dosage: {
    amount: number;
    unit: string;
    frequency: string;
    route: string;
    instructions?: string;
    conditions?: string[];
  };
  startDate: Date;
  endDate?: Date;
  prescribedBy: string;
  notes?: string;
}
```

### MedicationHistory

```typescript
interface MedicationHistory {
  id: string;
  medication: Medication;
  dosage: DosageInfo['dosage'];
  startDate: string;
  endDate?: string;
  status: 'active' | 'completed' | 'discontinued' | 'paused';
  prescribedBy: string;
  discontinuedBy?: string;
  discontinuedReason?: string;
  adherence?: {
    rate: number; // 0-100%
    lastUpdated: string;
  };
}
```

## Implementation Examples

### Mock Implementation (Development)

```typescript
// src/services/mock/MockMedicationApi.ts
export class MockMedicationApi implements IMedicationApi {
  private medications: Medication[] = [
    {
      id: 'med_001',
      name: 'Lisinopril',
      activeIngredient: 'lisinopril',
      strength: '10mg',
      form: 'tablet',
      manufacturer: 'Generic Pharma'
    },
    // ... more mock data
  ];

  async searchMedications(query: string): Promise<Medication[]> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const lowercaseQuery = query.toLowerCase();
    return this.medications.filter(med => 
      med.name.toLowerCase().includes(lowercaseQuery) ||
      med.activeIngredient.toLowerCase().includes(lowercaseQuery)
    );
  }

  async getMedication(id: string): Promise<Medication> {
    const medication = this.medications.find(m => m.id === id);
    if (!medication) {
      throw new NotFoundError(`Medication with id ${id} not found`);
    }
    return medication;
  }

  // ... other method implementations
}
```

### RXNorm Integration (Production)

```typescript
// src/services/api/RXNormMedicationApi.ts
export class RXNormMedicationApi implements IMedicationApi {
  constructor(
    private httpClient: ResilientHttpClient,
    private rxNormAdapter: RXNormAdapter,
    private cacheService: HybridCacheService
  ) {}

  async searchMedications(query: string): Promise<Medication[]> {
    // Check cache first
    const cacheKey = `search:${query}`;
    const cached = await this.cacheService.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Search RXNorm API
      const response = await this.httpClient.get(
        `https://rxnav.nlm.nih.gov/REST/drugs.json?name=${encodeURIComponent(query)}`
      );

      // Transform RXNorm response to our Medication format
      const medications = this.rxNormAdapter.transformSearchResults(response.data);

      // Cache results for 1 hour
      await this.cacheService.set(cacheKey, medications, 3600);

      return medications;
    } catch (error) {
      throw new APIError(`RXNorm search failed: ${error.message}`);
    }
  }

  // ... other method implementations
}
```

## Error Handling

### Error Types

```typescript
// Custom error classes
class APIError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'APIError';
  }
}

class NetworkError extends APIError {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

class ValidationError extends APIError {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

class NotFoundError extends APIError {
  constructor(message: string) {
    super(message, 404);
    this.name = 'NotFoundError';
  }
}
```

### Error Handling Patterns

```typescript
// Service with comprehensive error handling
class MedicationService {
  constructor(private api: IMedicationApi) {}

  async searchWithErrorHandling(query: string): Promise<Medication[]> {
    try {
      // Validate input
      if (!query || query.trim().length < 2) {
        throw new ValidationError('Search query must be at least 2 characters');
      }

      return await this.api.searchMedications(query.trim());
    } catch (error) {
      if (error instanceof ValidationError) {
        // Handle validation errors
        throw error; // Re-throw for UI to handle
      } else if (error instanceof NetworkError) {
        // Handle network issues
        console.error('Network error during medication search:', error);
        throw new APIError('Unable to search medications. Please check your connection.');
      } else if (error instanceof APIError) {
        // Handle API errors
        console.error('API error during medication search:', error);
        throw new APIError('Medication search service is temporarily unavailable.');
      } else {
        // Handle unexpected errors
        console.error('Unexpected error during medication search:', error);
        throw new APIError('An unexpected error occurred. Please try again.');
      }
    }
  }
}
```

## Testing

### Unit Tests

```typescript
// src/services/api/__tests__/medication-api.test.ts
describe('IMedicationApi', () => {
  let mockApi: MockMedicationApi;

  beforeEach(() => {
    mockApi = new MockMedicationApi();
  });

  describe('searchMedications', () => {
    it('should return matching medications for valid query', async () => {
      const results = await mockApi.searchMedications('lisinopril');
      
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Lisinopril');
    });

    it('should return empty array for no matches', async () => {
      const results = await mockApi.searchMedications('nonexistent');
      
      expect(results).toHaveLength(0);
    });

    it('should handle case-insensitive search', async () => {
      const results = await mockApi.searchMedications('LISINOPRIL');
      
      expect(results).toHaveLength(1);
    });
  });

  describe('getMedication', () => {
    it('should return medication for valid id', async () => {
      const medication = await mockApi.getMedication('med_001');
      
      expect(medication.id).toBe('med_001');
      expect(medication.name).toBe('Lisinopril');
    });

    it('should throw NotFoundError for invalid id', async () => {
      await expect(mockApi.getMedication('invalid'))
        .rejects.toThrow(NotFoundError);
    });
  });
});
```

### Integration Tests

```typescript
// src/services/api/__tests__/rxnorm-integration.test.ts
describe('RXNorm Integration', () => {
  let api: RXNormMedicationApi;

  beforeEach(() => {
    api = new RXNormMedicationApi(httpClient, adapter, cache);
  });

  it('should search RXNorm API successfully', async () => {
    // Mock successful RXNorm response
    jest.spyOn(httpClient, 'get').mockResolvedValue({
      data: {
        drugGroup: {
          conceptGroup: [
            {
              conceptProperties: [
                {
                  rxcui: '314076',
                  name: 'lisinopril',
                  tty: 'IN'
                }
              ]
            }
          ]
        }
      }
    });

    const results = await api.searchMedications('lisinopril');
    
    expect(results).toHaveLength(1);
    expect(results[0].rxNormCode).toBe('314076');
  });
});
```

## Best Practices

### Service Configuration

```typescript
// Configure API service with proper error handling and caching
const medicationApi = new RXNormMedicationApi(
  new ResilientHttpClient({
    timeout: 10000,
    retries: 3,
    circuitBreaker: {
      failureThreshold: 5,
      resetTimeout: 30000
    }
  }),
  new RXNormAdapter(),
  new HybridCacheService({
    memoryCache: new MemoryCache(),
    persistentCache: new IndexedDBCache()
  })
);
```

### Usage in ViewModels

```typescript
class MedicationViewModel {
  @observable searchResults: Medication[] = [];
  @observable isLoading = false;
  @observable error: string | null = null;

  constructor(private medicationApi: IMedicationApi) {}

  @action
  async searchMedications(query: string) {
    if (query.length < 2) return;

    this.isLoading = true;
    this.error = null;

    try {
      const results = await this.medicationApi.searchMedications(query);
      runInAction(() => {
        this.searchResults = results;
      });
    } catch (error) {
      runInAction(() => {
        this.error = error.message;
      });
    } finally {
      runInAction(() => {
        this.isLoading = false;
      });
    }
  }
}
```

## Configuration

### Environment-based Setup

```typescript
// src/config/api.config.ts
export const createMedicationApi = (): IMedicationApi => {
  if (import.meta.env.VITE_USE_MOCK_API === 'true') {
    return new MockMedicationApi();
  }

  return new RXNormMedicationApi(
    new ResilientHttpClient({
      baseURL: import.meta.env.VITE_RXNORM_API_URL,
      timeout: parseInt(import.meta.env.VITE_API_TIMEOUT || '10000')
    }),
    new RXNormAdapter(),
    new HybridCacheService()
  );
};
```

## Changelog

- **v1.0.0**: Initial interface definition with core CRUD operations
- **v1.1.0**: Added medication history tracking
- **v1.2.0**: Enhanced error handling with custom error types
- **v1.3.0**: Added RXNorm integration support
- **v1.4.0**: Implemented caching and performance optimizations
- **v1.5.0**: Added comprehensive testing and validation
