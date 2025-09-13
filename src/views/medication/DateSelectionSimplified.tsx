import React from 'react';
import { AlertCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useEnterAsTab } from '@/hooks/useEnterAsTab';

interface DateSelectionProps {
  startDate: string;
  discontinueDate: string;
  onStartDateChange: (date: string) => void;
  onDiscontinueDateChange: (date: string) => void;
  error?: string;
}

export const DateSelection: React.FC<DateSelectionProps> = ({
  startDate,
  discontinueDate,
  onStartDateChange,
  onDiscontinueDateChange,
  error
}) => {

  const handleStartDateInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onStartDateChange(e.target.value);
  };

  const handleDiscontinueDateInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onDiscontinueDateChange(e.target.value);
  };

  // Hook for Enter key navigation
  const handleStartDateEnterKey = useEnterAsTab(11); // Move to Discontinue Date
  const handleDiscontinueDateEnterKey = useEnterAsTab(12); // Move to Pharmacy Name

  return (
    <div className="grid grid-cols-2 gap-6">
      <div className="space-y-2 relative">
        <Label htmlFor="start-date" className="text-sm font-medium">
          Start Date
        </Label>
        <div className="relative">
          <Input
            id="start-date"
            type="date"
            value={startDate}
            onChange={handleStartDateInputChange}
            onKeyDown={(e) => {
              if (e.key === ' ') {
                e.preventDefault();
                // Trigger native date picker
                (e.currentTarget as HTMLInputElement).showPicker?.();
              } else if (e.key === 'Enter') {
                handleStartDateEnterKey(e);
              }
            }}
            className="cursor-pointer"
            aria-label="Start date"
            aria-describedby="start-date-format"
            tabIndex={10}
          />
        </div>
        <span id="start-date-format" className="text-xs text-gray-500">
          Type date or press Space to open picker
        </span>
      </div>

      <div className="space-y-2 relative">
        <Label htmlFor="discontinue-date" className="text-sm font-medium">
          Discontinue Date (Optional)
        </Label>
        <div className="relative">
          <Input
            id="discontinue-date"
            type="date"
            value={discontinueDate}
            onChange={handleDiscontinueDateInputChange}
            onKeyDown={(e) => {
              if (e.key === ' ') {
                e.preventDefault();
                // Trigger native date picker
                (e.currentTarget as HTMLInputElement).showPicker?.();
              } else if (e.key === 'Enter') {
                handleDiscontinueDateEnterKey(e);
              }
            }}
            className={`cursor-pointer ${error ? 'border-red-500' : ''}`}
            aria-label="Discontinue date"
            aria-describedby={error ? 'discontinue-date-error' : 'discontinue-date-format'}
            aria-invalid={!!error}
            tabIndex={11}
          />
        </div>
        
        {error ? (
          <div id="discontinue-date-error" className="flex items-center gap-1 text-red-600 text-xs">
            <AlertCircle size={12} />
            <span>{error}</span>
          </div>
        ) : (
          <span id="discontinue-date-format" className="text-xs text-gray-500">
            Type date or press Space to open picker
          </span>
        )}
      </div>
    </div>
  );
};