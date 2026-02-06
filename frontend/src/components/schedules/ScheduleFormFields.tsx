/**
 * Schedule Form Fields Component
 *
 * Shared form fields for schedule create/edit forms.
 * Includes schedule name, weekly grid, and effective dates.
 * Mirrors RoleFormFields pattern.
 */

import React, { useCallback, useId } from 'react';
import { observer } from 'mobx-react-lite';
import { cn } from '@/components/ui/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle } from 'lucide-react';
import { WeeklyScheduleGrid } from './WeeklyScheduleGrid';
import type { WeeklySchedule, DayOfWeek } from '@/types/schedule.types';

interface FieldWrapperProps {
  id: string;
  label: string;
  error: string | null;
  required?: boolean;
  children: React.ReactNode;
}

const FieldWrapper: React.FC<FieldWrapperProps> = ({
  id,
  label,
  error,
  required = false,
  children,
}) => {
  const errorId = `${id}-error`;
  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={id}
        className={cn('text-sm font-medium', error ? 'text-red-600' : 'text-gray-700')}
      >
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </Label>
      {children}
      {error && (
        <p id={errorId} className="flex items-center gap-1 text-sm text-red-600" role="alert">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
};

export interface ScheduleFormFieldsProps {
  scheduleName: string;
  schedule: WeeklySchedule;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  onScheduleNameChange: (name: string) => void;
  onScheduleNameBlur: () => void;
  onToggleDay: (day: DayOfWeek) => void;
  onSetTime: (day: DayOfWeek, field: 'begin' | 'end', value: string) => void;
  onEffectiveFromChange: (date: string | null) => void;
  onEffectiveUntilChange: (date: string | null) => void;
  getFieldError: (field: string) => string | null;
  disabled?: boolean;
  isEditMode?: boolean;
  scheduleId?: string;
  className?: string;
}

export const ScheduleFormFields = observer(
  ({
    scheduleName,
    schedule,
    effectiveFrom,
    effectiveUntil,
    onScheduleNameChange,
    onScheduleNameBlur,
    onToggleDay,
    onSetTime,
    onEffectiveFromChange,
    onEffectiveUntilChange,
    getFieldError,
    disabled = false,
    isEditMode = false,
    scheduleId,
    className,
  }: ScheduleFormFieldsProps) => {
    const nameId = useId();
    const fromId = useId();
    const untilId = useId();

    const handleNameChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        onScheduleNameChange(e.target.value);
      },
      [onScheduleNameChange]
    );

    const handleFromChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        onEffectiveFromChange(e.target.value || null);
      },
      [onEffectiveFromChange]
    );

    const handleUntilChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        onEffectiveUntilChange(e.target.value || null);
      },
      [onEffectiveUntilChange]
    );

    const nameError = getFieldError('scheduleName');

    return (
      <div className={cn('space-y-6', className)}>
        {/* Schedule ID (edit mode only) */}
        {isEditMode && scheduleId && (
          <div className="text-xs text-gray-500 font-mono bg-gray-50 px-3 py-2 rounded">
            ID: {scheduleId}
          </div>
        )}

        {/* Schedule Name */}
        <FieldWrapper id={nameId} label="Schedule Name" error={nameError} required>
          <Input
            id={nameId}
            type="text"
            value={scheduleName}
            onChange={handleNameChange}
            onBlur={onScheduleNameBlur}
            disabled={disabled}
            placeholder='e.g., "Day Shift M-F 8-4"'
            maxLength={100}
            aria-required="true"
            aria-invalid={!!nameError}
            aria-describedby={nameError ? `${nameId}-error` : undefined}
            className={cn(nameError && 'border-red-500 focus:ring-red-500')}
          />
        </FieldWrapper>

        {/* Weekly Schedule Grid */}
        <div>
          <Label className="text-sm font-medium text-gray-700 mb-2 block">Weekly Schedule</Label>
          <WeeklyScheduleGrid
            schedule={schedule}
            onToggleDay={onToggleDay}
            onSetTime={onSetTime}
            disabled={disabled}
          />
        </div>

        {/* Effective Dates */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor={fromId} className="text-sm font-medium text-gray-700">
              Effective From
            </Label>
            <Input
              id={fromId}
              type="date"
              value={effectiveFrom ?? ''}
              onChange={handleFromChange}
              disabled={disabled}
              aria-label="Schedule effective from date"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={untilId} className="text-sm font-medium text-gray-700">
              Effective Until
            </Label>
            <Input
              id={untilId}
              type="date"
              value={effectiveUntil ?? ''}
              onChange={handleUntilChange}
              disabled={disabled}
              aria-label="Schedule effective until date"
            />
          </div>
        </div>
      </div>
    );
  }
);

ScheduleFormFields.displayName = 'ScheduleFormFields';
