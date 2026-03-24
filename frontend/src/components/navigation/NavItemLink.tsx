import React from 'react';
import { NavLink } from 'react-router-dom';
import type { NavItem } from './navigation.types';

interface NavItemLinkProps {
  item: NavItem;
  onClick: () => void;
  indented?: boolean;
}

/** Single navigation link with glassmorphism styling */
export const NavItemLink: React.FC<NavItemLinkProps> = ({ item, onClick, indented = false }) => {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      data-testid={`nav-link-${item.to}`}
      className={({ isActive }) => `
        flex items-center gap-3 px-4 py-3 rounded-xl
        transition-all duration-300 group
        ${indented ? 'ml-4' : ''}
        ${isActive ? 'glass-nav-active' : 'glass-nav-inactive'}
      `}
      onClick={onClick}
    >
      <Icon size={20} aria-hidden="true" />
      <span className="font-medium">{item.label}</span>
    </NavLink>
  );
};
