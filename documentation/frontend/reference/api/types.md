---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Core TypeScript interfaces for medication domain (Medication, Dosage, DosageForm hierarchy), client management, search/filter types, RXNorm API types, and utility patterns (ApiResponse, AsyncState, FormState).

**When to read**:
- Creating medication-related features or forms
- Understanding dosage form hierarchies and routes
- Implementing search functionality with proper types
- Building type-safe API service layers

**Prerequisites**: None

**Key topics**: `medication-types`, `dosage-form`, `client-types`, `rxnorm-api`, `type-guards`

**Estimated read time**: 20 minutes
<!-- TL;DR-END -->

# Type Definitions

## Overview

This document describes the core TypeScript types and interfaces used throughout the A4C-FrontEnd application, including medication types, client types, dropdown types, search types, and service configuration types.

## Core Types

### Medication Types

```typescript
interface Medication {
  id: string;
  name: string;
  activeIngredient: string;
  rxNormCode?: string;
  strength?: string;
  form: DosageForm;
  manufacturer?: string;
}

interface DosageForm {
  id: string;
  name: string;
  category: 'solid' | 'liquid' | 'topical' | 'injection' | 'other';
  units: string[];
}

interface Dosage {
  amount: number;
  unit: string;
  frequency: DosageFrequency;
  route: string;
  instructions?: string;
  startDate?: Date;
  endDate?: Date;
}

interface DosageFrequency {
  times: number;
  period: 'daily' | 'weekly' | 'monthly';
  intervals?: string[];
  asNeeded?: boolean;
  conditions?: string[];
}

interface MedicationCategory {
  broad: string;
  specific: string;
}

interface MedicationFlags {
  isPsychotropic: boolean;
  isControlled: boolean;
  isNarcotic: boolean;
  requiresMonitoring: boolean;
}

interface MedicationHistory {
  id: string;
  medicationId: string;
  medication: Medication;
  startDate: Date;
  discontinueDate?: Date;
  prescribingDoctor?: string;
  dosageInfo: DosageInfo;
  status: 'active' | 'discontinued' | 'on-hold';
}

interface DosageInfo {
  medicationId: string;
  form: DosageForm;
  route?: DosageRoute;  // Specific route (Tablet, Capsule, etc.)
  amount: number;
  unit: DosageUnit;
  frequency: DosageFrequency | DosageFrequency[];  // Can be single or multiple frequencies
  timings?: string[];  // Multiple timing selections
  foodConditions?: string[];  // Food conditions array
  specialRestrictions?: string[];  // Special restrictions array
  startDate?: Date;
  discontinueDate?: Date;
  prescribingDoctor?: string;
  notes?: string;
}

interface DosageFormHierarchy {
  type: DosageForm;
  routes: DosageRouteOption[];
}

interface DosageRouteOption {
  name: DosageRoute;
  units: DosageUnit[];
}

interface DosageFormMap {
  [key: string]: DosageRouteOption[];
}

interface DosageFormUnits {
  [key: string]: DosageUnit[];
}
```

### Dosage Type Definitions

```typescript
type DosageForm = 
  | 'Solid'
  | 'Liquid'
  | 'Topical/Local'
  | 'Inhalation'
  | 'Injectable'
  | 'Rectal/Vaginal'
  | 'Ophthalmic/Otic'
  | 'Miscellaneous';

type SolidDosageForm = 
  | 'Tablet'
  | 'Caplet'
  | 'Capsule'
  | 'Chewable Tablet'
  | 'Orally Disintegrating Tablet (ODT)'
  | 'Sublingual Tablet (SL)'
  | 'Buccal Tablet';

type LiquidDosageForm = 
  | 'Solution'
  | 'Suspension'
  | 'Syrup'
  | 'Elixir'
  | 'Concentrate';

type TopicalDosageForm = 
  | 'Cream'
  | 'Ointment'
  | 'Gel'
  | 'Lotion'
  | 'Patch (Transdermal)'
  | 'Foam';

type InhalationDosageForm = 
  | 'Inhaler (MDI)'
  | 'Inhaler (DPI)'
  | 'Nebulizer Solution';

type InjectableDosageForm = 
  | 'Injectable'
  | 'Auto-Injector';

type RectalVaginalDosageForm = 
  | 'Suppository'
  | 'Enema';

type OphthalmicOticDosageForm = 
  | 'Eye Drops'
  | 'Eye Ointment'
  | 'Ear Drops';

type MiscellaneousDosageForm = 
  | 'Powder'
  | 'Granules'
  | 'Kit'
  | 'Device'
  | 'Other';

type DosageRoute = 
  | SolidDosageForm
  | LiquidDosageForm
  | TopicalDosageForm
  | InhalationDosageForm
  | InjectableDosageForm
  | RectalVaginalDosageForm
  | OphthalmicOticDosageForm
  | MiscellaneousDosageForm;

type DosageUnit = 
  | 'mg'
  | 'mcg'
  | 'g'
  | 'mL'
  | 'L'
  | 'drops'
  | 'sprays'
  | 'puffs'
  | 'units'
  | 'IU'
  | 'mEq'
  | 'mmol'
  | 'tablets'
  | 'capsules'
  | 'patches'
  | 'applications';
```

### Client Types

```typescript
interface Client {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: Date;
  medications?: Medication[];
  allergies?: string[];
  conditions?: string[];
}
```

### UI Component Types

```typescript
interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
  group?: string;
}

interface FormFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  helpText?: string;
}

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}
```

### Search Types

```typescript
interface MedicationSearchParams {
  query: string;
  maxResults?: number;
  includeGeneric?: boolean;
  includeBrand?: boolean;
  filters?: {
    category?: string[];
    strength?: string[];
    form?: string[];
  };
}

interface MedicationSearchResult {
  medications: Medication[];
  totalCount: number;
  hasMore: boolean;
  searchTime: number;
}
```

## Utility Types

### Common Patterns

```typescript
// Generic API response wrapper
interface ApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
  errors?: string[];
}

// Async operation state
interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

// Form state management
interface FormState<T> {
  values: T;
  errors: Partial<Record<keyof T, string>>;
  touched: Partial<Record<keyof T, boolean>>;
  isValid: boolean;
  isSubmitting: boolean;
}
```

### Event Types

```typescript
type ChangeHandler<T> = (value: T) => void;
type SubmitHandler<T> = (values: T) => void | Promise<void>;
type ErrorHandler = (error: Error) => void;

interface SelectionChangeEvent<T> {
  selected: T[];
  added?: T[];
  removed?: T[];
}
```

### Dropdown and UI Types

```typescript
// From types/dropdown.ts
interface DropdownHighlightState {
  typingHighlight: boolean;
  navigationHighlight: boolean;
  highlightedIndex: number;
}

interface DropdownPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

interface DropdownConfig {
  searchDebounceMs: number;
  maxVisibleItems: number;
  minSearchLength: number;
  closeOnSelect: boolean;
  allowCustomValue: boolean;
}

// From types/medication-search.types.ts
interface MedicationSearchConfig {
  debounceDelay: number;
  minSearchLength: number;
  maxResults: number;
  enableHighlighting: boolean;
  searchFields: string[];
}

interface MedicationSearchFilters {
  categories: string[];
  forms: string[];
  strengths: string[];
  manufacturers: string[];
  isGeneric?: boolean;
  isPrescription?: boolean;
}

interface MedicationSearchResult {
  medications: Medication[];
  totalCount: number;
  searchTime: number;
  hasMore: boolean;
  appliedFilters: MedicationSearchFilters;
}
```

### Domain Model Types

```typescript
// From types/models/Medication.ts
interface Medication {
  id: string;
  name: string;
  activeIngredient: string;
  rxNormCode?: string;
  strength?: string;
  form: DosageForm;
  manufacturer?: string;
  isControlled?: boolean;
  controlledSchedule?: string;
  isPsychotropic?: boolean;
  psychotropicCategory?: string;
  therapeutic Classes?: TherapeuticClass[];
  interactions?: DrugInteraction[];
  contraindications?: Contraindication[];
  sideEffects?: SideEffect[];
  warnings?: Warning[];
}

interface TherapeuticClass {
  id: string;
  name: string;
  category: string;
  level: number;
}

interface DrugInteraction {
  id: string;
  interactingMedication: string;
  severity: 'mild' | 'moderate' | 'severe' | 'contraindicated';
  description: string;
  mechanism: string;
  clinicalSignificance: string;
}

// From types/models/Dosage.ts
interface Dosage {
  amount: number;
  unit: string;
  frequency: DosageFrequency;
  route: string;
  instructions?: string;
  startDate?: Date;
  endDate?: Date;
  timing: DosageTiming;
  foodRequirements?: FoodRequirement;
  specialInstructions?: SpecialInstruction[];
}

interface DosageTiming {
  times: string[];
  interval?: number;
  intervalUnit?: 'hours' | 'days' | 'weeks';
  asNeeded: boolean;
  maxDailyDoses?: number;
  minimumInterval?: number;
}

interface FoodRequirement {
  timing: 'with_food' | 'without_food' | 'before_food' | 'after_food' | 'any';
  instructions?: string;
  restrictions?: string[];
}

// From types/models/Client.ts
interface Client {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: Date;
  medications?: ClientMedication[];
  allergies?: Allergy[];
  conditions?: MedicalCondition[];
  preferences?: ClientPreferences;
  emergencyContacts?: EmergencyContact[];
  permissions: ClientPermissions;
}

interface ClientMedication {
  id: string;
  medication: Medication;
  dosage: Dosage;
  prescribedBy: string;
  prescribedDate: Date;
  status: 'active' | 'paused' | 'discontinued' | 'completed';
  adherence?: AdherenceRecord[];
  notes?: string;
}

interface ClientPermissions {
  canView: boolean;
  canEdit: boolean;
  canPrescribe: boolean;
  canAdminister: boolean;
  restrictedMedications?: string[];
}
```

## Enums

### Common Enumerations

```typescript
enum MedicationCategory {
  CARDIOVASCULAR = 'cardiovascular',
  RESPIRATORY = 'respiratory',
  NEUROLOGICAL = 'neurological',
  GASTROINTESTINAL = 'gastrointestinal',
  ENDOCRINE = 'endocrine',
  MUSCULOSKELETAL = 'musculoskeletal',
  OTHER = 'other'
}

enum Priority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

enum UserRole {
  ADMIN = 'admin',
  HEALTHCARE_PROVIDER = 'healthcare_provider',
  CAREGIVER = 'caregiver',
  VIEWER = 'viewer'
}

// Dropdown and UI Enums
enum HighlightType {
  NONE = 'none',
  TYPING = 'typing',
  NAVIGATION = 'navigation',
  BOTH = 'both'
}

enum DropdownState {
  CLOSED = 'closed',
  OPENING = 'opening',
  OPEN = 'open',
  CLOSING = 'closing'
}

// Medication-specific Enums
enum ControlledSchedule {
  SCHEDULE_I = 'I',
  SCHEDULE_II = 'II',
  SCHEDULE_III = 'III',
  SCHEDULE_IV = 'IV',
  SCHEDULE_V = 'V'
}

enum MedicationStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  DISCONTINUED = 'discontinued',
  PENDING = 'pending',
  SUSPENDED = 'suspended'
}
```

## Type Guards

### Runtime Type Checking

```typescript
function isMedication(obj: any): obj is Medication {
  return obj && 
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.activeIngredient === 'string';
}

function isValidDosage(obj: any): obj is Dosage {
  return obj &&
    typeof obj.amount === 'number' &&
    typeof obj.unit === 'string' &&
    obj.frequency &&
    typeof obj.route === 'string';
}
```

## Usage Examples

### Component Props with Types

```typescript
interface MedicationFormProps {
  medication?: Medication;
  onSubmit: SubmitHandler<Medication>;
  onCancel: () => void;
  loading?: boolean;
  errors?: ValidationResult;
}

function MedicationForm({ medication, onSubmit, onCancel, loading, errors }: MedicationFormProps) {
  // Implementation
}
```

### API Service with Types

```typescript
class MedicationService {
  async searchMedications(params: MedicationSearchParams): Promise<MedicationSearchResult> {
    // Implementation
  }
  
  async getMedication(id: string): Promise<ApiResponse<Medication>> {
    // Implementation
  }
}
```

## Search and Service Types

### Medication Search Types

```typescript
interface RXNormDisplayNamesResponse {
  displayTermsList: {
    term: string[];
  };
}

interface SearchResult {
  medications: Medication[];
  source: 'memory' | 'indexeddb' | 'api' | 'fallback';
  searchTime: number;
  query: string;
  timestamp: number;
}

interface SearchOptions {
  limit?: number;
  fuzzyMatch?: boolean;
  includeGenerics?: boolean;
  signal?: AbortSignal;
}

interface MedicationPurpose {
  className: string;
  classType: string;
  rela: string; // may_treat or may_prevent
}
```

### Cache Types

```typescript
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
  hitCount: number;
}

interface CacheStats {
  entryCount: number;
  sizeBytes: number;
  hitRate: number;
  oldestEntry: Date | null;
  newestEntry: Date | null;
  evictionCount: number;
}

interface CacheConfig {
  maxMemoryEntries: number;
  memoryTTL: number; // milliseconds
  maxIndexedDBSize: number; // bytes
  indexedDBTTL: number; // milliseconds
  evictionPolicy: 'lru' | 'lfu' | 'fifo';
}
```

### Dropdown Types

```typescript
enum HighlightType {
  None = 'none',
  TypedMatch = 'typed-match',      // Item matches typed text
  Navigation = 'navigation',        // Item selected via arrow keys
  Both = 'both'                     // Item is both typed match AND navigated to
}

type InteractionMode = 'idle' | 'typing' | 'navigating';

type SelectionMethod = 'keyboard' | 'mouse';

interface UseDropdownHighlightingOptions<T> {
  items: T[];
  getItemText: (item: T) => string;
  inputValue: string;
  enabled?: boolean;
  onNavigate?: (index: number) => void;
  onSelect?: (item: T, method: SelectionMethod) => void;
}

interface UseDropdownHighlightingResult<T> {
  // State
  interactionMode: InteractionMode;
  navigationIndex: number;
  typedPrefix: string;
  
  // Highlight determination
  getItemHighlightType: (item: T, index: number) => HighlightType;
  isItemHighlighted: (item: T, index: number) => boolean;
  
  // Event handlers
  handleArrowKey: (direction: 'up' | 'down' | 'home' | 'end') => void;
  handleTextInput: (value: string) => void;
  handleMouseEnter: (index: number) => void;
  handleSelect: (item: T, method: SelectionMethod) => void;
  
  // Utilities
  reset: () => void;
  getHighlightedItem: () => T | undefined;
}
```

### HTTP and Circuit Breaker Types

```typescript
type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeout: number;
  halfOpenRequests: number;
  monitoringPeriod: number;
}

interface HttpRequestConfig {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  signal?: AbortSignal;
}

interface HealthStatus {
  isOnline: boolean;
  lastSuccessTime: Date | null;
  lastFailureTime: Date | null;
  failureCount: number;
  successRate: number;
  averageResponseTime: number;
}
```

### RXNorm API Types

```typescript
interface ControlledStatus {
  isControlled: boolean;
  scheduleClass?: string; // DEA Schedule I-V
  error?: string;
}

interface PsychotropicStatus {
  isPsychotropic: boolean;
  atcCodes?: string[];
  category?: string; // e.g., "Anxiolytic", "Antipsychotic", "Antidepressant"
  error?: string;
}

interface RXNormRelationsResponse {
  relatedGroup?: {
    conceptGroup?: Array<{
      tty?: string;
      conceptProperties?: Array<{
        rxcui?: string;
        name?: string;
        synonym?: string;
        tty?: string;
        language?: string;
        suppress?: string;
        umlscui?: string;
      }>;
    }>;
  };
}

interface RXNormClassResponse {
  rxclassDrugInfoList?: {
    rxclassDrugInfo?: Array<{
      minConcept?: {
        rxcui?: string;
        name?: string;
        tty?: string;
      };
      rxclassMinConceptItem?: {
        classId?: string;
        className?: string;
        classType?: string;
      };
      rela?: string;
      relaSource?: string;
    }>;
  };
}
```

## Best Practices

### Type Definition Guidelines

1. **Use Interfaces for Object Shapes**: Prefer interfaces over types for object definitions
2. **Generic Types for Reusability**: Use generics for common patterns
3. **Strict Typing**: Avoid `any` - use `unknown` or specific unions instead
4. **Optional vs Required**: Be explicit about optional properties with `?`
5. **Documentation**: Include JSDoc comments for complex types

### Naming Conventions

- **Interfaces**: PascalCase with descriptive names (e.g., `MedicationFormProps`)
- **Types**: PascalCase for type aliases (e.g., `ChangeHandler<T>`)
- **Enums**: PascalCase with UPPER_CASE values (e.g., `MedicationCategory.CARDIOVASCULAR`)

## Related Documentation

- [Component Documentation](../components/)
- [API Documentation](./README.md)
- [Architecture Overview](../architecture/overview.md)
