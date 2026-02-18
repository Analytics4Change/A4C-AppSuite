/**
 * Danger Zone Component
 *
 * Shared component for deactivate/reactivate/delete actions across entity management pages.
 * Provides consistent styling, layout, and accessibility for destructive operations.
 *
 * Features:
 * - Collapsible disclosure panel (collapsed by default, state persists within route)
 * - Deactivate section (active entities only)
 * - Reactivate section (inactive entities only)
 * - Delete section with optional active constraint warning
 * - Render slots for page-specific content (cascade warnings, user counts, etc.)
 * - Consistent styling with red border Card layout
 *
 * Accessibility (WCAG 2.1 Level AA + WAI-ARIA Disclosure Pattern):
 * - Collapsible header: button[aria-expanded] + aria-controls
 * - Enter/Space toggles disclosure via native button semantics
 * - Content panel: role="region" + aria-labelledby
 * - section[aria-labelledby] for landmark navigation
 * - Descriptive button labels including entity type
 * - Loading state communicated via button text
 */

import React, { useState, type ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, Trash2, ChevronDown } from 'lucide-react';
import { cn } from '@/components/ui/utils';

export interface DangerZoneProps {
  /** Display name for buttons: "Deactivate {entityType}" */
  entityType: string;
  /** Controls Deactivate vs Reactivate section visibility */
  isActive: boolean;
  /** Disables all buttons (e.g., form is submitting) */
  isSubmitting?: boolean;

  // --- Deactivate (active entities only) ---
  canDeactivate?: boolean;
  onDeactivate: () => void;
  isDeactivating?: boolean;
  deactivateDescription: string;
  /** Render slot below description (e.g., cascade child count) */
  deactivateSlot?: ReactNode;

  // --- Reactivate (inactive entities only) ---
  canReactivate?: boolean;
  onReactivate: () => void;
  isReactivating?: boolean;
  reactivateDescription: string;
  reactivateSlot?: ReactNode;

  // --- Delete ---
  canDelete?: boolean;
  onDelete: () => void;
  isDeleting?: boolean;
  deleteDescription: string;
  /** Warning shown when entity is still active */
  activeDeleteConstraint?: string;
  deleteSlot?: ReactNode;
}

export const DangerZone: React.FC<DangerZoneProps> = ({
  entityType,
  isActive,
  isSubmitting = false,
  canDeactivate = false,
  onDeactivate,
  isDeactivating = false,
  deactivateDescription,
  deactivateSlot,
  canReactivate = false,
  onReactivate,
  isReactivating = false,
  reactivateDescription,
  reactivateSlot,
  canDelete = false,
  onDelete,
  isDeleting = false,
  deleteDescription,
  activeDeleteConstraint,
  deleteSlot,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const showDeactivate = isActive && canDeactivate;
  const showReactivate = !isActive && canReactivate;
  const showTopSection = showDeactivate || showReactivate;

  // Hide entire component if no sections are visible
  if (!showTopSection && !canDelete) return null;

  return (
    <section className="mt-4" aria-labelledby="danger-zone-heading">
      <Card className="shadow-lg border-red-200">
        <CardHeader className="border-b border-red-200 bg-red-50 py-3">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            aria-expanded={isExpanded}
            aria-controls="danger-zone-content"
            className="w-full flex items-center justify-between text-left"
          >
            <CardTitle id="danger-zone-heading" className="text-sm font-semibold text-red-800">
              Danger Zone
            </CardTitle>
            <ChevronDown
              className={cn(
                'w-4 h-4 text-red-800 transition-transform',
                isExpanded && 'rotate-180'
              )}
            />
          </button>
        </CardHeader>
        {isExpanded && (
          <CardContent
            id="danger-zone-content"
            role="region"
            aria-labelledby="danger-zone-heading"
            className="p-4 space-y-4"
          >
            {/* Deactivate Section */}
            {showDeactivate && (
              <div className={canDelete ? 'pb-4 border-b border-gray-200' : ''}>
                <h4 className="text-sm font-medium text-gray-900">
                  Deactivate this {entityType.toLowerCase()}
                </h4>
                <p className="text-xs text-gray-600 mt-1">{deactivateDescription}</p>
                {deactivateSlot}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onDeactivate}
                  disabled={isSubmitting || isDeactivating}
                  className="mt-2 text-orange-600 border-orange-300 hover:bg-orange-50"
                >
                  <XCircle className="w-3 h-3 mr-1" />
                  {isDeactivating ? 'Deactivating...' : `Deactivate ${entityType}`}
                </Button>
              </div>
            )}

            {/* Reactivate Section */}
            {showReactivate && (
              <div className={canDelete ? 'pb-4 border-b border-gray-200' : ''}>
                <h4 className="text-sm font-medium text-gray-900">
                  Reactivate this {entityType.toLowerCase()}
                </h4>
                <p className="text-xs text-gray-600 mt-1">{reactivateDescription}</p>
                {reactivateSlot}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onReactivate}
                  disabled={isSubmitting || isReactivating}
                  className="mt-2 text-green-600 border-green-300 hover:bg-green-50"
                >
                  <CheckCircle className="w-3 h-3 mr-1" />
                  {isReactivating ? 'Reactivating...' : `Reactivate ${entityType}`}
                </Button>
              </div>
            )}

            {/* Delete Section */}
            {canDelete && (
              <div>
                <h4 className="text-sm font-medium text-gray-900">
                  Delete this {entityType.toLowerCase()}
                </h4>
                <p className="text-xs text-gray-600 mt-1">
                  {deleteDescription}
                  {isActive && activeDeleteConstraint && (
                    <span className="block text-orange-600 mt-1">{activeDeleteConstraint}</span>
                  )}
                </p>
                {deleteSlot}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onDelete}
                  disabled={isSubmitting || isDeleting}
                  className="mt-2 text-red-600 border-red-300 hover:bg-red-50"
                >
                  <Trash2 className="w-3 h-3 mr-1" />
                  {isDeleting ? 'Deleting...' : `Delete ${entityType}`}
                </Button>
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </section>
  );
};

export default DangerZone;
