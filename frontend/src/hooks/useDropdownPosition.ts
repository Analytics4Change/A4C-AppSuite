import { useEffect, useState, RefObject } from 'react';

interface DropdownPosition {
  top: number;
  left: number;
  width: number;
}

export function useDropdownPosition(
  inputRef: RefObject<HTMLInputElement | HTMLDivElement | null>,
  isOpen: boolean
): DropdownPosition {
  const [position, setPosition] = useState<DropdownPosition>({
    top: 0,
    left: 0,
    width: 0
  });

  useEffect(() => {
    if (!isOpen || !inputRef.current) return;

    const updatePosition = () => {
      if (!inputRef.current) return;
      
      const rect = inputRef.current.getBoundingClientRect();
      const newPosition = {
        top: rect.bottom,
        left: rect.left,
        width: rect.width
      };
      
      setPosition(newPosition);
    };

    // Initial position calculation
    updatePosition();

    // Update position on scroll or resize
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, inputRef]);

  return position;
}