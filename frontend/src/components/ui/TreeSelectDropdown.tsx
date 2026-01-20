/**
 * Tree Select Dropdown Component
 *
 * A dropdown that displays an organization hierarchy tree for selection.
 * Wraps the OrganizationTree component in a collapsible dropdown.
 *
 * Features:
 * - Collapsed state shows selected path or placeholder
 * - Expanded state shows full OrganizationTree
 * - Full keyboard navigation inherited from OrganizationTree
 * - WCAG 2.1 Level AA compliant
 * - Click outside to close
 * - Escape key to close
 *
 * @see OrganizationTree for tree implementation
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { ChevronDown, X } from 'lucide-react';
import { cn } from '@/components/ui/utils';
import { OrganizationTree } from '@/components/organization-units/OrganizationTree';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { OrganizationUnitNode } from '@/types/organization-unit.types';
import { flattenOrganizationUnitTree } from '@/types/organization-unit.types';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

/**
 * Props for TreeSelectDropdown component
 */
export interface TreeSelectDropdownProps {
  /** Unique ID for accessibility */
  id: string;

  /** Label text */
  label: string;

  /** Tree nodes to display */
  nodes: OrganizationUnitNode[];

  /** Currently selected node's path (ltree format) */
  selectedPath: string | null;

  /** Callback when selection changes */
  onSelect: (path: string | null) => void;

  /** Placeholder text when nothing selected */
  placeholder?: string;

  /** Whether the dropdown is disabled */
  disabled?: boolean;

  /** Error message to display */
  error?: string;

  /** Help text to display below the dropdown */
  helpText?: string;

  /** Additional CSS classes */
  className?: string;
}

/**
 * Tree Select Dropdown Component
 *
 * Renders a dropdown that contains an organization tree for selection.
 */
export const TreeSelectDropdown = observer(
  ({
    id,
    label,
    nodes,
    selectedPath,
    onSelect,
    placeholder = 'Select an organizational unit...',
    disabled = false,
    error,
    helpText,
    className,
  }: TreeSelectDropdownProps) => {
    // Dropdown state
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);

    // Tree navigation state
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

    // Flatten nodes for navigation
    const allNodes = useMemo(() => {
      return flattenOrganizationUnitTree(nodes, true);
    }, [nodes]);

    const visibleNodes = useMemo(() => {
      return flattenOrganizationUnitTree(
        nodes.map((node) => applyExpansionState(node, expandedIds)),
        false
      );
    }, [nodes, expandedIds]);

    // Find node by path
    const findNodeByPath = useCallback(
      (path: string | null): OrganizationUnitNode | null => {
        if (!path) return null;
        return allNodes.find((n) => n.path === path) ?? null;
      },
      [allNodes]
    );

    // Find node by ID
    const findNodeById = useCallback(
      (nodeId: string | null): OrganizationUnitNode | null => {
        if (!nodeId) return null;
        return allNodes.find((n) => n.id === nodeId) ?? null;
      },
      [allNodes]
    );

    // Get display text for selected path
    const selectedNode = findNodeByPath(selectedPath);
    const displayText = selectedNode
      ? selectedNode.displayName || selectedNode.name
      : null;

    // Sync selectedId with selectedPath when nodes change
    useEffect(() => {
      if (selectedPath && allNodes.length > 0) {
        const node = findNodeByPath(selectedPath);
        if (node) {
          setSelectedId(node.id);
          // Auto-expand ancestors when a path is set
          expandAncestors(node.id);
        }
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- expandAncestors is stable (defined after this effect)
    }, [selectedPath, allNodes, findNodeByPath]);

    // Expand ancestors of a node
    const expandAncestors = useCallback(
      (nodeId: string) => {
        const node = findNodeById(nodeId);
        if (!node) return;

        const ancestors = new Set<string>();
        let current = findNodeById(node.parentId ?? '');
        while (current) {
          ancestors.add(current.id);
          current = findNodeById(current.parentId ?? '');
        }

        if (ancestors.size > 0) {
          setExpandedIds((prev) => new Set([...prev, ...ancestors]));
        }
      },
      [findNodeById]
    );

    // Handle click outside to close
    useEffect(() => {
      if (!isOpen) return;

      const handleClickOutside = (e: MouseEvent) => {
        if (
          containerRef.current &&
          !containerRef.current.contains(e.target as Node)
        ) {
          setIsOpen(false);
        }
      };

      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    // Handle escape key to close
    useEffect(() => {
      if (!isOpen) return;

      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          setIsOpen(false);
          triggerRef.current?.focus();
        }
      };

      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }, [isOpen]);

    // Toggle dropdown
    const toggleDropdown = useCallback(() => {
      if (disabled) return;
      setIsOpen((prev) => !prev);
    }, [disabled]);

    // Handle node selection from tree
    const handleNodeSelect = useCallback(
      (nodeId: string) => {
        setSelectedId(nodeId);
        const node = findNodeById(nodeId);
        if (node) {
          onSelect(node.path);
          setIsOpen(false);
          triggerRef.current?.focus();
          log.debug('TreeSelectDropdown: Selected node', {
            nodeId,
            path: node.path,
          });
        }
      },
      [findNodeById, onSelect]
    );

    // Handle node toggle (expand/collapse)
    const handleNodeToggle = useCallback((nodeId: string) => {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(nodeId)) {
          next.delete(nodeId);
        } else {
          next.add(nodeId);
        }
        return next;
      });
    }, []);

    // Clear selection
    const handleClear = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        onSelect(null);
        setSelectedId(null);
        log.debug('TreeSelectDropdown: Cleared selection');
      },
      [onSelect]
    );

    // Tree navigation handlers
    const handleMoveDown = useCallback(() => {
      if (visibleNodes.length === 0) return;
      const currentIndex = selectedId
        ? visibleNodes.findIndex((n) => n.id === selectedId)
        : -1;
      const nextIndex =
        currentIndex < visibleNodes.length - 1 ? currentIndex + 1 : 0;
      setSelectedId(visibleNodes[nextIndex].id);
    }, [visibleNodes, selectedId]);

    const handleMoveUp = useCallback(() => {
      if (visibleNodes.length === 0) return;
      const currentIndex = selectedId
        ? visibleNodes.findIndex((n) => n.id === selectedId)
        : 0;
      const prevIndex =
        currentIndex > 0 ? currentIndex - 1 : visibleNodes.length - 1;
      setSelectedId(visibleNodes[prevIndex].id);
    }, [visibleNodes, selectedId]);

    const handleArrowRight = useCallback(() => {
      if (!selectedId) return;
      const node = findNodeById(selectedId);
      if (!node) return;

      if (node.hasDescendants && !expandedIds.has(node.id)) {
        handleNodeToggle(node.id);
      } else if (node.children.length > 0) {
        setSelectedId(node.children[0].id);
      }
    }, [selectedId, findNodeById, expandedIds, handleNodeToggle]);

    const handleArrowLeft = useCallback(() => {
      if (!selectedId) return;
      const node = findNodeById(selectedId);
      if (!node) return;

      if (expandedIds.has(node.id)) {
        handleNodeToggle(node.id);
      } else if (node.parentId) {
        setSelectedId(node.parentId);
      }
    }, [selectedId, findNodeById, expandedIds, handleNodeToggle]);

    const handleSelectFirst = useCallback(() => {
      if (visibleNodes.length > 0) {
        setSelectedId(visibleNodes[0].id);
      }
    }, [visibleNodes]);

    const handleSelectLast = useCallback(() => {
      if (visibleNodes.length > 0) {
        setSelectedId(visibleNodes[visibleNodes.length - 1].id);
      }
    }, [visibleNodes]);

    // Handle Enter on tree node - select and close
    const handleActivate = useCallback(
      (nodeId: string) => {
        handleNodeSelect(nodeId);
      },
      [handleNodeSelect]
    );

    // Error and help text IDs
    const errorId = `${id}-error`;
    const helpId = `${id}-help`;
    const listboxId = `${id}-listbox`;

    return (
      <div ref={containerRef} className={cn('relative', className)}>
        {/* Label */}
        <Label htmlFor={id} className="block text-sm font-medium mb-1">
          {label}
        </Label>

        {/* Trigger button */}
        <button
          ref={triggerRef}
          id={id}
          type="button"
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="tree"
          aria-controls={listboxId}
          aria-describedby={error ? errorId : helpText ? helpId : undefined}
          aria-invalid={!!error}
          disabled={disabled}
          onClick={toggleDropdown}
          className={cn(
            'w-full flex items-center justify-between px-3 py-2 text-left',
            'border rounded-md shadow-sm bg-white',
            'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500',
            'transition-colors duration-150',
            disabled && 'bg-gray-100 cursor-not-allowed opacity-60',
            error && 'border-red-500 focus:ring-red-500',
            !error && !disabled && 'border-gray-300 hover:border-gray-400'
          )}
        >
          <span
            className={cn(
              'flex-1 truncate',
              !displayText && 'text-gray-400'
            )}
          >
            {displayText || placeholder}
          </span>

          <div className="flex items-center gap-1 ml-2">
            {/* Clear button */}
            {displayText && !disabled && (
              <button
                type="button"
                onClick={handleClear}
                className="p-1 hover:bg-gray-100 rounded transition-colors"
                aria-label="Clear selection"
              >
                <X size={14} className="text-gray-400" />
              </button>
            )}
            {/* Chevron */}
            <ChevronDown
              size={16}
              className={cn(
                'text-gray-400 transition-transform duration-200',
                isOpen && 'rotate-180'
              )}
            />
          </div>
        </button>

        {/* Error message */}
        {error && (
          <p id={errorId} className="mt-1 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        {/* Help text */}
        {helpText && !error && (
          <p id={helpId} className="mt-1 text-xs text-gray-500">
            {helpText}
          </p>
        )}

        {/* Dropdown panel */}
        {isOpen && nodes.length > 0 && (
          <div
            id={listboxId}
            className={cn(
              'absolute z-50 w-full mt-1',
              'bg-white border border-gray-200 rounded-md shadow-lg',
              'max-h-80 overflow-auto'
            )}
          >
            <div className="p-2">
              <OrganizationTree
                nodes={nodes}
                selectedId={selectedId}
                expandedIds={expandedIds}
                onSelect={handleNodeSelect}
                onToggle={handleNodeToggle}
                onMoveDown={handleMoveDown}
                onMoveUp={handleMoveUp}
                onArrowRight={handleArrowRight}
                onArrowLeft={handleArrowLeft}
                onSelectFirst={handleSelectFirst}
                onSelectLast={handleSelectLast}
                onActivate={handleActivate}
                ariaLabel={`${label} tree`}
              />
            </div>

            {/* Clear selection button at bottom */}
            {selectedPath && (
              <div className="border-t border-gray-100 p-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleClear}
                  className="w-full justify-center text-gray-600"
                >
                  Clear Selection
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {isOpen && nodes.length === 0 && (
          <div
            id={listboxId}
            className={cn(
              'absolute z-50 w-full mt-1',
              'bg-white border border-gray-200 rounded-md shadow-lg',
              'p-4 text-center text-gray-500'
            )}
          >
            No organizational units available.
          </div>
        )}
      </div>
    );
  }
);

TreeSelectDropdown.displayName = 'TreeSelectDropdown';

/**
 * Helper function to apply expansion state to nodes for flattening
 */
function applyExpansionState(
  node: OrganizationUnitNode,
  expandedIds: Set<string>
): OrganizationUnitNode {
  return {
    ...node,
    isExpanded: expandedIds.has(node.id),
    children: node.children.map((child) =>
      applyExpansionState(child, expandedIds)
    ),
  };
}
