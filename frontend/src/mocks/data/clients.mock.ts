import { Client } from '@/types/models';

export const mockClients: Client[] = [
  {
    id: '1',
    firstName: 'John',
    lastName: 'Smith',
    dateOfBirth: new Date('1955-03-15'),
    gender: 'Male',
    contactInfo: {
      phone: '555-0100',
      email: 'john.smith@email.com',
      address: {
        street: '123 Main St',
        city: 'Springfield',
        state: 'IL',
        zipCode: '62701'
      }
    },
    emergencyContact: {
      name: 'Jane Smith',
      relationship: 'Spouse',
      phone: '555-0101'
    },
    medications: ['1', '2'],
    allergies: ['Penicillin'],
    medicalConditions: ['Type 2 Diabetes', 'Hypertension'],
    status: 'active'
  },
  {
    id: '2',
    firstName: 'Mary',
    lastName: 'Johnson',
    dateOfBirth: new Date('1948-07-22'),
    gender: 'Female',
    contactInfo: {
      phone: '555-0200',
      email: 'mary.johnson@email.com',
      address: {
        street: '456 Oak Ave',
        city: 'Springfield',
        state: 'IL',
        zipCode: '62702'
      }
    },
    emergencyContact: {
      name: 'Robert Johnson',
      relationship: 'Son',
      phone: '555-0201'
    },
    medications: ['3', '4', '5'],
    allergies: ['Sulfa drugs'],
    medicalConditions: ['Anxiety', 'Depression', 'Arthritis'],
    status: 'active'
  },
  {
    id: '3',
    firstName: 'Robert',
    lastName: 'Williams',
    dateOfBirth: new Date('1962-11-08'),
    gender: 'Male',
    contactInfo: {
      phone: '555-0300',
      email: 'robert.williams@email.com',
      address: {
        street: '789 Pine Rd',
        city: 'Springfield',
        state: 'IL',
        zipCode: '62703'
      }
    },
    emergencyContact: {
      name: 'Sarah Williams',
      relationship: 'Daughter',
      phone: '555-0301'
    },
    medications: [],
    allergies: [],
    medicalConditions: ['High Cholesterol'],
    status: 'active'
  }
];