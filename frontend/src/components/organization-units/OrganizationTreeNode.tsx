/**
 * Organization Tree Node Component
 *
 * Renders a single node in the organization tree hierarchy.
 * Implements WAI-ARIA treeitem pattern for accessibility.
 *
 * Features:
 * - Expand/collapse toggle for nodes with children
 * - Selection state with visual feedback
 * - Active/inactive status indicators
 * - Recursive children rendering
 * - Full keyboard navigation support
 *
 * @see https://www.w3.org/WAI/ARIA/apg/patterns/treeview/
 */

import React, { useCallback, forwardRef } from 'react';
import { observer } from 'mobx-react-lite';
import { ChevronRight, ChevronDown, Building2, MapPin, AlertCircle } from 'lucide-react';
import { cn } from '@/components/ui/utils';
import type { OrganizationUnitNode } from '@/types/organization-unit.types';

/**
 * Props for OrganizationTreeNode component
 */
export interface OrganizationTreeNodeProps {
  /** The node data to render */
  node: OrganizationUnitNode;

  /** Whether this node is currently selected */
  isSelected: boolean;

  /** Whether this node is expanded */
  isExpanded: boolean;

  /** Callback when node is selected */
  onSelect: (nodeId: string) => void;

  /** Callback when node expansion is toggled */
  onToggle: (nodeId: string) => void;

  /** Depth level in tree (used for indentation) */
  depth: number;

  /** Position in current level (1-indexed for aria-posinset) */
  positionInSet: number;

  /** Total items in current level (for aria-setsize) */
  setSize: number;

  /** Ref map for focus management */
  nodeRefs?: React.MutableRefObject<Map<string, HTMLLIElement | null>>;

  /** Whether tree is in read-only mode */
  readOnly?: boolean;

  /** Whether this node is the last child in its parent (for tree connector lines) */
  isLastChild?: boolean;

  /** Set of expanded node IDs (for recursive children to check expansion state) */
  expandedIds?: Set<string>;

  /** Currently selected node ID (for recursive children to check selection state) */
  selectedId?: string | null;
}

/**
 * Visual indentation per depth level (in pixels)
 */
const INDENT_SIZE = 24;

/**
 * Organization Tree Node Component
 *
 * Renders a single treeitem with proper ARIA attributes and keyboard support.
 */
export const OrganizationTreeNode = observer(
  forwardRef<HTMLLIElement, OrganizationTreeNodeProps>(
    (
      {
        node,
        isSelected,
        isExpanded,
        onSelect,
        onToggle,
        depth,
        positionInSet,
        setSize,
        nodeRefs,
        readOnly = false,
        isLastChild = false,
        expandedIds,
        selectedId,
      },
      ref
    ) => {
      const hasChildren = node.children.length > 0;

      // Handle toggle button click (stop propagation to prevent selection)
      const handleToggleClick = useCallback(
        (e: React.MouseEvent) => {
          e.stopPropagation();
          onToggle(node.id);
        },
        [node.id, onToggle]
      );

      // Handle node row click for selection
      const handleNodeClick = useCallback(() => {
        onSelect(node.id);
      }, [node.id, onSelect]);

      // Register ref for focus management
      const setNodeRef = useCallback(
        (el: HTMLLIElement | null) => {
          if (nodeRefs?.current) {
            if (el) {
              nodeRefs.current.set(node.id, el);
            } else {
              nodeRefs.current.delete(node.id);
            }
          }
          // Forward ref if provided
          if (typeof ref === 'function') {
            ref(el);
          } else if (ref) {
            ref.current = el;
          }
        },
        [node.id, nodeRefs, ref]
      );

      // Compute icon based on node type
      const NodeIcon = node.isRootOrganization ? Building2 : MapPin;

      return (
        <li
          ref={setNodeRef}
          role="treeitem"
          id={`tree-node-${node.id}`}
          aria-selected={isSelected}
          aria-expanded={hasChildren ? isExpanded : undefined}
          aria-level={depth + 1}
          aria-posinset={positionInSet}
          aria-setsize={setSize}
          aria-label={`${node.displayName || node.name}${node.isRootOrganization ? ' (Root Organization)' : ''}${!node.isActive ? ' (Inactive)' : ''}`}
          tabIndex={isSelected ? 0 : -1}
          className="outline-none list-none relative"
          style={depth > 0 ? { marginLeft: `${depth * INDENT_SIZE}px` } : undefined}
          data-node-id={node.id}
          data-testid="ou-tree-node"
          data-root={node.isRootOrganization ? 'true' : undefined}
          data-inactive={!node.isActive ? 'true' : undefined}
        >
          {/* Tree Connector Lines (for non-root nodes) */}
          {depth > 0 && (
            <>
              {/* Vertical line from parent - positioned relative to indented li */}
              <span
                className="absolute border-l border-gray-300"
                style={{
                  left: `-${INDENT_SIZE - 12}px`,
                  top: 0,
                  height: isLastChild ? '50%' : '100%',
                }}
                aria-hidden="true"
              />
              {/* Horizontal line to node */}
              <span
                className="absolute border-t border-gray-300"
                style={{
                  left: `-${INDENT_SIZE - 12}px`,
                  width: `${INDENT_SIZE - 12}px`,
                  top: '50%',
                }}
                aria-hidden="true"
              />
            </>
          )}

          {/* Node Row - relative positioning for badge container */}
          <div
            onClick={handleNodeClick}
            className={cn(
              'relative flex items-center py-2 px-2 pr-40 rounded-md cursor-pointer transition-colors',
              'focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-1',
              isSelected && 'bg-blue-100 border border-blue-300',
              !isSelected && 'hover:bg-gray-50',
              !node.isActive && 'opacity-60'
            )}
          >
            {/* Expand/Collapse Toggle */}
            {hasChildren ? (
              <button
                type="button"
                onClick={handleToggleClick}
                className={cn(
                  'flex-shrink-0 w-6 h-6 flex items-center justify-center rounded',
                  'hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500',
                  'transition-colors mr-1'
                )}
                aria-label={isExpanded ? 'Collapse' : 'Expand'}
                tabIndex={-1}
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-gray-600" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-600" />
                )}
              </button>
            ) : (
              // Spacer for alignment when no children
              <span className="w-6 h-6 mr-1 flex-shrink-0" />
            )}

            {/* Node Icon */}
            <NodeIcon
              className={cn(
                'w-5 h-5 mr-2 flex-shrink-0',
                node.isRootOrganization ? 'text-blue-600' : 'text-gray-500',
                !node.isActive && 'text-gray-400'
              )}
            />

            {/* Node Name */}
            <span
              data-testid="ou-name"
              className={cn(
                'flex-grow text-sm font-medium truncate',
                isSelected && 'text-blue-900',
                !isSelected && 'text-gray-900',
                !node.isActive && 'text-gray-500 italic'
              )}
            >
              {node.displayName || node.name}
            </span>

            {/* Status Indicators - absolutely positioned at right edge */}
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
              {/* Root Organization Badge */}
              {node.isRootOrganization && (
                <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                  Root
                </span>
              )}

              {/* Inactive Badge */}
              {!node.isActive && (
                <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full">
                  <AlertCircle className="w-3 h-3" />
                  Inactive
                </span>
              )}

              {/* Child Count */}
              {node.childCount > 0 && (
                <span className="text-xs text-gray-500 tabular-nums">
                  ({node.childCount})
                </span>
              )}
            </div>
          </div>

          {/* Children (recursive) */}
          {hasChildren && isExpanded && (
            <ul role="group" className="list-none">
              {node.children.map((childNode, index) => (
                <OrganizationTreeNode
                  key={childNode.id}
                  node={childNode}
                  isSelected={selectedId ? childNode.id === selectedId : (childNode.isSelected ?? false)}
                  isExpanded={expandedIds ? expandedIds.has(childNode.id) : (childNode.isExpanded ?? false)}
                  onSelect={onSelect}
                  onToggle={onToggle}
                  depth={depth + 1}
                  positionInSet={index + 1}
                  setSize={node.children.length}
                  nodeRefs={nodeRefs}
                  readOnly={readOnly}
                  isLastChild={index === node.children.length - 1}
                  expandedIds={expandedIds}
                  selectedId={selectedId}
                />
              ))}
            </ul>
          )}
        </li>
      );
    }
  )
);

OrganizationTreeNode.displayName = 'OrganizationTreeNode';
