/**
 * Unit tests for OU path <-> id helpers.
 */

import { describe, it, expect } from 'vitest';
import { getOUPathById, getOUIdByPath } from '../organizationUnitPath';
import type { OrganizationUnit } from '@/types/organization-unit.types';

function unit(
  overrides: Partial<OrganizationUnit> & Pick<OrganizationUnit, 'id' | 'path'>
): OrganizationUnit {
  return {
    name: overrides.name ?? overrides.path.split('.').slice(-1)[0],
    displayName: overrides.displayName ?? overrides.path.split('.').slice(-1)[0],
    parentPath: overrides.parentPath ?? null,
    parentId: overrides.parentId ?? null,
    timeZone: overrides.timeZone ?? 'UTC',
    isActive: overrides.isActive ?? true,
    childCount: overrides.childCount ?? 0,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
    ...overrides,
  };
}

const units: OrganizationUnit[] = [
  unit({ id: 'root-id', path: 'root.provider.acme' }),
  unit({
    id: 'main-id',
    path: 'root.provider.acme.main_campus',
    parentId: 'root-id',
    parentPath: 'root.provider.acme',
  }),
  unit({
    id: 'east-id',
    path: 'root.provider.acme.main_campus.east_wing',
    parentId: 'main-id',
    parentPath: 'root.provider.acme.main_campus',
  }),
];

describe('getOUPathById', () => {
  it('returns the matching unit path for a known id', () => {
    expect(getOUPathById(units, 'main-id')).toBe('root.provider.acme.main_campus');
    expect(getOUPathById(units, 'east-id')).toBe('root.provider.acme.main_campus.east_wing');
  });

  it('returns null when id is null or undefined', () => {
    expect(getOUPathById(units, null)).toBeNull();
    expect(getOUPathById(units, undefined)).toBeNull();
  });

  it('returns null when id is an empty string', () => {
    expect(getOUPathById(units, '')).toBeNull();
  });

  it('returns null when the id is not present in the list', () => {
    expect(getOUPathById(units, 'ghost-id')).toBeNull();
  });

  it('returns null when units is empty', () => {
    expect(getOUPathById([], 'main-id')).toBeNull();
  });
});

describe('getOUIdByPath', () => {
  it('returns the matching unit id for a known path', () => {
    expect(getOUIdByPath(units, 'root.provider.acme')).toBe('root-id');
    expect(getOUIdByPath(units, 'root.provider.acme.main_campus.east_wing')).toBe('east-id');
  });

  it('returns null when path is null or undefined', () => {
    expect(getOUIdByPath(units, null)).toBeNull();
    expect(getOUIdByPath(units, undefined)).toBeNull();
  });

  it('returns null when path is an empty string', () => {
    expect(getOUIdByPath(units, '')).toBeNull();
  });

  it('returns null when the path is not present in the list', () => {
    expect(getOUIdByPath(units, 'root.provider.unknown')).toBeNull();
  });

  it('is an exact match (no prefix matching)', () => {
    // A path that is a prefix of an existing path should not match.
    expect(getOUIdByPath(units, 'root.provider')).toBeNull();
  });

  it('round-trips with getOUPathById', () => {
    for (const u of units) {
      expect(getOUIdByPath(units, getOUPathById(units, u.id))).toBe(u.id);
      expect(getOUPathById(units, getOUIdByPath(units, u.path))).toBe(u.path);
    }
  });
});
