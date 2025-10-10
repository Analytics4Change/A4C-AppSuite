/**
 * Example usage of FocusTrappedCheckboxGroup with comprehensive ARIA support
 */

import React, { useState } from 'react';
import { FocusTrappedCheckboxGroup } from './FocusTrappedCheckboxGroup';

export const ExampleUsage = () => {
  const [selectedTimings, setSelectedTimings] = useState<string[]>([]);
  const [hasError, setHasError] = useState(false);

  // Example 1: Basic usage with minimal ARIA
  const BasicExample = () => (
    <FocusTrappedCheckboxGroup
      id="basic-timing"
      title="Dosage Timing"
      items={[
        { id: 'qxh', label: 'Every X Hours - QxH' },
        { id: 'qam', label: 'Every Morning - QAM' },
        { id: 'qpm', label: 'Every Evening - QPM' },
        { id: 'qhs', label: 'Every Night at Bedtime - QHS' }
      ]}
      selectedIds={selectedTimings}
      onSelectionChange={setSelectedTimings}
      onCancel={() => console.log('Cancelled')}
      onContinue={(ids) => console.log('Selected:', ids)}
      baseTabIndex={10}
    />
  );

  // Example 2: Full ARIA support with validation
  const FullAriaExample = () => (
    <>
      {/* External instructions that can be referenced */}
      <div id="timing-instructions" className="sr-only">
        Select all times when medication should be taken. 
        Use arrow keys to navigate between options and space to select.
      </div>

      {/* External label that can be referenced */}
      <h2 id="timing-section-title">Medication Schedule</h2>

      <FocusTrappedCheckboxGroup
        id="advanced-timing"
        title="Dosage Timing"
        items={[
          { 
            id: 'qxh', 
            label: 'Every X Hours - QxH',
            description: 'Medication taken at regular hourly intervals'
          },
          { 
            id: 'qam', 
            label: 'Every Morning - QAM',
            description: 'Once daily in the morning'
          },
          { 
            id: 'qpm', 
            label: 'Every Evening - QPM',
            description: 'Once daily in the evening'
          },
          { 
            id: 'qhs', 
            label: 'Every Night at Bedtime - QHS',
            description: 'Once daily at bedtime'
          }
        ]}
        selectedIds={selectedTimings}
        onSelectionChange={(ids) => {
          setSelectedTimings(ids);
          setHasError(ids.length === 0);
        }}
        onCancel={() => {
          setSelectedTimings([]);
          setHasError(false);
        }}
        onContinue={(ids) => {
          if (ids.length === 0) {
            setHasError(true);
          } else {
            console.log('Confirmed timing:', ids);
          }
        }}
        baseTabIndex={20}
        nextTabIndex={30}
        isCollapsible={true}
        
        // ARIA Labels and Descriptions
        ariaLabelledBy="timing-section-title"
        instructionsId="timing-instructions"
        
        // Validation Support
        isRequired={true}
        hasError={hasError}
        errorMessage="Please select at least one dosage timing"
        errorMessageId="timing-error"
        
        // Help Text
        helpText="Select when the medication should be taken. Multiple selections allowed."
        helpTextId="timing-help"
      />
    </>
  );

  // Example 3: Custom ARIA IDs for integration with form validation
  const FormIntegrationExample = () => (
    <form aria-describedby="form-instructions">
      <div id="form-instructions" className="mb-4 text-sm text-gray-600">
        Complete all required fields to submit the prescription.
      </div>

      <FocusTrappedCheckboxGroup
        id="form-timing"
        title="Prescription Schedule"
        items={[
          { id: 'morning', label: 'Morning (6AM - 12PM)' },
          { id: 'afternoon', label: 'Afternoon (12PM - 6PM)' },
          { id: 'evening', label: 'Evening (6PM - 12AM)' },
          { id: 'night', label: 'Night (12AM - 6AM)' }
        ]}
        selectedIds={selectedTimings}
        onSelectionChange={setSelectedTimings}
        onCancel={() => setSelectedTimings([])}
        onContinue={(ids) => console.log('Schedule set:', ids)}
        baseTabIndex={1}
        
        // Custom ARIA IDs for external validation system
        ariaLabel="Prescription timing schedule"
        ariaDescribedBy="schedule-description schedule-warning"
        errorMessageId="schedule-validation-error"
        helpTextId="schedule-help-text"
        
        isRequired={true}
        hasError={hasError}
        errorMessage="Schedule is required for prescription"
      />

      {/* External elements referenced by ARIA */}
      <div id="schedule-description" className="mt-2 text-sm">
        This schedule will be used for automated reminders.
      </div>
      <div id="schedule-warning" className="mt-1 text-sm text-orange-600">
        Changes to schedule require physician approval.
      </div>
    </form>
  );

  // Example 4: Screen reader optimized with live regions
  const ScreenReaderExample = () => (
    <>
      {/* Live region for dynamic announcements */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {selectedTimings.length > 0 && 
          `${selectedTimings.length} timing options selected`
        }
      </div>

      <FocusTrappedCheckboxGroup
        id="sr-timing"
        title="Accessible Timing Selection"
        items={[
          { 
            id: 'bid', 
            label: 'Twice Daily - BID',
            description: 'Take medication twice per day, typically morning and evening'
          },
          { 
            id: 'tid', 
            label: 'Three Times Daily - TID',
            description: 'Take medication three times per day with meals'
          },
          { 
            id: 'qid', 
            label: 'Four Times Daily - QID',
            description: 'Take medication four times per day, every 6 hours'
          },
          { 
            id: 'prn', 
            label: 'As Needed - PRN',
            description: 'Take medication only when symptoms occur'
          }
        ]}
        selectedIds={selectedTimings}
        onSelectionChange={setSelectedTimings}
        onCancel={() => setSelectedTimings([])}
        onContinue={(ids) => console.log('Timing confirmed:', ids)}
        baseTabIndex={40}
        
        // Comprehensive ARIA for screen readers
        ariaLabel="Medication frequency selection"
        helpText="Use arrow keys to navigate options. Press space to select or deselect. Press Tab to move to action buttons."
        isRequired={false}
        hasError={false}
      />
    </>
  );

  return (
    <div className="space-y-8 p-4">
      <BasicExample />
      <FullAriaExample />
      <FormIntegrationExample />
      <ScreenReaderExample />
    </div>
  );
};

/**
 * ARIA Attributes Reference:
 * 
 * Component supports the following ARIA patterns:
 * 
 * 1. GROUP LABELING:
 *    - aria-label: Direct label for the group
 *    - aria-labelledby: Reference to external label element
 *    - Automatic ID generation for internal title
 * 
 * 2. DESCRIPTIONS & INSTRUCTIONS:
 *    - aria-describedby: Combines multiple description sources
 *    - helpText with auto-generated or custom ID
 *    - instructionsId for external instructions
 *    - Item-level descriptions
 * 
 * 3. VALIDATION & ERRORS:
 *    - aria-required: Indicates required field
 *    - aria-invalid: Indicates error state
 *    - aria-errormessage: Points to error message
 *    - role="alert" on error messages
 *    - aria-live="polite" for dynamic updates
 * 
 * 4. STATE MANAGEMENT:
 *    - aria-expanded: Collapsible state
 *    - aria-checked: Checkbox selection state
 *    - aria-disabled: Disabled items (future)
 * 
 * 5. NAVIGATION HINTS:
 *    - role="group" on container
 *    - role="checkbox" on items
 *    - Descriptive aria-labels on all interactive elements
 * 
 * Screen Reader Testing Checklist:
 * - [ ] Group title is announced
 * - [ ] Required status is announced
 * - [ ] Help text is read when entering group
 * - [ ] Error messages are announced
 * - [ ] Selection state changes are announced
 * - [ ] Navigation instructions are available
 * - [ ] Item descriptions are read when focused
 */