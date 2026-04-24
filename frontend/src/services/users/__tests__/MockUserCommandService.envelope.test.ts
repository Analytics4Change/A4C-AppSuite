/**
 * MockUserCommandService — envelope contract tests (Blocker 3)
 *
 * Verifies that the narrowed result types established in
 * `feat/phase4-user-domain-typing` correctly propagate read-back entities
 * through the Mock service so consumer VMs can patch their state in place
 * per `documentation/frontend/patterns/rpc-readback-vm-patch.md`.
 *
 * Contract surface under test:
 * - `addUserPhone` returns `{success, phoneId, phone}` (UserPhoneResult)
 * - `updateUserPhone` returns `{success, phoneId, phone}` (UserPhoneResult)
 * - `updateUser` returns `{success, user}` (UpdateUserResult)
 * - `updateNotificationPreferences` returns
 *   `{success, notificationPreferences}` (UpdateNotificationPreferencesResult)
 *
 * See also: `adr-rpc-readback-pattern.md` for the Pattern A v2 contract.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockUserCommandService } from '../MockUserCommandService';
import { MockUserQueryService } from '../MockUserQueryService';

describe('MockUserCommandService — envelope contracts', () => {
  let commandService: MockUserCommandService;
  let queryService: MockUserQueryService;

  beforeEach(() => {
    // Clear any persisted mock state so each test starts from seed defaults
    localStorage.clear();
    queryService = new MockUserQueryService();
    commandService = new MockUserCommandService(queryService);
  });

  // -------------------------------------------------------------------------
  // addUserPhone — UserPhoneResult with populated `phone`
  // -------------------------------------------------------------------------
  describe('addUserPhone', () => {
    it('returns the refreshed phone entity in the success envelope', async () => {
      // Use the first seeded user
      const users = await queryService.getUsersPaginated();
      // First active user (skip invitations in the seeded list)
      const user = users.items.find((u) => !u.isInvitation)!;
      expect(user).toBeDefined();

      const result = await commandService.addUserPhone({
        userId: user.id,
        orgId: null,
        label: 'Mobile',
        type: 'mobile',
        number: '555-010-1234',
        countryCode: '+1',
        isPrimary: false,
        smsCapable: true,
      });

      expect(result.success).toBe(true);
      expect(result.phoneId).toBeDefined();
      expect(result.phone).toBeDefined();
      expect(result.phone?.id).toBe(result.phoneId);
      expect(result.phone?.userId).toBe(user.id);
      expect(result.phone?.number).toBe('555-010-1234');
      expect(result.phone?.type).toBe('mobile');
      expect(result.phone?.smsCapable).toBe(true);
      expect(result.phone?.isActive).toBe(true);
    });

    it('surfaces validation errors without populating phone', async () => {
      const users = await queryService.getUsersPaginated();
      // First active user (skip invitations in the seeded list)
      const user = users.items.find((u) => !u.isInvitation)!;

      const result = await commandService.addUserPhone({
        userId: user.id,
        orgId: null,
        label: 'Mobile',
        type: 'mobile',
        number: 'not a phone number',
      });

      expect(result.success).toBe(false);
      expect(result.phone).toBeUndefined();
      expect(result.error).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // updateUserPhone — UserPhoneResult with populated `phone`
  // -------------------------------------------------------------------------
  describe('updateUserPhone', () => {
    it('returns the refreshed phone entity after a successful update', async () => {
      const users = await queryService.getUsersPaginated();
      // First active user (skip invitations in the seeded list)
      const user = users.items.find((u) => !u.isInvitation)!;

      // Seed a phone to update
      const added = await commandService.addUserPhone({
        userId: user.id,
        orgId: null,
        label: 'Mobile',
        type: 'mobile',
        number: '555-010-0001',
      });
      expect(added.phoneId).toBeDefined();

      const result = await commandService.updateUserPhone({
        phoneId: added.phoneId!,
        updates: { label: 'Cell', isPrimary: true },
      });

      expect(result.success).toBe(true);
      expect(result.phone).toBeDefined();
      expect(result.phone?.id).toBe(added.phoneId);
      expect(result.phone?.label).toBe('Cell');
      expect(result.phone?.isPrimary).toBe(true);
      // Unmodified fields preserved
      expect(result.phone?.number).toBe('555-010-0001');
    });

    it('returns an error envelope without phone on unknown phoneId', async () => {
      const result = await commandService.updateUserPhone({
        phoneId: '00000000-0000-0000-0000-000000000000',
        updates: { label: 'X' },
      });
      expect(result.success).toBe(false);
      expect(result.phone).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // updateUser — UpdateUserResult with populated `user`
  // -------------------------------------------------------------------------
  describe('updateUser', () => {
    it('returns the refreshed user entity after a successful update', async () => {
      const users = await queryService.getUsersPaginated();
      // First active user (skip invitations in the seeded list)
      const user = users.items.find((u) => !u.isInvitation)!;

      const result = await commandService.updateUser({
        userId: user.id,
        firstName: 'Updated',
        lastName: 'Name',
      });

      expect(result.success).toBe(true);
      expect(result.user).toBeDefined();
      expect(result.user?.id).toBe(user.id);
      expect(result.user?.firstName).toBe('Updated');
      expect(result.user?.lastName).toBe('Name');
      expect(result.user?.name).toBe('Updated Name');
    });
  });

  // -------------------------------------------------------------------------
  // updateNotificationPreferences — includes `notificationPreferences` echo
  // -------------------------------------------------------------------------
  describe('updateNotificationPreferences', () => {
    it('echoes the submitted preferences in the success envelope', async () => {
      const users = await queryService.getUsersPaginated();
      // First active user (skip invitations in the seeded list)
      const user = users.items.find((u) => !u.isInvitation)!;

      // Seed an SMS-capable phone so SMS validation passes
      const phoneResult = await commandService.addUserPhone({
        userId: user.id,
        orgId: null,
        label: 'Mobile',
        type: 'mobile',
        number: '555-010-0002',
        smsCapable: true,
      });

      const prefs = {
        email: true,
        sms: { enabled: true, phoneId: phoneResult.phoneId! },
        inApp: false,
      };

      const result = await commandService.updateNotificationPreferences({
        userId: user.id,
        orgId: 'org-test',
        notificationPreferences: prefs,
      });

      expect(result.success).toBe(true);
      expect(result.notificationPreferences).toEqual(prefs);
    });

    it('returns an error envelope when SMS phone is not SMS-capable', async () => {
      const users = await queryService.getUsersPaginated();
      // First active user (skip invitations in the seeded list)
      const user = users.items.find((u) => !u.isInvitation)!;

      const phoneResult = await commandService.addUserPhone({
        userId: user.id,
        orgId: null,
        label: 'Home',
        type: 'office',
        number: '555-010-0003',
        smsCapable: false,
      });

      const result = await commandService.updateNotificationPreferences({
        userId: user.id,
        orgId: 'org-test',
        notificationPreferences: {
          email: true,
          sms: { enabled: true, phoneId: phoneResult.phoneId! },
          inApp: true,
        },
      });

      expect(result.success).toBe(false);
      expect(result.notificationPreferences).toBeUndefined();
      expect(result.error).toBeDefined();
    });
  });
});
