export interface Client {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: Date;
  gender?: 'Male' | 'Female' | 'Other';
  contactInfo?: ContactInfo;
  emergencyContact?: EmergencyContact;
  medications?: string[]; // Array of medication IDs
  allergies?: string[];
  medicalConditions?: string[];
  status: 'active' | 'inactive';
}

export interface ContactInfo {
  phone?: string;
  email?: string;
  address?: Address;
}

export interface Address {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country?: string;
}

export interface EmergencyContact {
  name: string;
  relationship: string;
  phone: string;
  alternatePhone?: string;
}