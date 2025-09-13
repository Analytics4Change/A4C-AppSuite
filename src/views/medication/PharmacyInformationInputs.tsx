import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useEnterAsTab } from '@/hooks/useEnterAsTab';

interface PharmacyInformationInputsProps {
  prescriberName: string;
  pharmacyName: string;
  pharmacyPhone: string;
  rxNumber: string;
  errors: Map<string, string>;
  onPrescriberNameChange: (value: string) => void;
  onPharmacyNameChange: (value: string) => void;
  onPharmacyPhoneChange: (value: string) => void;
  onRxNumberChange: (value: string) => void;
}

export const PharmacyInformationInputs: React.FC<PharmacyInformationInputsProps> = ({
  prescriberName,
  pharmacyName,
  pharmacyPhone,
  rxNumber,
  errors,
  onPrescriberNameChange,
  onPharmacyNameChange,
  onPharmacyPhoneChange,
  onRxNumberChange
}) => {
  // Hook for Enter key navigation
  const handlePrescriberNameEnterKey = useEnterAsTab(13); // Move to Pharmacy Name
  const handlePharmacyNameEnterKey = useEnterAsTab(14); // Move to Pharmacy Phone
  const handlePharmacyPhoneEnterKey = useEnterAsTab(15); // Move to RX Number
  const handleRxNumberEnterKey = useEnterAsTab(16); // Move to Inventory Quantity

  return (
    <div className="space-y-6">
      {/* First Row: Prescriber Name and Pharmacy Name */}
      <div className="grid grid-cols-2 gap-6">
        {/* Prescriber Name */}
        <div>
          <Label htmlFor="prescriber-name" className="text-base font-medium">
            Prescriber Name
          </Label>
          <Input
            id="prescriber-name"
            data-testid="prescriber-name-input"
            type="text"
            value={prescriberName}
            onChange={(e) => onPrescriberNameChange(e.target.value)}
            onKeyDown={handlePrescriberNameEnterKey}
            placeholder="e.g., Dr. Smith"
            className={`mt-2 ${prescriberName ? 'border-blue-500 bg-blue-50' : ''}`}
            aria-label="Prescriber name"
            tabIndex={12}
          />
        </div>

        {/* Pharmacy Name */}
        <div>
          <Label htmlFor="pharmacy-name" className="text-base font-medium">
            Pharmacy Name
          </Label>
          <Input
            id="pharmacy-name"
            data-testid="pharmacy-name-input"
            type="text"
            value={pharmacyName}
            onChange={(e) => onPharmacyNameChange(e.target.value)}
            onKeyDown={handlePharmacyNameEnterKey}
            placeholder="e.g., Walgreens"
            className={`mt-2 ${pharmacyName ? 'border-blue-500 bg-blue-50' : ''}`}
            aria-label="Pharmacy name"
            tabIndex={13}
          />
        </div>
      </div>

      {/* Second Row: Pharmacy Phone and RX Number */}
      <div className="grid grid-cols-2 gap-6">
        {/* Pharmacy Phone Number */}
        <div>
          <Label htmlFor="pharmacy-phone" className="text-base font-medium">
            Pharmacy Phone Number
          </Label>
          <Input
            id="pharmacy-phone"
            data-testid="pharmacy-phone-input"
            type="tel"
            value={pharmacyPhone}
            onChange={(e) => onPharmacyPhoneChange(e.target.value)}
            onKeyDown={handlePharmacyPhoneEnterKey}
            placeholder="e.g., (555) 123-4567"
            className={`mt-2 ${pharmacyPhone ? 'border-blue-500 bg-blue-50' : ''} ${errors.get('pharmacyPhone') ? 'border-red-500' : ''}`}
            aria-label="Pharmacy phone number"
            aria-describedby={errors.get('pharmacyPhone') ? 'pharmacy-phone-error' : undefined}
            aria-invalid={!!errors.get('pharmacyPhone')}
            tabIndex={14}
          />
          {errors.get('pharmacyPhone') && (
            <p id="pharmacy-phone-error" className="mt-1 text-sm text-red-600" role="alert">
              {errors.get('pharmacyPhone')}
            </p>
          )}
        </div>

        {/* RX Number */}
        <div>
          <Label htmlFor="rx-number" className="text-base font-medium">
            RX Number
          </Label>
          <Input
            id="rx-number"
            data-testid="rx-number-input"
            type="text"
            value={rxNumber}
            onChange={(e) => onRxNumberChange(e.target.value)}
            onKeyDown={handleRxNumberEnterKey}
            placeholder="e.g., RX123456"
            className={`mt-2 ${rxNumber ? 'border-blue-500 bg-blue-50' : ''}`}
            aria-label="RX number"
            tabIndex={15}
          />
        </div>
      </div>
    </div>
  );
};