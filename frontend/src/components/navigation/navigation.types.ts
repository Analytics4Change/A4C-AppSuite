import { OrganizationType } from '@/types/auth.types';

/** A single navigation link */
export interface NavItem {
  to: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  permission?: string;
  hideForOrgTypes?: OrganizationType[];
  showForOrgTypes?: OrganizationType[];
}

/** A collapsible group of nav items */
export interface NavGroup {
  key: string;
  label: string;
  items: NavItem[];
  hideForOrgTypes?: OrganizationType[];
  showForOrgTypes?: OrganizationType[];
}

/** A top-level navigation entry: either a standalone item or a group */
export type NavEntry = { type: 'item'; item: NavItem } | { type: 'group'; group: NavGroup };
