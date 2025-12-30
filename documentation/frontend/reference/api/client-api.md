---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: IClientApi interface for CRUD operations (getClients, getClient, searchClients, createClient, updateClient, deleteClient) with MockClientApi for development and ProductionClientApi with caching for production.

**When to read**:
- Implementing client data management features
- Creating mock implementations for testing
- Setting up optimistic updates in ViewModels
- Understanding client validation patterns

**Prerequisites**: None

**Key topics**: `client-api`, `crud-operations`, `mock-api`, `caching`, `optimistic-updates`

**Estimated read time**: 18 minutes
<!-- TL;DR-END -->

# Client API

## Overview

The Client API provides comprehensive functionality for managing client information within the A4C-FrontEnd application. It supports client creation, retrieval, searching, updating, and deletion operations with both mock implementations for development and integration capabilities for production systems.

## Interface Definition

```typescript
interface IClientApi {
  getClients(): Promise<Client[]>;
  getClient(id: string): Promise<Client>;
  searchClients(query: string): Promise<Client[]>;
  createClient(client: Omit<Client, 'id'>): Promise<Client>;
  updateClient(id: string, client: Partial<Client>): Promise<Client>;
  deleteClient(id: string): Promise<void>;
}
```

## Methods

### getClients()

Retrieves all clients in the system.

**Parameters:**

- None

**Returns:**

- `Promise<Client[]>`: Array of all client records

**Example Usage:**

```typescript
const clientApi = new MockClientApi();

// Get all clients
const allClients = await clientApi.getClients();
console.log(allClients);
// [
//   { id: 'client_001', firstName: 'John', lastName: 'Doe', ... },
//   { id: 'client_002', firstName: 'Jane', lastName: 'Smith', ... }
// ]
```

**Performance Considerations:**

```typescript
// For large datasets, consider pagination
interface PaginatedClientRequest {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// Enhanced implementation with pagination
async getClientsPaginated(request: PaginatedClientRequest): Promise<{
  clients: Client[];
  total: number;
  page: number;
  hasMore: boolean;
}> {
  // Implementation would include pagination logic
}
```

### getClient(id: string)

Retrieves a specific client by their unique identifier.

**Parameters:**

- `id` (string): Unique client identifier

**Returns:**

- `Promise<Client>`: Complete client information

**Example Usage:**

```typescript
// Get specific client
const client = await clientApi.getClient('client_123');

console.log(client);
// {
//   id: 'client_123',
//   firstName: 'John',
//   lastName: 'Doe',
//   dateOfBirth: '1985-06-15',
//   email: 'john.doe@email.com',
//   phone: '+1-555-0123',
//   address: {
//     street: '123 Main St',
//     city: 'Anytown',
//     state: 'CA',
//     zipCode: '12345'
//   },
//   emergencyContact: {
//     name: 'Jane Doe',
//     relationship: 'Spouse',
//     phone: '+1-555-0124'
//   },
//   createdAt: '2024-01-01T00:00:00Z',
//   updatedAt: '2024-01-15T10:30:00Z'
// }
```

**Error Handling:**

```typescript
try {
  const client = await clientApi.getClient('non-existent');
} catch (error) {
  if (error instanceof NotFoundError) {
    console.error('Client not found');
  } else if (error instanceof ValidationError) {
    console.error('Invalid client ID format');
  }
}
```

### searchClients(query: string)

Searches for clients based on various criteria.

**Parameters:**

- `query` (string): Search term matching name, email, phone, or other identifying information

**Returns:**

- `Promise<Client[]>`: Array of matching clients

**Example Usage:**

```typescript
// Search by name
const nameResults = await clientApi.searchClients('John Doe');

// Search by email
const emailResults = await clientApi.searchClients('john@email.com');

// Search by phone number
const phoneResults = await clientApi.searchClients('555-0123');

// Partial name search
const partialResults = await clientApi.searchClients('Joh');
// Returns clients with names containing "Joh"
```

**Advanced Search Implementation:**

```typescript
interface ClientSearchFilters {
  query?: string;
  ageRange?: { min: number; max: number };
  city?: string;
  state?: string;
  hasEmergencyContact?: boolean;
  createdAfter?: Date;
  createdBefore?: Date;
}

// Enhanced search with filters
async searchClientsAdvanced(filters: ClientSearchFilters): Promise<Client[]> {
  // Implementation would handle complex filtering
}
```

### createClient(client: Omit<Client, 'id'>)

Creates a new client record.

**Parameters:**

- `client` (Omit<Client, 'id'>): Client data without ID (ID is generated)

**Returns:**

- `Promise<Client>`: The created client with generated ID

**Example Usage:**

```typescript
const newClientData = {
  firstName: 'Alice',
  lastName: 'Johnson',
  dateOfBirth: '1990-03-22',
  email: 'alice.johnson@email.com',
  phone: '+1-555-0199',
  address: {
    street: '456 Oak Avenue',
    city: 'Springfield',
    state: 'IL',
    zipCode: '62701'
  },
  emergencyContact: {
    name: 'Bob Johnson',
    relationship: 'Spouse',
    phone: '+1-555-0200'
  },
  allergies: ['Penicillin', 'Shellfish'],
  medicalConditions: ['Hypertension'],
  insuranceInfo: {
    provider: 'Blue Cross',
    policyNumber: 'BC123456789',
    groupNumber: 'GRP001'
  }
};

const createdClient = await clientApi.createClient(newClientData);
console.log('Created client with ID:', createdClient.id);
```

**Validation Example:**

```typescript
// Client creation with validation
const validateClientData = (clientData: Omit<Client, 'id'>): void => {
  if (!clientData.firstName?.trim()) {
    throw new ValidationError('First name is required');
  }
  if (!clientData.lastName?.trim()) {
    throw new ValidationError('Last name is required');
  }
  if (!isValidEmail(clientData.email)) {
    throw new ValidationError('Valid email address is required');
  }
  if (!isValidPhone(clientData.phone)) {
    throw new ValidationError('Valid phone number is required');
  }
  if (!isValidDate(clientData.dateOfBirth)) {
    throw new ValidationError('Valid date of birth is required');
  }
};

try {
  validateClientData(newClientData);
  const client = await clientApi.createClient(newClientData);
} catch (error) {
  console.error('Validation failed:', error.message);
}
```

### updateClient(id: string, client: Partial<Client>)

Updates an existing client's information.

**Parameters:**

- `id` (string): Client identifier
- `client` (Partial<Client>): Fields to update

**Returns:**

- `Promise<Client>`: The updated client record

**Example Usage:**

```typescript
// Update contact information
const updatedClient = await clientApi.updateClient('client_123', {
  email: 'newemail@example.com',
  phone: '+1-555-9999',
  address: {
    street: '789 New Street',
    city: 'New City',
    state: 'NY',
    zipCode: '10001'
  }
});

// Update emergency contact only
await clientApi.updateClient('client_123', {
  emergencyContact: {
    name: 'Updated Contact',
    relationship: 'Friend',
    phone: '+1-555-1111'
  }
});

// Add medical condition
const client = await clientApi.getClient('client_123');
await clientApi.updateClient('client_123', {
  medicalConditions: [...client.medicalConditions, 'Diabetes Type 2']
});
```

**Optimistic Updates:**

```typescript
// Implement optimistic updates for better UX
class ClientViewModel {
  @observable clients: Client[] = [];

  @action
  async updateClientOptimistic(id: string, updates: Partial<Client>) {
    // Optimistically update the UI
    const originalClient = this.clients.find(c => c.id === id);
    if (originalClient) {
      Object.assign(originalClient, updates);
    }

    try {
      // Perform actual update
      const updatedClient = await this.clientApi.updateClient(id, updates);
      
      // Replace with server response
      runInAction(() => {
        const index = this.clients.findIndex(c => c.id === id);
        if (index !== -1) {
          this.clients[index] = updatedClient;
        }
      });
    } catch (error) {
      // Revert optimistic update on failure
      if (originalClient) {
        Object.assign(originalClient, originalClient);
      }
      throw error;
    }
  }
}
```

### deleteClient(id: string)

Removes a client from the system.

**Parameters:**

- `id` (string): Client identifier

**Returns:**

- `Promise<void>`: Resolves when deletion is complete

**Example Usage:**

```typescript
// Hard delete (permanent removal)
await clientApi.deleteClient('client_123');
console.log('Client permanently deleted');

// Soft delete implementation (marking as inactive)
class ExtendedClientApi implements IClientApi {
  async deleteClient(id: string): Promise<void> {
    // Mark as deleted instead of permanent removal
    await this.updateClient(id, {
      isActive: false,
      deletedAt: new Date().toISOString(),
      deletedBy: 'current_user_id'
    });
  }

  async restoreClient(id: string): Promise<Client> {
    return this.updateClient(id, {
      isActive: true,
      deletedAt: null,
      deletedBy: null
    });
  }
}
```

**Confirmation Pattern:**

```typescript
// Safe deletion with confirmation
const deleteClientSafely = async (clientId: string): Promise<boolean> => {
  const client = await clientApi.getClient(clientId);
  
  const confirmed = await showConfirmDialog({
    title: 'Delete Client',
    message: `Are you sure you want to delete ${client.firstName} ${client.lastName}?`,
    warning: 'This action cannot be undone.',
    confirmText: 'Delete',
    cancelText: 'Cancel'
  });

  if (confirmed) {
    await clientApi.deleteClient(clientId);
    return true;
  }
  
  return false;
};
```

## Data Types

### Client

```typescript
interface Client {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string; // ISO date string
  email: string;
  phone: string;
  address: Address;
  emergencyContact?: EmergencyContact;
  allergies?: string[];
  medicalConditions?: string[];
  insuranceInfo?: InsuranceInfo;
  notes?: string;
  isActive?: boolean;
  createdAt: string; // ISO datetime string
  updatedAt: string; // ISO datetime string
  createdBy?: string;
  updatedBy?: string;
}

interface Address {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country?: string;
}

interface EmergencyContact {
  name: string;
  relationship: string;
  phone: string;
  email?: string;
}

interface InsuranceInfo {
  provider: string;
  policyNumber: string;
  groupNumber?: string;
  effectiveDate?: string;
  expirationDate?: string;
}
```

## Implementation Examples

### Mock Implementation (Development)

```typescript
// src/services/mock/MockClientApi.ts
export class MockClientApi implements IClientApi {
  private clients: Client[] = [
    {
      id: 'client_001',
      firstName: 'John',
      lastName: 'Doe',
      dateOfBirth: '1985-06-15',
      email: 'john.doe@email.com',
      phone: '+1-555-0123',
      address: {
        street: '123 Main St',
        city: 'Anytown',
        state: 'CA',
        zipCode: '12345'
      },
      emergencyContact: {
        name: 'Jane Doe',
        relationship: 'Spouse',
        phone: '+1-555-0124'
      },
      allergies: ['Peanuts'],
      medicalConditions: ['Hypertension'],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    },
    // ... more mock data
  ];

  async getClients(): Promise<Client[]> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 300));
    return [...this.clients];
  }

  async getClient(id: string): Promise<Client> {
    await new Promise(resolve => setTimeout(resolve, 200));
    
    const client = this.clients.find(c => c.id === id);
    if (!client) {
      throw new NotFoundError(`Client with id ${id} not found`);
    }
    return { ...client };
  }

  async searchClients(query: string): Promise<Client[]> {
    await new Promise(resolve => setTimeout(resolve, 400));
    
    const lowercaseQuery = query.toLowerCase();
    return this.clients.filter(client => 
      client.firstName.toLowerCase().includes(lowercaseQuery) ||
      client.lastName.toLowerCase().includes(lowercaseQuery) ||
      client.email.toLowerCase().includes(lowercaseQuery) ||
      client.phone.includes(query)
    );
  }

  async createClient(clientData: Omit<Client, 'id'>): Promise<Client> {
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const newClient: Client = {
      ...clientData,
      id: `client_${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    this.clients.push(newClient);
    return { ...newClient };
  }

  async updateClient(id: string, updates: Partial<Client>): Promise<Client> {
    await new Promise(resolve => setTimeout(resolve, 400));
    
    const clientIndex = this.clients.findIndex(c => c.id === id);
    if (clientIndex === -1) {
      throw new NotFoundError(`Client with id ${id} not found`);
    }
    
    const updatedClient = {
      ...this.clients[clientIndex],
      ...updates,
      updatedAt: new Date().toISOString()
    };
    
    this.clients[clientIndex] = updatedClient;
    return { ...updatedClient };
  }

  async deleteClient(id: string): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 300));
    
    const clientIndex = this.clients.findIndex(c => c.id === id);
    if (clientIndex === -1) {
      throw new NotFoundError(`Client with id ${id} not found`);
    }
    
    this.clients.splice(clientIndex, 1);
  }
}
```

### Production Implementation

```typescript
// src/services/api/ProductionClientApi.ts
export class ProductionClientApi implements IClientApi {
  constructor(
    private httpClient: ResilientHttpClient,
    private cacheService: HybridCacheService
  ) {}

  async getClients(): Promise<Client[]> {
    const cacheKey = 'clients:all';
    const cached = await this.cacheService.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const response = await this.httpClient.get('/api/clients');
      const clients = response.data;
      
      // Cache for 5 minutes
      await this.cacheService.set(cacheKey, clients, 300);
      return clients;
    } catch (error) {
      throw new APIError(`Failed to fetch clients: ${error.message}`);
    }
  }

  async getClient(id: string): Promise<Client> {
    const cacheKey = `client:${id}`;
    const cached = await this.cacheService.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const response = await this.httpClient.get(`/api/clients/${id}`);
      const client = response.data;
      
      // Cache individual client for 10 minutes
      await this.cacheService.set(cacheKey, client, 600);
      return client;
    } catch (error) {
      if (error.status === 404) {
        throw new NotFoundError(`Client with id ${id} not found`);
      }
      throw new APIError(`Failed to fetch client: ${error.message}`);
    }
  }

  async searchClients(query: string): Promise<Client[]> {
    try {
      const response = await this.httpClient.get('/api/clients/search', {
        params: { q: query }
      });
      return response.data;
    } catch (error) {
      throw new APIError(`Client search failed: ${error.message}`);
    }
  }

  async createClient(clientData: Omit<Client, 'id'>): Promise<Client> {
    try {
      const response = await this.httpClient.post('/api/clients', clientData);
      const newClient = response.data;
      
      // Invalidate cache
      await this.cacheService.delete('clients:all');
      
      return newClient;
    } catch (error) {
      if (error.status === 400) {
        throw new ValidationError(`Invalid client data: ${error.message}`);
      }
      throw new APIError(`Failed to create client: ${error.message}`);
    }
  }

  async updateClient(id: string, updates: Partial<Client>): Promise<Client> {
    try {
      const response = await this.httpClient.patch(`/api/clients/${id}`, updates);
      const updatedClient = response.data;
      
      // Update cache
      await this.cacheService.set(`client:${id}`, updatedClient, 600);
      await this.cacheService.delete('clients:all');
      
      return updatedClient;
    } catch (error) {
      if (error.status === 404) {
        throw new NotFoundError(`Client with id ${id} not found`);
      } else if (error.status === 400) {
        throw new ValidationError(`Invalid update data: ${error.message}`);
      }
      throw new APIError(`Failed to update client: ${error.message}`);
    }
  }

  async deleteClient(id: string): Promise<void> {
    try {
      await this.httpClient.delete(`/api/clients/${id}`);
      
      // Clear from cache
      await this.cacheService.delete(`client:${id}`);
      await this.cacheService.delete('clients:all');
    } catch (error) {
      if (error.status === 404) {
        throw new NotFoundError(`Client with id ${id} not found`);
      }
      throw new APIError(`Failed to delete client: ${error.message}`);
    }
  }
}
```

## Testing

### Unit Tests

```typescript
// src/services/api/__tests__/client-api.test.ts
describe('IClientApi', () => {
  let mockApi: MockClientApi;

  beforeEach(() => {
    mockApi = new MockClientApi();
  });

  describe('getClients', () => {
    it('should return all clients', async () => {
      const clients = await mockApi.getClients();
      
      expect(Array.isArray(clients)).toBe(true);
      expect(clients.length).toBeGreaterThan(0);
    });
  });

  describe('searchClients', () => {
    it('should find clients by first name', async () => {
      const results = await mockApi.searchClients('John');
      
      expect(results).toHaveLength(1);
      expect(results[0].firstName).toBe('John');
    });

    it('should find clients by email', async () => {
      const results = await mockApi.searchClients('john.doe@email.com');
      
      expect(results).toHaveLength(1);
      expect(results[0].email).toBe('john.doe@email.com');
    });

    it('should return empty array for no matches', async () => {
      const results = await mockApi.searchClients('nonexistent');
      
      expect(results).toHaveLength(0);
    });
  });

  describe('createClient', () => {
    it('should create client with generated ID', async () => {
      const clientData = {
        firstName: 'Test',
        lastName: 'User',
        dateOfBirth: '1990-01-01',
        email: 'test@example.com',
        phone: '+1-555-0000',
        address: {
          street: '123 Test St',
          city: 'Test City',
          state: 'TS',
          zipCode: '12345'
        }
      };

      const created = await mockApi.createClient(clientData);
      
      expect(created.id).toBeDefined();
      expect(created.firstName).toBe('Test');
      expect(created.createdAt).toBeDefined();
      expect(created.updatedAt).toBeDefined();
    });
  });

  describe('updateClient', () => {
    it('should update existing client', async () => {
      const updates = {
        email: 'updated@example.com',
        phone: '+1-555-9999'
      };

      const updated = await mockApi.updateClient('client_001', updates);
      
      expect(updated.email).toBe('updated@example.com');
      expect(updated.phone).toBe('+1-555-9999');
      expect(updated.updatedAt).not.toBe(updated.createdAt);
    });

    it('should throw NotFoundError for invalid ID', async () => {
      await expect(mockApi.updateClient('invalid', {}))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('deleteClient', () => {
    it('should remove client from system', async () => {
      await mockApi.deleteClient('client_001');
      
      await expect(mockApi.getClient('client_001'))
        .rejects.toThrow(NotFoundError);
    });
  });
});
```

## Best Practices

### Caching Strategy

```typescript
// Implement intelligent caching
class CachedClientApi implements IClientApi {
  constructor(
    private baseApi: IClientApi,
    private cache: HybridCacheService
  ) {}

  async getClients(): Promise<Client[]> {
    const cacheKey = 'clients:all';
    let clients = await this.cache.get(cacheKey);
    
    if (!clients) {
      clients = await this.baseApi.getClients();
      // Cache for 5 minutes
      await this.cache.set(cacheKey, clients, 300);
    }
    
    return clients;
  }

  async createClient(clientData: Omit<Client, 'id'>): Promise<Client> {
    const newClient = await this.baseApi.createClient(clientData);
    
    // Invalidate list cache
    await this.cache.delete('clients:all');
    
    // Cache the new client
    await this.cache.set(`client:${newClient.id}`, newClient, 600);
    
    return newClient;
  }

  // Similar patterns for other methods...
}
```

### Validation Helpers

```typescript
// Client validation utilities
export const ClientValidation = {
  isValidEmail: (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  },

  isValidPhone: (phone: string): boolean => {
    const phoneRegex = /^\+?[\d\s\-\(\)]{10,}$/;
    return phoneRegex.test(phone);
  },

  isValidDate: (dateString: string): boolean => {
    const date = new Date(dateString);
    return !isNaN(date.getTime()) && date < new Date();
  },

  validateRequired: (client: Partial<Client>): string[] => {
    const errors: string[] = [];
    
    if (!client.firstName?.trim()) errors.push('First name is required');
    if (!client.lastName?.trim()) errors.push('Last name is required');
    if (!client.email || !ClientValidation.isValidEmail(client.email)) {
      errors.push('Valid email is required');
    }
    if (!client.phone || !ClientValidation.isValidPhone(client.phone)) {
      errors.push('Valid phone number is required');
    }
    if (!client.dateOfBirth || !ClientValidation.isValidDate(client.dateOfBirth)) {
      errors.push('Valid date of birth is required');
    }
    
    return errors;
  }
};
```

### Usage in ViewModels

```typescript
class ClientManagementViewModel {
  @observable clients: Client[] = [];
  @observable selectedClient: Client | null = null;
  @observable isLoading = false;
  @observable error: string | null = null;
  @observable searchQuery = '';
  @observable searchResults: Client[] = [];

  constructor(private clientApi: IClientApi) {}

  @action
  async loadClients() {
    this.isLoading = true;
    this.error = null;

    try {
      const clients = await this.clientApi.getClients();
      runInAction(() => {
        this.clients = clients;
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

  @action
  async searchClients(query: string) {
    this.searchQuery = query;
    
    if (query.length < 2) {
      this.searchResults = [];
      return;
    }

    try {
      const results = await this.clientApi.searchClients(query);
      runInAction(() => {
        this.searchResults = results;
      });
    } catch (error) {
      runInAction(() => {
        this.error = error.message;
      });
    }
  }

  @action
  selectClient(client: Client) {
    this.selectedClient = client;
  }

  @action
  async createClient(clientData: Omit<Client, 'id'>) {
    // Validate data first
    const validationErrors = ClientValidation.validateRequired(clientData);
    if (validationErrors.length > 0) {
      throw new ValidationError(validationErrors.join(', '));
    }

    const newClient = await this.clientApi.createClient(clientData);
    
    runInAction(() => {
      this.clients.push(newClient);
    });
    
    return newClient;
  }
}
```

## Configuration

### Environment Setup

```typescript
// src/config/client-api.config.ts
export const createClientApi = (): IClientApi => {
  if (import.meta.env.VITE_USE_MOCK_API === 'true') {
    return new MockClientApi();
  }

  return new ProductionClientApi(
    new ResilientHttpClient({
      baseURL: import.meta.env.VITE_API_BASE_URL,
      timeout: parseInt(import.meta.env.VITE_API_TIMEOUT || '10000')
    }),
    new HybridCacheService()
  );
};
```

## Changelog

- **v1.0.0**: Initial interface with basic CRUD operations
- **v1.1.0**: Added search functionality
- **v1.2.0**: Enhanced client data model with insurance and medical info
- **v1.3.0**: Added comprehensive validation utilities
- **v1.4.0**: Implemented caching and performance optimizations
- **v1.5.0**: Added soft delete support and audit trails
