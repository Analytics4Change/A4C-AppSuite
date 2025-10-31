import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Utility function to merge Tailwind CSS classes
 *
 * Combines clsx for conditional classes with tailwind-merge to handle conflicts.
 * This is a standard pattern from shadcn/ui for properly merging Tailwind classes.
 *
 * @param inputs - Class names to merge (strings, objects, arrays)
 * @returns Merged class string with Tailwind conflicts resolved
 *
 * @example
 * ```typescript
 * cn('px-2 py-1', condition && 'bg-blue-500', { 'text-white': isActive })
 * // Returns: 'px-2 py-1 bg-blue-500 text-white' (if condition and isActive are true)
 * ```
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
