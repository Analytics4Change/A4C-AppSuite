import { forwardRef, type ComponentPropsWithoutRef } from "react";
import * as Select from "@radix-ui/react-select";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AddressFormData } from "@/types/organization.types";

/**
 * AddressInput - Address information input component with label and type classification
 *
 * Features:
 * - Label field (user-defined address identifier)
 * - Type dropdown (Physical, Mailing, Billing)
 * - Street 1 (required), Street 2 (optional)
 * - City, State, Zip Code (required)
 * - Full keyboard navigation support
 * - WCAG 2.1 Level AA compliant
 *
 * @example
 * ```tsx
 * <AddressInput
 *   value={generalAddress}
 *   onChange={(address) => viewModel.setGeneralAddress(address)}
 *   disabled={false}
 * />
 * ```
 */

interface AddressInputProps extends Omit<ComponentPropsWithoutRef<"div">, "onChange"> {
  value: AddressFormData;
  onChange: (address: AddressFormData) => void;
  disabled?: boolean;
}

const ADDRESS_TYPES = [
  { value: "physical", label: "Physical" },
  { value: "mailing", label: "Mailing" },
  { value: "billing", label: "Billing" },
] as const;

export const AddressInput = forwardRef<HTMLDivElement, AddressInputProps>(
  ({ value, onChange, disabled = false, className, ...props }, ref) => {
    const handleChange = (field: keyof AddressFormData, newValue: string) => {
      onChange({ ...value, [field]: newValue });
    };

    return (
      <div ref={ref} className={cn(className)} {...props}>
        <div className="bg-white shadow rounded-lg p-6">
          <div className="space-y-3">
            {/* Address Label */}
            <div className="grid grid-cols-[160px_1fr] items-start gap-4">
              <label className="block text-sm font-medium text-gray-700">
                Address Label<span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={value.label}
                onChange={(e) => handleChange("label", e.target.value)}
                disabled={disabled}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                aria-label="Address label"
                aria-required="true"
              />
            </div>

            {/* Address Type Dropdown */}
            <div className="grid grid-cols-[160px_1fr] items-center gap-4">
              <label className="block text-sm font-medium text-gray-700">
                Address Type<span className="text-red-500">*</span>
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
                  aria-label="Address type"
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
                      {ADDRESS_TYPES.map((type) => (
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

            {/* Street Address Line 1 */}
            <div className="grid grid-cols-[160px_1fr] items-start gap-4">
              <label className="block text-sm font-medium text-gray-700">
                Street Line 1<span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={value.street1}
                onChange={(e) => handleChange("street1", e.target.value)}
                disabled={disabled}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                aria-label="Street address line 1"
                aria-required="true"
              />
            </div>

            {/* Street Address Line 2 (Optional) */}
            <div className="grid grid-cols-[160px_1fr] items-start gap-4">
              <label className="block text-sm font-medium text-gray-700">
                Street Line 2
              </label>
              <input
                type="text"
                value={value.street2 || ""}
                onChange={(e) => handleChange("street2", e.target.value)}
                disabled={disabled}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                aria-label="Street address line 2 (optional)"
              />
            </div>

            {/* City */}
            <div className="grid grid-cols-[160px_1fr] items-start gap-4">
              <label className="block text-sm font-medium text-gray-700">
                City<span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={value.city}
                onChange={(e) => handleChange("city", e.target.value)}
                disabled={disabled}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                aria-label="City"
                aria-required="true"
              />
            </div>

            {/* State */}
            <div className="grid grid-cols-[160px_1fr] items-start gap-4">
              <label className="block text-sm font-medium text-gray-700">
                State<span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={value.state}
                onChange={(e) => handleChange("state", e.target.value)}
                disabled={disabled}
                maxLength={2}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                aria-label="State (2-letter abbreviation)"
                aria-required="true"
              />
            </div>

            {/* Zip Code */}
            <div className="grid grid-cols-[160px_1fr] items-start gap-4">
              <label className="block text-sm font-medium text-gray-700">
                Zip Code<span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={value.zipCode}
                onChange={(e) => handleChange("zipCode", e.target.value)}
                disabled={disabled}
                maxLength={10}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                aria-label="Zip code"
                aria-required="true"
              />
            </div>
          </div>
        </div>
      </div>
    );
  }
);

AddressInput.displayName = "AddressInput";
