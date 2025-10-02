import React, { ChangeEvent, useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

export interface ReasonInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  label?: string;
  helpText?: string;
  error?: string;
  disabled?: boolean;
  className?: string;
  showCharacterCount?: boolean;
  suggestions?: string[];
  autoFocus?: boolean;
}

export function ReasonInput({
  value,
  onChange,
  placeholder = 'Explain why this change is being made...',
  required = true,
  minLength = 10,
  maxLength = 500,
  label = 'Reason for Change',
  helpText = 'Provide context for audit trail (required)',
  error: externalError,
  disabled = false,
  className,
  showCharacterCount = true,
  suggestions = [],
  autoFocus = false
}: ReasonInputProps) {
  const [internalError, setInternalError] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  const error = externalError || internalError;
  const characterCount = value.length;
  const isValid = characterCount >= minLength && characterCount <= maxLength;

  useEffect(() => {
    if (value && characterCount < minLength) {
      setInternalError(`Reason must be at least ${minLength} characters (${minLength - characterCount} more needed)`);
    } else if (characterCount > maxLength) {
      setInternalError(`Reason must be less than ${maxLength} characters`);
    } else {
      setInternalError('');
    }
  }, [value, characterCount, minLength, maxLength]);

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  };

  const handleSuggestionClick = (suggestion: string) => {
    onChange(suggestion);
  };

  const getCharacterCountColor = () => {
    if (characterCount === 0) return 'text-gray-400';
    if (characterCount < minLength) return 'text-amber-500';
    if (characterCount > maxLength) return 'text-red-500';
    return 'text-green-500';
  };

  const getProgressPercentage = () => {
    if (characterCount >= minLength) return 100;
    return (characterCount / minLength) * 100;
  };

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-700">
          {label}
          {required && <span className="ml-1 text-red-500">*</span>}
        </label>
        {showCharacterCount && (
          <span className={cn('text-xs', getCharacterCountColor())}>
            {characterCount} / {minLength} min
            {characterCount > minLength && ` (${maxLength} max)`}
          </span>
        )}
      </div>

      <div className="relative">
        <textarea
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          required={required}
          minLength={minLength}
          maxLength={maxLength}
          disabled={disabled}
          autoFocus={autoFocus}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          rows={3}
          className={cn(
            'w-full rounded-md border px-3 py-2',
            'transition-colors duration-200',
            'placeholder:text-gray-400',
            'resize-vertical min-h-[80px]',
            {
              'border-gray-300 hover:border-gray-400': !error && !isFocused,
              'border-blue-500 ring-2 ring-blue-500 ring-opacity-20': isFocused && !error,
              'border-red-500 hover:border-red-600': error,
              'bg-gray-50 cursor-not-allowed': disabled,
            }
          )}
          aria-invalid={!!error}
          aria-describedby={error ? 'reason-error' : 'reason-help'}
        />

        {characterCount < minLength && characterCount > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-200 rounded-b-md overflow-hidden">
            <div
              className="h-full bg-amber-400 transition-all duration-300 ease-out"
              style={{ width: `${getProgressPercentage()}%` }}
            />
          </div>
        )}
      </div>

      {suggestions.length > 0 && characterCount === 0 && (
        <div className="space-y-1">
          <p className="text-xs text-gray-500">Suggestions:</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((suggestion, index) => (
              <button
                key={index}
                type="button"
                onClick={() => handleSuggestionClick(suggestion)}
                className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p id="reason-error" className="text-sm text-red-600 flex items-center gap-1">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          {error}
        </p>
      )}

      {!error && helpText && (
        <p id="reason-help" className="text-sm text-gray-500">
          {helpText}
        </p>
      )}
    </div>
  );
}

export default ReasonInput;