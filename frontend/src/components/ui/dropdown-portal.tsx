import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface DropdownPortalProps {
  children: React.ReactNode;
  isOpen: boolean;
}

export function DropdownPortal({ children, isOpen }: DropdownPortalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!mounted || !isOpen) return null;

  // Create a portal that renders the dropdown at the document body level
  // This avoids any stacking context or transform issues from parent elements
  return createPortal(
    children,
    document.body
  );
}