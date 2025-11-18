import { forwardRef, type ComponentPropsWithoutRef } from "react";
import * as Select from "@radix-ui/react-select";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContactFormData } from "@/types/organization.types";

/**
 * ContactInput - Contact information input component with label and type classification
 *
 * Features:
 * - Label field (user-defined contact identifier)
 * - Type dropdown (Billing, Technical, Emergency, A4C Admin)
 * - First Name, Last Name, Email (required)
 * - Title, Department (optional)
 * - Full keyboard navigation support
 * - WCAG 2.1 Level AA compliant
 *
 * @example
 * ```tsx
 * <ContactInput
 *   value={billingContact}
 *   onChange={(contact) => viewModel.setBillingContact(contact)}
 *   disabled={false}
 * />
 * ```
 */

interface ContactInputProps extends Omit<ComponentPropsWithoutRef<"div">, "onChange"> {
  value: ContactFormData;
  onChange: (contact: ContactFormData) => void;
  disabled?: boolean;
}

const CONTACT_TYPES = [
  { value: "billing", label: "Billing" },
  { value: "technical", label: "Technical" },
  { value: "emergency", label: "Emergency" },
  { value: "a4c_admin", label: "A4C Admin" },
] as const;

export const ContactInput = forwardRef<HTMLDivElement, ContactInputProps>(
  ({ value, onChange, disabled = false, className, ...props }, ref) => {
    const handleChange = (field: keyof ContactFormData, newValue: string) => {
      onChange({ ...value, [field]: newValue });
    };

    return (
      <div ref={ref} className={cn("space-y-3", className)} {...props}>
        {/* Contact Label */}
        <div className="grid grid-cols-[160px_1fr] items-start gap-4">
          <label className="text-foreground text-right text-sm pt-2">
            Contact Label<span className="text-destructive">*</span>:
          </label>
          <input
            type="text"
            value={value.label}
            onChange={(e) => handleChange("label", e.target.value)}
            disabled={disabled}
            placeholder="e.g., Primary Billing Contact"
            className={cn(
              "w-full px-3 py-2 rounded-md border border-input bg-background",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent",
              "disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed",
              "transition-colors"
            )}
            aria-label="Contact label"
            aria-required="true"
          />
        </div>

        {/* Contact Type Dropdown */}
        <div className="grid grid-cols-[160px_1fr] items-center gap-4">
          <label className="text-foreground text-right text-sm">
            Contact Type<span className="text-destructive">*</span>:
          </label>
          <Select.Root
            value={value.type}
            onValueChange={(newType: string) => handleChange("type", newType)}
            disabled={disabled}
          >
            <Select.Trigger
              className={cn(
                "w-full px-3 py-2 rounded-md border border-input bg-background",
                "flex items-center justify-between",
                "focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent",
                "disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed",
                "transition-colors"
              )}
              aria-label="Contact type"
              aria-required="true"
            >
              <Select.Value placeholder="Select type..." />
              <Select.Icon>
                <ChevronDown className="h-4 w-4 opacity-50" />
              </Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Content
                className={cn(
                  "overflow-hidden bg-popover rounded-md border border-border shadow-md",
                  "z-50"
                )}
              >
                <Select.Viewport className="p-1">
                  {CONTACT_TYPES.map((type) => (
                    <Select.Item
                      key={type.value}
                      value={type.value}
                      className={cn(
                        "relative flex items-center px-8 py-2 rounded-sm",
                        "cursor-pointer select-none outline-none",
                        "hover:bg-accent hover:text-accent-foreground",
                        "focus:bg-accent focus:text-accent-foreground",
                        "data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground"
                      )}
                    >
                      <Select.ItemText>{type.label}</Select.ItemText>
                    </Select.Item>
                  ))}
                </Select.Viewport>
              </Select.Content>
            </Select.Portal>
          </Select.Root>
        </div>

        {/* First Name */}
        <div className="grid grid-cols-[160px_1fr] items-start gap-4">
          <label className="text-foreground text-right text-sm pt-2">
            First Name<span className="text-destructive">*</span>:
          </label>
          <input
            type="text"
            value={value.firstName}
            onChange={(e) => handleChange("firstName", e.target.value)}
            disabled={disabled}
            placeholder="First name"
            className={cn(
              "w-full px-3 py-2 rounded-md border border-input bg-background",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent",
              "disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed",
              "transition-colors"
            )}
            aria-label="First name"
            aria-required="true"
          />
        </div>

        {/* Last Name */}
        <div className="grid grid-cols-[160px_1fr] items-start gap-4">
          <label className="text-foreground text-right text-sm pt-2">
            Last Name<span className="text-destructive">*</span>:
          </label>
          <input
            type="text"
            value={value.lastName}
            onChange={(e) => handleChange("lastName", e.target.value)}
            disabled={disabled}
            placeholder="Last name"
            className={cn(
              "w-full px-3 py-2 rounded-md border border-input bg-background",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent",
              "disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed",
              "transition-colors"
            )}
            aria-label="Last name"
            aria-required="true"
          />
        </div>

        {/* Email */}
        <div className="grid grid-cols-[160px_1fr] items-start gap-4">
          <label className="text-foreground text-right text-sm pt-2">
            Email Address<span className="text-destructive">*</span>:
          </label>
          <input
            type="email"
            value={value.email}
            onChange={(e) => handleChange("email", e.target.value)}
            disabled={disabled}
            placeholder="email@example.com"
            className={cn(
              "w-full px-3 py-2 rounded-md border border-input bg-background",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent",
              "disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed",
              "transition-colors"
            )}
            aria-label="Email address"
            aria-required="true"
          />
        </div>

        {/* Title (Optional) */}
        <div className="grid grid-cols-[160px_1fr] items-start gap-4">
          <label className="text-foreground text-right text-sm pt-2">
            Title:
          </label>
          <input
            type="text"
            value={value.title || ""}
            onChange={(e) => handleChange("title", e.target.value)}
            disabled={disabled}
            placeholder="e.g., Billing Manager"
            className={cn(
              "w-full px-3 py-2 rounded-md border border-input bg-background",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent",
              "disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed",
              "transition-colors"
            )}
            aria-label="Job title (optional)"
          />
        </div>

        {/* Department (Optional) */}
        <div className="grid grid-cols-[160px_1fr] items-start gap-4">
          <label className="text-foreground text-right text-sm pt-2">
            Department:
          </label>
          <input
            type="text"
            value={value.department || ""}
            onChange={(e) => handleChange("department", e.target.value)}
            disabled={disabled}
            placeholder="e.g., Finance"
            className={cn(
              "w-full px-3 py-2 rounded-md border border-input bg-background",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent",
              "disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed",
              "transition-colors"
            )}
            aria-label="Department (optional)"
          />
        </div>
      </div>
    );
  }
);

ContactInput.displayName = "ContactInput";
