/**
 * Client Field Tab Bar
 *
 * Horizontal scrollable tab bar for field configuration categories.
 * WAI-ARIA Tabs pattern with keyboard navigation.
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface ClientFieldTabBarProps {
  tabs: Array<{ slug: string; name: string }>;
  activeTab: string;
  onTabChange: (slug: string) => void;
}

export const ClientFieldTabBar: React.FC<ClientFieldTabBarProps> = observer(
  ({ tabs, activeTab, onTabChange }) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [showLeft, setShowLeft] = useState(false);
    const [showRight, setShowRight] = useState(false);

    const updateArrows = useCallback(() => {
      const el = scrollRef.current;
      if (!el) return;
      setShowLeft(el.scrollLeft > 0);
      setShowRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    }, []);

    useEffect(() => {
      updateArrows();
      const el = scrollRef.current;
      if (!el) return;
      el.addEventListener('scroll', updateArrows);
      const observer = new window.ResizeObserver(updateArrows);
      observer.observe(el);
      return () => {
        el.removeEventListener('scroll', updateArrows);
        observer.disconnect();
      };
    }, [updateArrows, tabs]);

    const scroll = (direction: 'left' | 'right') => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollBy({ left: direction === 'left' ? -160 : 160, behavior: 'smooth' });
    };

    const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
      let nextIndex: number | null = null;
      if (e.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') nextIndex = 0;
      else if (e.key === 'End') nextIndex = tabs.length - 1;

      if (nextIndex !== null) {
        e.preventDefault();
        onTabChange(tabs[nextIndex].slug);
        const btn = scrollRef.current?.querySelector(
          `[data-tab="${tabs[nextIndex].slug}"]`
        ) as HTMLElement;
        btn?.focus();
      }
    };

    return (
      <div className="relative flex items-center mb-4" data-testid="client-field-tab-bar">
        {showLeft && (
          <button
            onClick={() => scroll('left')}
            className="shrink-0 p-1 text-gray-400 hover:text-gray-600"
            aria-label="Scroll tabs left"
            data-testid="scroll-tabs-left-btn"
          >
            <ChevronLeft size={16} />
          </button>
        )}

        <div
          ref={scrollRef}
          className="flex gap-1 overflow-x-auto scrollbar-hide"
          role="tablist"
          aria-label="Field configuration categories"
        >
          {tabs.map((tab, index) => (
            <button
              key={tab.slug}
              data-tab={tab.slug}
              id={`tab-${tab.slug}`}
              role="tab"
              aria-selected={activeTab === tab.slug}
              aria-controls={`tabpanel-${tab.slug}`}
              tabIndex={activeTab === tab.slug ? 0 : -1}
              onClick={() => onTabChange(tab.slug)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={`shrink-0 px-3 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-colors ${
                activeTab === tab.slug
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
              data-testid={`tab-${tab.slug}`}
            >
              {tab.name}
            </button>
          ))}
        </div>

        {showRight && (
          <button
            onClick={() => scroll('right')}
            className="shrink-0 p-1 text-gray-400 hover:text-gray-600"
            aria-label="Scroll tabs right"
            data-testid="scroll-tabs-right-btn"
          >
            <ChevronRight size={16} />
          </button>
        )}
      </div>
    );
  }
);
