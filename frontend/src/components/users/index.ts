/**
 * User Components Module
 *
 * Exports all user management components including:
 * - User cards and lists for display
 * - Invitation list for pending invitations
 * - Form fields for user invitation/edit
 * - Display cards for addresses and phones
 * - Forms for adding/editing addresses, phones, notifications, and access dates
 */

// Core user components
export { UserCard } from './UserCard';
export type { UserCardProps } from './UserCard';

export { UserList } from './UserList';
export type { UserListProps } from './UserList';

export { InvitationList } from './InvitationList';
export type { InvitationListProps } from './InvitationList';

export { UserFormFields } from './UserFormFields';
export type { UserFormFieldsProps } from './UserFormFields';

// Display components
export { AddressCard } from './AddressCard';
export type { AddressCardProps } from './AddressCard';

export { PhoneCard } from './PhoneCard';
export type { PhoneCardProps } from './PhoneCard';

// Form components
export { UserAddressForm } from './UserAddressForm';
export type { UserAddressFormProps, AddressFormData } from './UserAddressForm';

export { UserPhoneForm } from './UserPhoneForm';
export type { UserPhoneFormProps, PhoneFormData } from './UserPhoneForm';

export { NotificationPreferencesForm } from './NotificationPreferencesForm';
export type { NotificationPreferencesFormProps } from './NotificationPreferencesForm';

export { AccessDatesForm } from './AccessDatesForm';
export type { AccessDatesFormProps, AccessDatesFormData } from './AccessDatesForm';

// Section components (orchestrate multiple sub-components)
export { UserPhonesSection } from './UserPhonesSection';
export type { UserPhonesSectionProps } from './UserPhonesSection';
