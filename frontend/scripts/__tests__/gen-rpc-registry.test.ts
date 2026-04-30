/**
 * Unit tests for `frontend/scripts/gen-rpc-registry.cjs` pure internals.
 *
 * Exercises the codegen's classify() and emitUnion() functions in isolation
 * (no psql / no DB). Specifically validates the overload-disagreement check
 * (architect review NT-1) which has no real-world trigger today — every
 * `api.*` overload pair currently agrees on shape.
 */

import { describe, it, expect } from 'vitest';

 
const { classify, emitUnion } = require('../gen-rpc-registry.cjs') as {
  classify: (rows: Array<{ name: string; args: string; shape: string }>) => {
    envelope: Set<string>;
    read: Set<string>;
    uncategorized: Set<string>;
    conflicts: Array<{ name: string; shapes: [string, string]; args: string }>;
  };
  emitUnion: (name: string, set: Set<string>) => string;
};

describe('gen-rpc-registry — classify()', () => {
  it('partitions rows into envelope and read sets by shape tag', () => {
    const rows = [
      { name: 'update_user', args: 'uuid, text, text', shape: 'envelope' },
      { name: 'list_users', args: 'uuid', shape: 'read' },
      { name: 'modify_user_roles', args: 'uuid, uuid[], uuid[], text', shape: 'envelope' },
    ];
    const { envelope, read, uncategorized, conflicts } = classify(rows);
    expect([...envelope].sort()).toEqual(['modify_user_roles', 'update_user']);
    expect([...read]).toEqual(['list_users']);
    expect(uncategorized.size).toBe(0);
    expect(conflicts).toEqual([]);
  });

  it('places untagged rows in uncategorized with name(args) format', () => {
    const rows = [
      { name: 'mystery_fn', args: 'uuid', shape: '' },
      { name: 'list_users', args: 'uuid', shape: 'read' },
    ];
    const { envelope, read, uncategorized, conflicts } = classify(rows);
    expect(envelope.size).toBe(0);
    expect([...read]).toEqual(['list_users']);
    expect([...uncategorized]).toEqual(['mystery_fn(uuid)']);
    expect(conflicts).toEqual([]);
  });

  it('treats matching-shape overloads as a single registry entry (no conflict)', () => {
    const rows = [
      {
        name: 'update_organization_direct_care_settings',
        args: 'uuid, boolean, boolean, text',
        shape: 'envelope',
      },
      {
        name: 'update_organization_direct_care_settings',
        args: 'uuid, boolean, boolean',
        shape: 'envelope',
      },
    ];
    const { envelope, conflicts } = classify(rows);
    expect([...envelope]).toEqual(['update_organization_direct_care_settings']);
    expect(conflicts).toEqual([]);
  });

  it('flags overload-shape disagreement (architect NT-1)', () => {
    // Synthetic case: two overloads of the same proname with different shape tags.
    // No real api.* RPCs trigger this today, so this test is the only proof
    // the check works.
    const rows = [
      { name: 'split_brain_fn', args: 'uuid', shape: 'envelope' },
      { name: 'split_brain_fn', args: 'uuid, text', shape: 'read' },
    ];
    const { conflicts } = classify(rows);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({
      name: 'split_brain_fn',
      shapes: ['envelope', 'read'],
      args: 'uuid, text',
    });
  });

  it('only reports the first disagreement when three overloads diverge', () => {
    const rows = [
      { name: 'three_way', args: 'uuid', shape: 'envelope' },
      { name: 'three_way', args: 'text', shape: 'read' },
      { name: 'three_way', args: 'uuid, text', shape: 'envelope' },
    ];
    const { conflicts } = classify(rows);
    // First disagreement: envelope vs read on the second row.
    // The third row matches the first-seen ('envelope'), so no second conflict.
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].shapes).toEqual(['envelope', 'read']);
  });

  it('handles empty input gracefully', () => {
    const { envelope, read, uncategorized, conflicts } = classify([]);
    expect(envelope.size).toBe(0);
    expect(read.size).toBe(0);
    expect(uncategorized.size).toBe(0);
    expect(conflicts).toEqual([]);
  });
});

describe('gen-rpc-registry — emitUnion()', () => {
  it('emits `never` for an empty set', () => {
    expect(emitUnion('UncategorizedRpcs', new Set())).toBe(
      'export type UncategorizedRpcs = never;'
    );
  });

  it('emits a sorted string-literal union', () => {
    const set = new Set(['zebra_fn', 'apple_fn', 'mango_fn']);
    const out = emitUnion('TestRpcs', set);
    expect(out).toBe("export type TestRpcs =\n  | 'apple_fn'\n  | 'mango_fn'\n  | 'zebra_fn';");
  });

  it('emits a single-entry union for one-item set', () => {
    const set = new Set(['only_fn']);
    expect(emitUnion('OneFn', set)).toBe("export type OneFn =\n  | 'only_fn';");
  });
});
