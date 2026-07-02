import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommandFeedbackEcho } from './CommandFeedbackEcho';

describe('CommandFeedbackEcho', () => {
  it('renders nothing when there is no message', () => {
    const { container } = render(<CommandFeedbackEcho message={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the sanitized message with the mandated test id', () => {
    render(<CommandFeedbackEcho message="Failed to deactivate user" />);
    const echo = screen.getByTestId('command-feedback-toast-error');
    expect(echo.textContent).toBe('Failed to deactivate user');
  });

  it('INV-1: is aria-hidden so it never announces (the banner owns the announcement)', () => {
    render(<CommandFeedbackEcho message="x" />);
    expect(screen.getByTestId('command-feedback-toast-error').getAttribute('aria-hidden')).toBe(
      'true'
    );
  });

  it('INV-2: contains no focusable descendant and is not itself focusable (no aria-hidden-focus)', () => {
    render(<CommandFeedbackEcho message="x" />);
    const echo = screen.getByTestId('command-feedback-toast-error');
    // The exact WCAG 4.1.2 hazard the non-Sonner echo eliminates by construction:
    // an aria-hidden subtree must contain nothing focusable.
    expect(
      echo.querySelectorAll('a, button, input, select, textarea, [contenteditable], [tabindex]')
        .length
    ).toBe(0);
    expect(echo.hasAttribute('tabindex')).toBe(false);
  });
});
