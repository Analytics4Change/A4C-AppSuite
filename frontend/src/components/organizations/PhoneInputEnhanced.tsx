import { forwardRef, useCallback, type ComponentPropsWithoutRef } from "react";
import * as Select from "@radix-ui/react-select";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PhoneFormData } from "@/types/organization.types";
import { formatPhone } from "@/utils/organization-validation";

/**
 * PhoneInputEnhanced - Phone information input component with label and type classification
 *
 * Features:
 * - Label field (user-defined phone identifier)
 * - Type dropdown (Mobile, Office, Fax, Emergency)
 * - Phone number with auto-formatting (XXX) XXX-XXXX
 * - Extension field (optional)
 * - Full keyboard navigation support
 * - WCAG 2.1 Level AA compliant
 *
 * @example
 * ```tsx
 * <PhoneInputEnhanced
 *   value={generalPhone}
 *   onChange={(phone) => viewModel.setGeneralPhone(phone)}
 *   disabled={false}
 * />
 * ```
 */

interface PhoneInputEnhancedProps extends Omit<ComponentPropsWithoutRef<"div">, "onChange"> {
  value: PhoneFormData;
  onChange: (phone: PhoneFormData) => void;
  disabled?: boolean;
}

const PHONE_TYPES = [
  { value: "mobile", label: "Mobile" },
  { value: "office", label: "Office" },
  { value: "fax", label: "Fax" },
  { value: "emergency", label: "Emergency" },
] as const;

export const PhoneInputEnhanced = forwardRef<HTMLDivElement, PhoneInputEnhancedProps>(
  ({ value, onChange, disabled = false, className, ...props }, ref) => {
    const handleChange = (field: keyof PhoneFormData, newValue: string) => {
      onChange({ ...value, [field]: newValue });
    };

    const handlePhoneChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const formatted = formatPhone(e.target.value);
        onChange({ ...value, number: formatted });
      },
      [onChange, value]
    );

    const handlePhoneBlur = useCallback(() => {
      const formatted = formatPhone(value.number);
      if (formatted !== value.number) {
        onChange({ ...value, number: formatted });
      }
    }, [value, onChange]);

    return (
      <div ref={ref} className={cn(className)} {...props}>
        <div className="bg-white shadow rounded-lg p-6">
          <div className="space-y-3">
            {/* Phone Label */}
            <div className="grid grid-cols-[160px_1fr] items-start gap-4">
              <label className="block text-sm font-medium text-gray-700">
                Phone Label<span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={value.label}
                onChange={(e) => handleChange("label", e.target.value)}
                disabled={disabled}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                aria-label="Phone label"
                aria-required="true"
              />
            </div>

            {/* Phone Type Dropdown */}
            <div className="grid grid-cols-[160px_1fr] items-center gap-4">
              <label className="block text-sm font-medium text-gray-700">
                Phone Type<span className="text-red-500">*</span>
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
                  aria-label="Phone type"
                  aria-required="true"
                >
                  <Select.Value />
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
                      {PHONE_TYPES.map((type) => (
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

            {/* Phone Number */}
            <div className="grid grid-cols-[160px_1fr] items-start gap-4">
              <label className="block text-sm font-medium text-gray-700">
                Phone Number<span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                value={value.number}
                onChange={handlePhoneChange}
                onBlur={handlePhoneBlur}
                disabled={disabled}
                maxLength={14}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                aria-label="Phone number"
                aria-required="true"
              />
            </div>

            {/* Extension (Optional) */}
            <div className="grid grid-cols-[160px_1fr] items-start gap-4">
              <label className="block text-sm font-medium text-gray-700">
                Extension
              </label>
              <input
                type="text"
                value={value.extension || ""}
                onChange={(e) => handleChange("extension", e.target.value)}
                disabled={disabled}
                maxLength={10}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                aria-label="Phone extension (optional)"
              />
            </div>
          </div>
        </div>
      </div>
    );
  }
);

PhoneInputEnhanced.displayName = "PhoneInputEnhanced";
