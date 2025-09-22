# Card

## Overview

The Card component provides a flexible container for grouping related content with consistent styling and layout. It consists of multiple composable sub-components that work together to create structured, accessible content blocks.

## Props Interface

```typescript
interface CardProps extends React.ComponentProps<"div"> {
  className?: string;
  children: React.ReactNode;
}

interface CardHeaderProps extends React.ComponentProps<"div"> {
  className?: string;
  children: React.ReactNode;
}

interface CardTitleProps extends React.ComponentProps<"div"> {
  className?: string;
  children: React.ReactNode;
}

interface CardDescriptionProps extends React.ComponentProps<"div"> {
  className?: string;
  children: React.ReactNode;
}

interface CardActionProps extends React.ComponentProps<"div"> {
  className?: string;
  children: React.ReactNode;
}

interface CardContentProps extends React.ComponentProps<"div"> {
  className?: string;
  children: React.ReactNode;
}

interface CardFooterProps extends React.ComponentProps<"div"> {
  className?: string;
  children: React.ReactNode;
}
```

## Usage Examples

### Basic Card

```tsx
import { 
  Card, 
  CardHeader, 
  CardTitle, 
  CardDescription, 
  CardContent 
} from '@/components/ui/card';

function BasicCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Card Title</CardTitle>
        <CardDescription>
          A brief description of the card content
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p>This is the main content area of the card.</p>
      </CardContent>
    </Card>
  );
}
```

### Card with Actions

```tsx
import { Button } from '@/components/ui/button';

function CardWithActions() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Project Status</CardTitle>
        <CardDescription>
          Current progress and next steps
        </CardDescription>
        <CardAction>
          <Button variant="outline" size="sm">
            Edit
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <p>Project is 75% complete</p>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div className="bg-primary h-2 rounded-full" style={{ width: '75%' }}></div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

### Card with Footer

```tsx
function CardWithFooter() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Medication Details</CardTitle>
        <CardDescription>
          Information about prescribed medication
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <p><strong>Name:</strong> Lisinopril</p>
          <p><strong>Dosage:</strong> 10mg daily</p>
          <p><strong>Instructions:</strong> Take with food</p>
        </div>
      </CardContent>
      <CardFooter>
        <Button variant="outline" className="mr-2">
          Edit
        </Button>
        <Button>
          Save Changes
        </Button>
      </CardFooter>
    </Card>
  );
}
```

### Interactive Card

```tsx
function InteractiveCard() {
  const [selected, setSelected] = useState(false);

  return (
    <Card 
      className={`cursor-pointer transition-colors ${
        selected ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
      }`}
      onClick={() => setSelected(!selected)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setSelected(!selected);
        }
      }}
      aria-pressed={selected}
    >
      <CardHeader>
        <CardTitle>Selectable Option</CardTitle>
        <CardDescription>
          Click to select this option
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p>This card can be selected and responds to both mouse and keyboard input.</p>
      </CardContent>
    </Card>
  );
}
```

### Grid Layout

```tsx
function CardGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {items.map((item) => (
        <Card key={item.id}>
          <CardHeader>
            <CardTitle>{item.title}</CardTitle>
            <CardDescription>{item.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <p>{item.content}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

## Accessibility

### WCAG 2.1 Level AA Compliance

- **Keyboard Navigation**: 
  - Interactive cards should include `tabIndex={0}`
  - Handle Enter and Space key events for activation
  - Focus indicators for keyboard users

- **ARIA Attributes**:
  - `role="button"` for clickable cards
  - `aria-pressed` for toggle states
  - `aria-label` or `aria-labelledby` for context
  - `aria-describedby` for additional descriptions

- **Semantic Structure**:
  - CardTitle uses `<h4>` for proper heading hierarchy
  - CardDescription uses `<p>` for semantic content
  - Logical content organization

### Screen Reader Support

- Proper heading hierarchy with CardTitle
- Descriptive content in CardDescription
- Interactive states announced appropriately
- Clear content structure and navigation

### Best Practices

```tsx
// ✅ Good: Proper heading hierarchy
<Card>
  <CardHeader>
    <CardTitle>Level 4 Heading</CardTitle>  {/* h4 element */}
    <CardDescription>Supporting description</CardDescription>
  </CardHeader>
</Card>

// ✅ Good: Interactive card with accessibility
<Card 
  role="button"
  tabIndex={0}
  onKeyDown={handleKeyDown}
  aria-label="Select medication option"
>

// ✅ Good: Action button placement
<CardHeader>
  <CardTitle>Title</CardTitle>
  <CardDescription>Description</CardDescription>
  <CardAction>
    <Button aria-label="Edit card content">Edit</Button>
  </CardAction>
</CardHeader>

// ❌ Avoid: Missing keyboard support for interactive cards
<Card onClick={handleClick}>  // No keyboard support

// ❌ Avoid: Wrong heading level
<CardTitle as="h1">  // Should maintain h4 hierarchy
```

## Styling

### CSS Classes

#### Card (Container)
- **Layout**: `flex flex-col gap-6 rounded-xl border`
- **Theme**: `bg-card text-card-foreground`

#### CardHeader
- **Layout**: `@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5`
- **Spacing**: `px-6 pt-6 has-data-[slot=card-action]:grid-cols-[1fr_auto]`
- **Conditional**: `[.border-b]:pb-6` (adds bottom padding when border present)

#### CardTitle
- **Typography**: `leading-none`
- **Element**: Renders as `<h4>` for semantic hierarchy

#### CardDescription
- **Theme**: `text-muted-foreground`
- **Element**: Renders as `<p>` for semantic content

#### CardAction
- **Grid**: `col-start-2 row-span-2 row-start-1 self-start justify-self-end`
- **Positioning**: Automatically positions in header grid

#### CardContent
- **Spacing**: `px-6 [&:last-child]:pb-6`
- **Conditional**: Bottom padding only if last child

#### CardFooter
- **Layout**: `flex items-center`
- **Spacing**: `px-6 pb-6 [.border-t]:pt-6`
- **Conditional**: Top padding only when border present

### Customization

```tsx
// Custom card styling
<Card className="max-w-md mx-auto shadow-lg">

// Custom header with border
<CardHeader className="border-b">

// Custom footer with border
<CardFooter className="border-t">

// Compact card
<Card className="gap-4">
  <CardHeader className="px-4 pt-4">
  <CardContent className="px-4 pb-4">

// Full-width action
<CardAction className="col-span-2 justify-self-stretch">
```

## Implementation Notes

### Design Patterns

- **Composition Pattern**: Multiple components work together
- **Container Queries**: Header uses `@container/card-header` for responsive behavior
- **Grid Layout**: Header automatically handles action button positioning
- **Conditional Styling**: Spacing adapts based on content presence

### Dependencies

- `./utils`: Utility function for className merging (`cn`)
- Uses CSS Grid for flexible header layout
- Container queries for responsive design

### Layout System

The Card uses a sophisticated grid system in the header:
- Title and description stack in first column
- Action button spans full height in second column
- Automatic grid columns when action is present
- Self-adjusting spacing and alignment

## Testing

### Unit Tests

Located in `src/components/ui/__tests__/card.test.tsx`:
- Component composition and rendering
- Conditional styling application
- Grid layout behavior with/without actions
- Accessibility attribute handling

### E2E Tests

Covered in content display and interaction tests:
- Card selection and interaction
- Keyboard navigation through card content
- Focus management in card grids
- Screen reader compatibility

## Related Components

- **Button**: Common in CardAction and CardFooter
- **Badge**: Often used in CardHeader for status
- **Avatar**: Common in CardHeader for user identification
- **Progress**: Frequently used in CardContent
- **Dialog**: Cards often trigger modal dialogs

## Common Patterns

### Data Display Card

```tsx
interface DataCardProps {
  title: string;
  description?: string;
  data: Record<string, any>;
  actions?: React.ReactNode;
}

function DataCard({ title, description, data, actions }: DataCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {actions && <CardAction>{actions}</CardAction>}
      </CardHeader>
      <CardContent>
        <dl className="space-y-2">
          {Object.entries(data).map(([key, value]) => (
            <div key={key} className="flex justify-between">
              <dt className="font-medium">{key}:</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
```

### Status Card

```tsx
function StatusCard({ status, message, timestamp, actions }) {
  const statusColors = {
    success: 'text-green-600 bg-green-50',
    warning: 'text-yellow-600 bg-yellow-50',
    error: 'text-red-600 bg-red-50',
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <div className={`px-2 py-1 rounded-full text-xs ${statusColors[status]}`}>
            {status.toUpperCase()}
          </div>
          System Status
        </CardTitle>
        <CardDescription>
          Last updated: {new Date(timestamp).toLocaleString()}
        </CardDescription>
        {actions && <CardAction>{actions}</CardAction>}
      </CardHeader>
      <CardContent>
        <p>{message}</p>
      </CardContent>
    </Card>
  );
}
```

## Changelog

- **v1.0.0**: Initial implementation with basic components
- **v1.1.0**: Added CardAction component and grid layout
- **v1.2.0**: Enhanced spacing system with conditional padding
- **v1.3.0**: Added container queries for responsive header layout
- **v1.4.0**: Improved semantic HTML with proper heading elements