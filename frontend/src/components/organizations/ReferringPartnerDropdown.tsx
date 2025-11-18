import { forwardRef, useEffect, useState, type ComponentPropsWithoutRef } from "react";
import { observer } from "mobx-react-lite";
import * as Select from "@radix-ui/react-select";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { getOrganizationQueryService } from "@/services/organization/OrganizationQueryServiceFactory";
import type { Organization } from "@/types/organization.types";

/**
 * ReferringPartnerDropdown - Dropdown for selecting VAR partner who referred this organization
 *
 * Features:
 * - Fetches activated VAR partners via Part A API
 * - "Not Applicable" default option
 * - Filters: type='provider_partner' AND partner_type='var' AND status='active'
 * - Full keyboard navigation support
 * - WCAG 2.1 Level AA compliant
 * - MobX observer for reactive updates
 *
 * @example
 * ```tsx
 * <ReferringPartnerDropdown
 *   value={viewModel.referringPartnerId}
 *   onChange={(partnerId) => viewModel.setReferringPartnerId(partnerId)}
 *   disabled={false}
 * />
 * ```
 */

interface ReferringPartnerDropdownProps extends Omit<ComponentPropsWithoutRef<"div">, "onChange"> {
  value?: string; // Partner org ID or undefined
  onChange: (partnerId: string | undefined) => void;
  disabled?: boolean;
}

export const ReferringPartnerDropdown = observer(
  forwardRef<HTMLDivElement, ReferringPartnerDropdownProps>(
    ({ value, onChange, disabled = false, className, ...props }, ref) => {
      const [varPartners, setVarPartners] = useState<Organization[]>([]);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState<string | null>(null);

      // Fetch VAR partners on mount
      useEffect(() => {
        const fetchVarPartners = async () => {
          try {
            setLoading(true);
            setError(null);

            const orgService = getOrganizationQueryService();
            const partners = await orgService.getOrganizations({
              type: 'provider_partner',
              partnerType: 'var',
              status: 'active',
            });

            setVarPartners(partners);
          } catch (err) {
            console.error('[ReferringPartnerDropdown] Failed to fetch VAR partners:', err);
            setError('Failed to load partners');
          } finally {
            setLoading(false);
          }
        };

        fetchVarPartners();
      }, []);

      const handleValueChange = (newValue: string) => {
        // "none" represents "Not Applicable"
        if (newValue === "none") {
          onChange(undefined);
        } else {
          onChange(newValue);
        }
      };

      return (
        <div ref={ref} className={cn("space-y-2", className)} {...props}>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            Referring Partner
          </label>
          <Select.Root
            value={value || "none"}
            onValueChange={handleValueChange}
            disabled={disabled || loading}
          >
            <Select.Trigger
              className={cn(
                "w-full px-3 py-2 rounded-md border border-input bg-background",
                "flex items-center justify-between",
                "focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent",
                "disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed",
                "transition-colors"
              )}
              aria-label="Referring partner"
              aria-describedby="referring-partner-description"
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
                  {/* Not Applicable Option (Default) */}
                  <Select.Item
                    value="none"
                    className={cn(
                      "relative flex items-center px-8 py-2 rounded-sm",
                      "cursor-pointer select-none outline-none",
                      "hover:bg-accent hover:text-accent-foreground",
                      "focus:bg-accent focus:text-accent-foreground",
                      "data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground"
                    )}
                  >
                    <Select.ItemText>Not Applicable</Select.ItemText>
                  </Select.Item>

                  {/* VAR Partners */}
                  {varPartners.map((partner) => (
                    <Select.Item
                      key={partner.id}
                      value={partner.id}
                      className={cn(
                        "relative flex items-center px-8 py-2 rounded-sm",
                        "cursor-pointer select-none outline-none",
                        "hover:bg-accent hover:text-accent-foreground",
                        "focus:bg-accent focus:text-accent-foreground",
                        "data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground"
                      )}
                    >
                      <Select.ItemText>{partner.display_name || partner.name}</Select.ItemText>
                    </Select.Item>
                  ))}

                  {/* Error State */}
                  {error && (
                    <div className="px-8 py-2 text-sm text-destructive">
                      {error}
                    </div>
                  )}

                  {/* Empty State */}
                  {!loading && varPartners.length === 0 && !error && (
                    <div className="px-8 py-2 text-sm text-muted-foreground">
                      No VAR partners found
                    </div>
                  )}
                </Select.Viewport>
              </Select.Content>
            </Select.Portal>
          </Select.Root>
          <p id="referring-partner-description" className="text-sm text-muted-foreground">
            Select the VAR partner who referred this organization (optional)
          </p>
        </div>
      );
    }
  )
);

ReferringPartnerDropdown.displayName = "ReferringPartnerDropdown";
