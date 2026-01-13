/**
 * Organization Tree Component
 *
 * Container component for rendering an organization hierarchy as an accessible tree.
 * Implements WAI-ARIA tree pattern with full keyboard navigation support.
 *
 * Features:
 * - Full keyboard navigation (Arrow keys, Home, End, Enter/Space)
 * - WAI-ARIA tree pattern compliance
 * - Focus management
 * - Expand/collapse all functionality
 * - Type-ahead search (per WAI-ARIA APG spec)
 *
 * Keyboard Navigation:
 * - Arrow Down: Move to next visible node
 * - Arrow Up: Move to previous visible node
 * - Arrow Right: Expand node (if collapsed) or move to first child
 * - Arrow Left: Collapse node (if expanded) or move to parent
 * - Home: Move to first node
 * - End: Move to last visible node
 * - Enter/Space: Toggle selection or expand/collapse
 * - Type characters: Focus moves to next node matching typed prefix
 *
 * @see https://www.w3.org/WAI/ARIA/apg/patterns/treeview/
 * @see OrganizationTreeNode for individual node rendering
 */

import React, { useCallback, useRef, useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { cn } from '@/components/ui/utils';
import { OrganizationTreeNode } from './OrganizationTreeNode';
import type { OrganizationUnitNode } from '@/types/organization-unit.types';
import { Logger } from '@/utils/logger';

const log = Logger.getLogger('component');

/**
 * Props for OrganizationTree component
 */
export interface OrganizationTreeProps {
  /** Tree nodes to render (root-level nodes) */
  nodes: OrganizationUnitNode[];

  /** Currently selected node ID */
  selectedId: string | null;

  /** Set of expanded node IDs */
  expandedIds: Set<string>;

  /** Callback when a node is selected */
  onSelect: (nodeId: string) => void;

  /** Callback when a node's expansion is toggled */
  onToggle: (nodeId: string) => void;

  /** Callback when Arrow Down is pressed */
  onMoveDown: () => void;

  /** Callback when Arrow Up is pressed */
  onMoveUp: () => void;

  /** Callback when Arrow Right is pressed */
  onArrowRight: () => void;

  /** Callback when Arrow Left is pressed */
  onArrowLeft: () => void;

  /** Callback when Home key is pressed */
  onSelectFirst: () => void;

  /** Callback when End key is pressed */
  onSelectLast: () => void;

  /** Tree label for accessibility */
  ariaLabel?: string;

  /** Whether tree is in read-only mode (no selection changes) */
  readOnly?: boolean;

  /** Additional CSS classes */
  className?: string;

  /** Callback when Enter/Space is pressed on selected node */
  onActivate?: (nodeId: string) => void;

  /** Active status filter - affects node styling when filtering by inactive */
  activeStatusFilter?: 'all' | 'active' | 'inactive';
}

/**
 * Organization Tree Component
 *
 * Renders an accessible tree view of organizational units with full
 * keyboard navigation support per WAI-ARIA tree pattern.
 */
export const OrganizationTree = observer(
  ({
    nodes,
    selectedId,
    expandedIds,
    onSelect,
    onToggle,
    onMoveDown,
    onMoveUp,
    onArrowRight,
    onArrowLeft,
    onSelectFirst,
    onSelectLast,
    ariaLabel = 'Organization hierarchy',
    readOnly = false,
    className,
    onActivate,
    activeStatusFilter = 'all',
  }: OrganizationTreeProps) => {
    // Ref map for managing focus on nodes
    const nodeRefs = useRef<Map<string, HTMLLIElement | null>>(new Map());
    const treeRef = useRef<HTMLUListElement>(null);

    // Type-ahead state: buffer of typed characters and timeout for clearing
    const [typeAheadBuffer, setTypeAheadBuffer] = useState('');
    const typeAheadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    /** Type-ahead timeout in milliseconds (per WAI-ARIA recommendation) */
    const TYPE_AHEAD_TIMEOUT = 500;

    /**
     * Flatten visible nodes (respecting expanded state) for type-ahead search.
     * Returns nodes in display order (depth-first, only including visible nodes).
     */
    const getVisibleNodes = useCallback(
      (nodeList: OrganizationUnitNode[]): OrganizationUnitNode[] => {
        const result: OrganizationUnitNode[] = [];
        const traverse = (nodes: OrganizationUnitNode[]) => {
          for (const node of nodes) {
            result.push(node);
            // Only include children if node is expanded
            if (node.children.length > 0 && expandedIds.has(node.id)) {
              traverse(node.children);
            }
          }
        };
        traverse(nodeList);
        return result;
      },
      [expandedIds]
    );

    /**
     * Find the next node matching the type-ahead prefix, starting after current selection.
     * Wraps around to the beginning if no match found after current position.
     */
    const findMatchingNode = useCallback(
      (prefix: string): string | null => {
        if (!prefix) return null;

        const visibleNodes = getVisibleNodes(nodes);
        if (visibleNodes.length === 0) return null;

        const lowerPrefix = prefix.toLowerCase();

        // Find current index
        const currentIndex = selectedId
          ? visibleNodes.findIndex((n) => n.id === selectedId)
          : -1;

        // Search from current position + 1 to end, then wrap to beginning
        for (let offset = 1; offset <= visibleNodes.length; offset++) {
          const index = (currentIndex + offset) % visibleNodes.length;
          const node = visibleNodes[index];
          const nodeName = (node.displayName || node.name).toLowerCase();

          if (nodeName.startsWith(lowerPrefix)) {
            return node.id;
          }
        }

        return null;
      },
      [nodes, selectedId, getVisibleNodes]
    );

    /**
     * Handle type-ahead character input.
     * Appends to buffer and finds matching node.
     */
    const handleTypeAhead = useCallback(
      (char: string) => {
        // Clear existing timeout
        if (typeAheadTimeoutRef.current) {
          clearTimeout(typeAheadTimeoutRef.current);
        }

        // Append character to buffer
        const newBuffer = typeAheadBuffer + char;
        setTypeAheadBuffer(newBuffer);

        // Find matching node
        const matchId = findMatchingNode(newBuffer);
        if (matchId) {
          onSelect(matchId);
          log.debug('Type-ahead matched', { buffer: newBuffer, matchId });
        }

        // Set timeout to clear buffer
        typeAheadTimeoutRef.current = setTimeout(() => {
          setTypeAheadBuffer('');
          log.debug('Type-ahead buffer cleared');
        }, TYPE_AHEAD_TIMEOUT);
      },
      [typeAheadBuffer, findMatchingNode, onSelect]
    );

    // Cleanup timeout on unmount
    useEffect(() => {
      return () => {
        if (typeAheadTimeoutRef.current) {
          clearTimeout(typeAheadTimeoutRef.current);
        }
      };
    }, []);

    // Focus the selected node when selection changes
    useEffect(() => {
      if (selectedId) {
        const nodeElement = nodeRefs.current.get(selectedId);
        if (nodeElement) {
          nodeElement.focus();
          log.debug('Focused tree node', { nodeId: selectedId });
        }
      }
    }, [selectedId]);

    // Handle keyboard navigation
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        // Only handle keyboard events when tree has focus
        if (!treeRef.current?.contains(document.activeElement)) {
          return;
        }

        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault();
            onMoveDown();
            break;

          case 'ArrowUp':
            e.preventDefault();
            onMoveUp();
            break;

          case 'ArrowRight':
            e.preventDefault();
            onArrowRight();
            break;

          case 'ArrowLeft':
            e.preventDefault();
            onArrowLeft();
            break;

          case 'Home':
            e.preventDefault();
            onSelectFirst();
            break;

          case 'End':
            e.preventDefault();
            onSelectLast();
            break;

          case 'Enter':
          case ' ':
            e.preventDefault();
            if (selectedId) {
              if (onActivate) {
                onActivate(selectedId);
              } else {
                // Default behavior: toggle expansion
                onToggle(selectedId);
              }
            }
            break;

          case '*':
            // Expand all siblings at current level (WAI-ARIA spec)
            e.preventDefault();
            // This is handled by the parent - could emit an event
            break;

          default:
            // Type-ahead search: handle printable characters
            // Single character, not a modifier key, and printable
            if (
              e.key.length === 1 &&
              !e.ctrlKey &&
              !e.altKey &&
              !e.metaKey &&
              /^[a-zA-Z0-9 ]$/.test(e.key)
            ) {
              e.preventDefault();
              handleTypeAhead(e.key);
            }
            break;
        }
      },
      [
        selectedId,
        onMoveDown,
        onMoveUp,
        onArrowRight,
        onArrowLeft,
        onSelectFirst,
        onSelectLast,
        onToggle,
        onActivate,
        handleTypeAhead,
      ]
    );

    // Compute isExpanded for each node
    const isNodeExpanded = useCallback(
      (nodeId: string): boolean => {
        return expandedIds.has(nodeId);
      },
      [expandedIds]
    );

    // Empty state
    if (nodes.length === 0) {
      return (
        <div
          className={cn(
            'flex items-center justify-center p-8 text-gray-500 border-2 border-dashed rounded-lg',
            className
          )}
          role="tree"
          aria-label={ariaLabel}
        >
          <p>No organizational units found.</p>
        </div>
      );
    }

    return (
      <ul
        ref={treeRef}
        role="tree"
        aria-label={ariaLabel}
        data-testid="ou-tree"
        className={cn('list-none p-0 m-0', className)}
        onKeyDown={handleKeyDown}
      >
        {nodes.map((node, index) => (
          <OrganizationTreeNode
            key={node.id}
            node={node}
            isSelected={node.id === selectedId}
            isExpanded={isNodeExpanded(node.id)}
            onSelect={onSelect}
            onToggle={onToggle}
            depth={node.depth}
            positionInSet={index + 1}
            setSize={nodes.length}
            nodeRefs={nodeRefs}
            readOnly={readOnly}
            isLastChild={index === nodes.length - 1}
            expandedIds={expandedIds}
            selectedId={selectedId}
            activeStatusFilter={activeStatusFilter}
          />
        ))}
      </ul>
    );
  }
);

OrganizationTree.displayName = 'OrganizationTree';

/**
 * Export both components for external use
 */
export { OrganizationTreeNode } from './OrganizationTreeNode';
export type { OrganizationTreeNodeProps } from './OrganizationTreeNode';
