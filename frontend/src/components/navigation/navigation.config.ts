import {
  Users,
  Building,
  FolderTree,
  Shield,
  UsersRound,
  Calendar,
  UserCheck,
  Pill,
  FileText,
  Settings,
  AlertTriangle,
  Trash2,
} from 'lucide-react';
import type { NavEntry } from './navigation.types';

/**
 * Navigation structure configuration.
 *
 * Provider view: Clinical group + Staff & Organization group + ungrouped items
 * Platform Owner view: Admin group + ungrouped items
 * Provider Partner view: flat list (no groups)
 *
 * Filtering by showForOrgTypes/hideForOrgTypes + hasPermission happens at runtime
 * in useFilteredNavEntries.
 */
export const NAVIGATION_CONFIG: NavEntry[] = [
  // Group: Clinical (provider only)
  {
    type: 'group',
    group: {
      key: 'clinical',
      label: 'Clinical',
      showForOrgTypes: ['provider'],
      items: [
        { to: '/clients', icon: Users, label: 'Clients' },
        { to: '/medications', icon: Pill, label: 'Medications' },
        {
          to: '/assignments',
          icon: UserCheck,
          label: 'Client Assignments',
          permission: 'user.client_assign',
        },
      ],
    },
  },

  // Ungrouped: Clients for provider_partner (not in clinical group)
  {
    type: 'item',
    item: {
      to: '/clients',
      icon: Users,
      label: 'Clients',
      showForOrgTypes: ['provider_partner'],
    },
  },

  // Group: Staff & Organization (provider only)
  {
    type: 'group',
    group: {
      key: 'staff-org',
      label: 'Staff & Organization',
      showForOrgTypes: ['provider'],
      items: [
        {
          to: '/organization-units',
          icon: FolderTree,
          label: 'Organization Units',
          permission: 'organization.view_ou',
        },
        { to: '/roles', icon: Shield, label: 'Roles', permission: 'role.create' },
        { to: '/users', icon: UsersRound, label: 'User Management', permission: 'user.view' },
        {
          to: '/schedules',
          icon: Calendar,
          label: 'Staff Schedules',
          permission: 'user.schedule_manage',
        },
      ],
    },
  },

  // Ungrouped: Organizations (all org types with permission)
  {
    type: 'item',
    item: {
      to: '/organizations',
      icon: Building,
      label: 'Organizations',
      permission: 'organization.update',
    },
  },

  // Group: Admin (platform_owner only)
  {
    type: 'group',
    group: {
      key: 'admin',
      label: 'Admin',
      showForOrgTypes: ['platform_owner'],
      items: [
        {
          to: '/admin/events',
          icon: AlertTriangle,
          label: 'Event Monitor',
          permission: 'organization.create',
        },
        {
          to: '/admin/deletions',
          icon: Trash2,
          label: 'Deletion Monitor',
          permission: 'organization.delete',
        },
      ],
    },
  },

  // Ungrouped: Reports (always visible)
  { type: 'item', item: { to: '/reports', icon: FileText, label: 'Reports' } },

  // Ungrouped: Settings (always visible)
  { type: 'item', item: { to: '/settings', icon: Settings, label: 'Settings' } },
];
