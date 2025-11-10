# Radix UI Patterns

## Overview

Radix UI provides unstyled, accessible UI primitives for React. This resource covers the most commonly used primitives in the A4C-AppSuite frontend, including Slot, Dialog, DropdownMenu, Select, Tooltip, and Popover.

**Key Benefits:**
- Accessibility built-in (ARIA attributes, keyboard navigation, screen reader support)
- Unstyled (complete styling control with Tailwind)
- Composable compound components
- Focus management handled automatically

## Common Imports

```typescript
import { Slot } from "@radix-ui/react-slot";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Select from "@radix-ui/react-select";
import * as Tooltip from "@radix-ui/react-tooltip";
import * as Popover from "@radix-ui/react-popover";
```

## Slot - Polymorphic Components

The `Slot` component merges props and refs with its child, enabling polymorphic behavior. Use it to create components that can render as different HTML elements.

### Basic Usage

```typescript
import { Slot } from "@radix-ui/react-slot";
import { forwardRef } from "react";

interface ButtonProps extends React.ComponentPropsWithoutRef<"button"> {
  asChild?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp ref={ref} {...props} />;
  }
);

// Usage: Render as button (default)
<Button onClick={handleClick}>Click Me</Button>

// Usage: Render as link
<Button asChild>
  <a href="/medications">View Medications</a>
</Button>
```

### With CVA Variants

```typescript
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground"
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-sm",
        lg: "h-10 px-8",
        icon: "h-9 w-9"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

interface ButtonProps
  extends React.ComponentPropsWithoutRef<"button">,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);

// Usage
<Button variant="destructive" size="lg">Delete</Button>
<Button variant="outline" asChild>
  <Link to="/medications">View All</Link>
</Button>
```

## Dialog - Modal Dialogs

Dialog provides accessible modal dialogs with overlay, focus trapping, and keyboard handling.

### Basic Dialog

```typescript
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => void;
}

export const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  onConfirm
}: ConfirmDialogProps) => {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg">
          <div className="flex flex-col space-y-1.5 text-center sm:text-left">
            <Dialog.Title className="text-lg font-semibold leading-none tracking-tight">
              {title}
            </Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground">
              {description}
            </Dialog.Description>
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
            <Dialog.Close asChild>
              <button className="mt-2 sm:mt-0">Cancel</button>
            </Dialog.Close>
            <button onClick={onConfirm}>Confirm</button>
          </div>
          <Dialog.Close asChild>
            <button
              className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

// Usage
const [isOpen, setIsOpen] = useState(false);

<ConfirmDialog
  open={isOpen}
  onOpenChange={setIsOpen}
  title="Delete Medication"
  description="Are you sure you want to delete this medication? This action cannot be undone."
  onConfirm={handleDelete}
/>
```

### Dialog with Form

```typescript
import * as Dialog from "@radix-ui/react-dialog";
import { useRef, useEffect } from "react";

interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: FormData) => void;
}

export const FormDialog = ({ open, onOpenChange, onSubmit }: FormDialogProps) => {
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus first input when dialog opens
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    onSubmit(formData);
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed left-[50%] top-[50%] z-50 w-full max-w-lg translate-x-[-50%] translate-y-[-50%] border bg-background p-6 shadow-lg sm:rounded-lg">
          <Dialog.Title className="text-lg font-semibold mb-4">
            Add Medication
          </Dialog.Title>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium mb-2">
                Medication Name
              </label>
              <input
                ref={inputRef}
                id="name"
                name="name"
                type="text"
                required
                className="w-full px-3 py-2 border rounded-md"
                aria-required="true"
              />
            </div>
            <div>
              <label htmlFor="dosage" className="block text-sm font-medium mb-2">
                Dosage
              </label>
              <input
                id="dosage"
                name="dosage"
                type="text"
                required
                className="w-full px-3 py-2 border rounded-md"
                aria-required="true"
              />
            </div>
            <div className="flex justify-end space-x-2 pt-4">
              <Dialog.Close asChild>
                <button type="button" className="px-4 py-2">
                  Cancel
                </button>
              </Dialog.Close>
              <button type="submit" className="px-4 py-2">
                Add
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
```

## DropdownMenu - Context Menus

DropdownMenu provides accessible dropdown menus with keyboard navigation.

### Basic DropdownMenu

```typescript
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreVertical, Edit, Trash, Copy } from "lucide-react";

interface ActionsMenuProps {
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export const ActionsMenu = ({ onEdit, onDuplicate, onDelete }: ActionsMenuProps) => {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent"
          aria-label="Open actions menu"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[220px] rounded-md border bg-popover p-1 shadow-md"
          align="end"
          sideOffset={5}
        >
          <DropdownMenu.Item
            className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent focus:bg-accent"
            onSelect={onEdit}
          >
            <Edit className="h-4 w-4" />
            Edit
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent focus:bg-accent"
            onSelect={onDuplicate}
          >
            <Copy className="h-4 w-4" />
            Duplicate
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive outline-none hover:bg-destructive/10 focus:bg-destructive/10"
            onSelect={onDelete}
          >
            <Trash className="h-4 w-4" />
            Delete
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
};
```

### DropdownMenu with Submenu

Use `DropdownMenu.Sub` and `DropdownMenu.SubContent` for nested menus. SubTrigger shows chevron icon automatically with `data-[state=open]` styling.

## Select - Dropdown Selection

Select provides accessible dropdown selection with keyboard navigation and search.

### Basic Select

```typescript
import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

interface SelectOption {
  value: string;
  label: string;
}

interface SimpleSelectProps {
  options: SelectOption[];
  value?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
}

export const SimpleSelect = ({
  options,
  value,
  onValueChange,
  placeholder = "Select option..."
}: SimpleSelectProps) => {
  return (
    <Select.Root value={value} onValueChange={onValueChange}>
      <Select.Trigger
        className="inline-flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="Select option"
      >
        <Select.Value placeholder={placeholder} />
        <Select.Icon>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className="relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"
          position="popper"
          sideOffset={4}
        >
          <Select.ScrollUpButton className="flex cursor-default items-center justify-center py-1">
            <ChevronUp className="h-4 w-4" />
          </Select.ScrollUpButton>
          <Select.Viewport className="p-1">
            {options.map((option) => (
              <Select.Item
                key={option.value}
                value={option.value}
                className="relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
              >
                <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                  <Select.ItemIndicator>
                    <Check className="h-4 w-4" />
                  </Select.ItemIndicator>
                </span>
                <Select.ItemText>{option.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
          <Select.ScrollDownButton className="flex cursor-default items-center justify-center py-1">
            <ChevronDown className="h-4 w-4" />
          </Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
};

// Usage
const [medication, setMedication] = useState<string>();

<SimpleSelect
  options={[
    { value: "aspirin", label: "Aspirin 81mg" },
    { value: "ibuprofen", label: "Ibuprofen 200mg" },
    { value: "acetaminophen", label: "Acetaminophen 500mg" }
  ]}
  value={medication}
  onValueChange={setMedication}
  placeholder="Select medication..."
/>
```

## Tooltip - Hover Information

Tooltip provides accessible tooltips with keyboard support.

### Basic Tooltip

```typescript
import * as Tooltip from "@radix-ui/react-tooltip";
import { Info } from "lucide-react";

export const InfoTooltip = ({ content }: { content: string }) => {
  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            className="inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-accent"
            aria-label="More information"
          >
            <Info className="h-4 w-4" />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="z-50 max-w-xs rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"
            sideOffset={5}
          >
            {content}
            <Tooltip.Arrow className="fill-border" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
};

// Usage
<InfoTooltip content="This medication should be taken with food" />
```

## Popover - Floating Content

Popover provides floating content triggered by user interaction. Similar structure to Dialog but non-modal. Use `Popover.Root`, `Popover.Trigger`, `Popover.Portal`, and `Popover.Content` with `align` and `sideOffset` props for positioning.

## Best Practices

1. **Always use Portal**: Render overlays in portals to avoid z-index issues
2. **Add ARIA labels**: Use `aria-label` or `aria-labelledby` for accessibility
3. **Focus management**: Use `useEffect` with refs for focus control
4. **asChild prop**: Use `asChild` with `Slot` for polymorphic components
5. **Animations**: Use Tailwind `data-[state]` selectors for smooth transitions

## Common Patterns

**Controlled vs Uncontrolled**: Use `open` and `onOpenChange` props for controlled state, or omit for uncontrolled.

**asChild prop**: Renders child element instead of default, merging props and refs. Use for custom triggers and close buttons.
