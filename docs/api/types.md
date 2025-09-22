# Type Definitions

## Overview

This document describes the core TypeScript types and interfaces used throughout the A4C-FrontEnd application.

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