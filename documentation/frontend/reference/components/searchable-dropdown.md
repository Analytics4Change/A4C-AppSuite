# SearchableDropdown

## Overview

The SearchableDropdown component provides a searchable selection interface for large datasets. It combines real-time search with debouncing, async data loading, and highlighted search matches to create an efficient user experience for medication search and similar use cases.

## Props Interface

```typescript
interface SearchableDropdownProps<T> {
  // Current state
  value: string;
  selectedItem?: T;
  searchResults: T[];
  isLoading: boolean;
  showDropdown: boolean;

  // Search configuration
  onSearch: (query: string) => void;
  onSelect: (item: T, method: SelectionMethod) => void;
  onClear: () => void;
  minSearchLength?: number;
  debounceMs?: number;

  // Display configuration
  placeholder?: string;
  error?: string;

  // Rendering functions
  renderItem: (item: T, index: number, isHighlighted: boolean) => React.ReactNode;
  renderSelectedItem?: (item: T) => React.ReactNode;
  getItemKey: (item: T, index: number) => string | number;
  getItemText?: (item: T) => string; // For auto-select matching

  // Styling
  className?: string;
  dropdownClassName?: string;
  inputClassName?: string;

  // Callbacks
  onFieldComplete?: () => void;
  onDropdownOpen?: (elementId: string) => void;

  // IDs and labels
  inputId?: string;
  dropdownId?: string;
  label?: string;
  required?: boolean;
  tabIndex?: number;
  autoFocus?: boolean;
}

// Selection method indicates how item was selected
type SelectionMethod = 'click' | 'enter' | 'tab';
```

### Prop Details

**State Props (required):**
- `value`: Current search input value
- `searchResults`: Array of search results to display
- `isLoading`: Whether search is in progress
- `showDropdown`: Whether dropdown is visible

**State Props (optional):**
- `selectedItem`: Currently selected item (for displaying selected state)

**Callbacks (required):**
- `onSearch`: Called when user types (after debounce)
- `onSelect`: Called when item selected, includes selection method
- `onClear`: Called when selection is cleared
- `renderItem`: Render function for each result item (receives item, index, isHighlighted)
- `getItemKey`: Generate unique key for each item

**Callbacks (optional):**
- `renderSelectedItem`: Custom rendering for selected item display
- `getItemText`: Extract text from item for auto-select matching
- `onFieldComplete`: Called when user completes interaction (e.g., Tab key)
- `onDropdownOpen`: Called when dropdown opens with element ID

**Configuration:**
- `minSearchLength`: Minimum characters before search (default: 1)
- `debounceMs`: Debounce delay in milliseconds (default: 300)
- `placeholder`: Input placeholder text
- `error`: Error message to display

**Styling:**
- `className`: CSS class for container
- `dropdownClassName`: CSS class for dropdown
- `inputClassName`: CSS class for input field

**Accessibility:**
- `inputId`: ID for the input element
- `dropdownId`: ID for the dropdown element
- `label`: Visible label text
- `required`: Whether field is required
- `tabIndex`: Custom tab index
- `autoFocus`: Auto-focus input on mount

## Usage Examples

### Basic Medication Search

```tsx
import { SearchableDropdown } from '@/components/ui/searchable-dropdown';

function MedicationSearch() {
  const [searchValue, setSearchValue] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (query: string) => {
    if (query.length >= 2) {
      setLoading(true);
      try {
        const medications = await medicationApi.search(query);
        setResults(medications);
      } catch (error) {
        console.error('Search failed:', error);
      } finally {
        setLoading(false);
      }
    } else {
      setResults([]);
    }
  };

  const handleSelect = (medication: Medication) => {
    setSearchValue(medication.name);
    // Handle medication selection
  };

  return (
    <SearchableDropdown
      value={searchValue}
      searchResults={results}
      onSearch={handleSearch}
      onSelect={handleSelect}
      loading={loading}
      placeholder="Search medications..."
      renderItem={(medication) => (
        <div className="flex flex-col">
          <span className="font-medium">{medication.name}</span>
          <span className="text-sm text-muted-foreground">
            {medication.strength} - {medication.form}
          </span>
        </div>
      )}
      aria-label="Search for medications"
    />
  );
}
```

### Client Search with Custom Rendering

```tsx
function ClientSearch() {
  const [searchValue, setSearchValue] = useState('');
  const [clients, setClients] = useState([]);

  return (
    <SearchableDropdown
      value={searchValue}
      searchResults={clients}
      onSearch={(query) => {
        // Search implementation
        searchClients(query).then(setClients);
      }}
      onSelect={(client) => {
        setSearchValue(`${client.firstName} ${client.lastName}`);
        onClientSelect(client);
      }}
      renderItem={(client) => (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            {client.firstName[0]}{client.lastName[0]}
          </div>
          <div>
            <div className="font-medium">
              {client.firstName} {client.lastName}
            </div>
            <div className="text-sm text-muted-foreground">
              DOB: {formatDate(client.dateOfBirth)}
            </div>
          </div>
        </div>
      )}
      placeholder="Search clients..."
      minSearchLength={2}
      aria-label="Search for clients"
    />
  );
}
```

### With Error Handling

```tsx
function SearchWithErrorHandling() {
  const [error, setError] = useState('');

  const handleSearch = async (query: string) => {
    try {
      setError('');
      const results = await api.search(query);
      setResults(results);
    } catch (err) {
      setError('Search failed. Please try again.');
      setResults([]);
    }
  };

  return (
    <div>
      <SearchableDropdown
        value={searchValue}
        searchResults={results}
        onSearch={handleSearch}
        onSelect={handleSelect}
        error={error}
        renderItem={(item) => <div>{item.name}</div>}
        aria-describedby={error ? 'search-error' : undefined}
      />
      {error && (
        <div id="search-error" role="alert" className="text-sm text-destructive mt-1">
          {error}
        </div>
      )}
    </div>
  );
}
```

### Controlled with External State

```tsx
function ControlledSearch() {
  const { 
    searchValue, 
    setSearchValue,
    results, 
    loading, 
    error,
    search 
  } = useMedicationSearch();

  return (
    <SearchableDropdown
      value={searchValue}
      searchResults={results}
      onSearch={search}
      onSelect={(medication) => {
        setSearchValue(medication.name);
        // Additional selection logic
      }}
      loading={loading}
      error={error}
      renderItem={(medication) => (
        <MedicationListItem medication={medication} />
      )}
      placeholder="Type to search medications..."
      debounceMs={300}
      maxResults={50}
    />
  );
}
```

## Accessibility

### WCAG 2.1 Level AA Compliance

- **Keyboard Navigation**:
  - Tab to focus the search input
  - Arrow keys to navigate through results
  - Enter to select highlighted result
  - Escape to close dropdown and clear selection

- **ARIA Attributes**:
  - `role="combobox"` on search input
  - `aria-expanded` indicates dropdown state
  - `aria-autocomplete="list"` for search behavior
  - `aria-activedescendant` for highlighted option
  - `aria-label` or `aria-labelledby` for context
  - `aria-describedby` for error messages or help text

- **Focus Management**:
  - Clear focus indicators on input and options
  - Focus returns to input after selection
  - Proper focus trapping within dropdown

### Screen Reader Support

- Search input purpose is clearly announced
- Number of results is communicated
- Selected item is announced on selection
- Loading and error states are announced
- Search suggestions are properly listed

### Implementation Pattern

```tsx
function AccessibleSearchableDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const inputId = useId();

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={inputId}
        role="combobox"
        aria-expanded={isOpen}
        aria-autocomplete="list"
        aria-controls={isOpen ? listboxId : undefined}
        aria-activedescendant={
          highlightedIndex >= 0 ? `option-${highlightedIndex}` : undefined
        }
        aria-label="Search medications"
        // ... other props
      />
      
      {isOpen && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Search results"
        >
          {results.map((item, index) => (
            <li
              key={item.id}
              id={`option-${index}`}
              role="option"
              aria-selected={index === highlightedIndex}
              // ... other props
            >
              {renderItem(item)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

## Styling

### CSS Classes

- **Container**: `relative w-full`
- **Input**: Standard Input component styling with combobox enhancements
- **Dropdown**: `absolute top-full left-0 right-0 z-50 bg-popover border rounded-md shadow-lg`
- **Results List**: `max-h-60 overflow-auto`
- **Result Item**: `px-3 py-2 cursor-pointer hover:bg-accent`
- **Highlighted**: `bg-accent text-accent-foreground`
- **Loading**: `flex items-center justify-center py-4`
- **No Results**: `py-4 text-center text-muted-foreground`

### Highlighting System

The component uses the unified highlighting system from `useDropdownHighlighting`:

- **Typing Mode**: Multiple blue highlights for items starting with typed text
- **Navigation Mode**: Single box-shadow highlight for arrow-selected item
- **Combined Mode**: Both highlights when navigating to a typed match

### Customization

```tsx
// Custom dropdown styling
<SearchableDropdown
  className="w-96"
  dropdownClassName="max-h-40 border-2 border-primary"
  itemClassName="py-3 px-4"
/>

// Custom loading indicator
<SearchableDropdown
  loading={loading}
  loadingComponent={<CustomSpinner />}
/>

// Custom empty state
<SearchableDropdown
  emptyComponent={
    <div className="py-6 text-center">
      <SearchIcon className="mx-auto h-12 w-12 text-muted-foreground" />
      <p className="mt-2 text-sm text-muted-foreground">
        No medications found
      </p>
    </div>
  }
/>
```

## Implementation Notes

### Design Patterns

- **Controlled Component**: Requires external state management
- **Async Search**: Built for async data loading with proper loading states
- **Debouncing**: Uses centralized timing configuration
- **Flexible Rendering**: Custom item rendering via render prop
- **Unified Highlighting**: Consistent with other dropdown components

### Performance Optimizations

- **Debounced Search**: Prevents excessive API calls
- **Virtual Scrolling**: For very large result sets (optional)
- **Memoized Rendering**: Optimized re-renders for large lists
- **Cached Results**: Optional caching for repeated searches

### Dependencies

- `useDropdownHighlighting`: Unified highlighting behavior
- `useSearchDebounce`: Centralized debouncing logic
- `Input`: Base input component
- Search-related utilities and types

### Search Integration

```typescript
// Custom hook for search logic
function useSearchableDropdown<T>({
  searchFn,
  debounceMs = 300,
  minLength = 2
}: {
  searchFn: (query: string) => Promise<T[]>;
  debounceMs?: number;
  minLength?: number;
}) {
  const [results, setResults] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debouncedSearch = useCallback(
    debounce(async (query: string) => {
      if (query.length < minLength) {
        setResults([]);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const searchResults = await searchFn(query);
        setResults(searchResults);
      } catch (err) {
        setError('Search failed');
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, debounceMs),
    [searchFn, debounceMs, minLength]
  );

  return {
    results,
    loading,
    error,
    search: debouncedSearch
  };
}
```

## Testing

### Unit Tests

Located in `src/components/ui/__tests__/searchable-dropdown.test.tsx`:

- Search input and debouncing
- Result rendering and selection
- Keyboard navigation
- Loading and error states
- Accessibility attributes

### E2E Tests

Covered in medication search and form tests:

- Full search workflow
- Keyboard-only interaction
- Screen reader compatibility
- Error handling scenarios

## Related Components

- **Input**: Base component for search input
- **EnhancedAutocompleteDropdown**: Similar functionality with different use cases
- **MultiSelectDropdown**: Multi-selection variant
- **Combobox**: Alternative implementation pattern

## Common Integration Patterns

### With Form Libraries

```tsx
// React Hook Form integration
function SearchField({ name, control, rules, ...props }) {
  return (
    <Controller
      name={name}
      control={control}
      rules={rules}
      render={({ field, fieldState }) => (
        <SearchableDropdown
          {...field}
          {...props}
          error={fieldState.error?.message}
          aria-invalid={fieldState.invalid}
        />
      )}
    />
  );
}
```

### With State Management

```tsx
// MobX integration
const SearchViewModel = observer(() => {
  const viewModel = useMedicationSearchViewModel();

  return (
    <SearchableDropdown
      value={viewModel.searchQuery}
      searchResults={viewModel.results}
      onSearch={viewModel.search}
      onSelect={viewModel.selectMedication}
      loading={viewModel.isLoading}
      error={viewModel.error}
      renderItem={(medication) => (
        <MedicationItem medication={medication} />
      )}
    />
  );
});
```

## Changelog

- **v1.0.0**: Initial implementation with basic search
- **v1.1.0**: Added debouncing and async loading support
- **v1.2.0**: Integrated unified highlighting system
- **v1.3.0**: Enhanced accessibility with proper ARIA attributes
- **v1.4.0**: Added error handling and loading states
- **v1.5.0**: Performance optimizations for large datasets
