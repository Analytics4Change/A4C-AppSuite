import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InvitationAcceptanceViewModel } from '../InvitationAcceptanceViewModel';
import type { IInvitationService } from '@/services/invitation/IInvitationService';
import type { IAuthProvider } from '@/services/auth/IAuthProvider';
import type { InvitationDetails, AcceptInvitationResult } from '@/types';

// Shared storage mock so OAuth-context persistence is assertable (vi.mock is hoisted).
const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    setItem: vi.fn().mockResolvedValue(undefined),
    getItem: vi.fn().mockResolvedValue(null),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/services/storage', () => ({
  getAuthContextStorage: () => mockStorage,
}));

vi.mock('@/utils/platform', () => ({
  detectPlatform: () => 'web',
  getCallbackUrl: () => 'https://app.example.com/auth/callback',
}));

// ── Test fixtures ──────────────────────────────────────────────────────────

function validDetails(overrides: Partial<InvitationDetails> = {}): InvitationDetails {
  return {
    orgName: 'Acme Health',
    roles: [{ role_id: 'role-1', role_name: 'Viewer' }],
    inviterName: 'Jane Admin',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    email: 'invitee@example.com',
    ...overrides,
  };
}

const validResult: AcceptInvitationResult = {
  userId: 'user-1',
  orgId: 'org-1',
  redirectUrl: '/dashboard',
};

function makeService(overrides: Partial<IInvitationService> = {}): IInvitationService {
  return {
    validateInvitation: vi.fn().mockResolvedValue(validDetails()),
    acceptInvitation: vi.fn().mockResolvedValue(validResult),
    resendInvitation: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function makeAuthProvider(): IAuthProvider {
  return { loginWithOAuth: vi.fn().mockResolvedValue(undefined) } as unknown as IAuthProvider;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('InvitationAcceptanceViewModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('starts with no invitation details, idle state, and empty credentials', () => {
      const vm = new InvitationAcceptanceViewModel(makeService());
      expect(vm.invitationDetails).toBeNull();
      expect(vm.isValidatingToken).toBe(false);
      expect(vm.isAccepting).toBe(false);
      expect(vm.validationError).toBeNull();
      expect(vm.acceptanceError).toBeNull();
      expect(vm.password).toBe('');
      expect(vm.isTokenValid).toBe(false);
    });
  });

  describe('validateToken', () => {
    it('stores details, pre-fills email, and marks the token valid', async () => {
      const service = makeService();
      const vm = new InvitationAcceptanceViewModel(service);

      const ok = await vm.validateToken('tok-123');

      expect(ok).toBe(true);
      expect(service.validateInvitation).toHaveBeenCalledWith('tok-123');
      expect(vm.invitationDetails?.orgName).toBe('Acme Health');
      expect(vm.email).toBe('invitee@example.com');
      expect(vm.isTokenValid).toBe(true);
      expect(vm.isValidatingToken).toBe(false);
    });

    it('sets isValidatingToken while the request is in flight', async () => {
      const d = deferred<InvitationDetails>();
      const service = makeService({ validateInvitation: vi.fn().mockReturnValue(d.promise) });
      const vm = new InvitationAcceptanceViewModel(service);

      const pending = vm.validateToken('tok');
      expect(vm.isValidatingToken).toBe(true);

      d.resolve(validDetails());
      await pending;
      expect(vm.isValidatingToken).toBe(false);
    });

    it('surfaces an invalid/expired/already-accepted token as a validationError', async () => {
      const service = makeService({
        validateInvitation: vi.fn().mockRejectedValue(new Error('Invitation has expired')),
      });
      const vm = new InvitationAcceptanceViewModel(service);

      const ok = await vm.validateToken('tok');

      expect(ok).toBe(false);
      expect(vm.validationError).toBe('Invitation has expired');
      expect(vm.isTokenValid).toBe(false);
      expect(vm.invitationDetails).toBeNull();
    });
  });

  describe('credential setters', () => {
    it('updates fields and clears the corresponding field error', () => {
      const vm = new InvitationAcceptanceViewModel(makeService());
      vm.setPassword('secret12');
      vm.setConfirmPassword('secret12');
      vm.setEmail('user@example.com');
      expect(vm.password).toBe('secret12');
      expect(vm.confirmPassword).toBe('secret12');
      expect(vm.email).toBe('user@example.com');
      expect(vm.passwordError).toBeNull();
      expect(vm.emailError).toBeNull();
    });
  });

  describe('acceptWithEmailPassword', () => {
    async function validatedVm(service = makeService()) {
      const vm = new InvitationAcceptanceViewModel(service);
      await vm.validateToken('tok-123');
      return vm;
    }

    it('accepts with valid credentials and returns the result', async () => {
      const service = makeService();
      const vm = await validatedVm(service);
      vm.setPassword('SecurePass123');
      vm.setConfirmPassword('SecurePass123');

      const result = await vm.acceptWithEmailPassword();

      expect(result).toEqual(validResult);
      expect(service.acceptInvitation).toHaveBeenCalledWith('tok-123', {
        email: 'invitee@example.com',
        password: 'SecurePass123',
      });
      expect(vm.acceptanceResult).toEqual(validResult);
      expect(vm.redirectUrl).toBe('/dashboard');
    });

    it('does not accept without a password', async () => {
      const service = makeService();
      const vm = await validatedVm(service);

      const result = await vm.acceptWithEmailPassword();

      expect(result).toBeNull();
      expect(vm.passwordError).toBe('Password is required');
      expect(service.acceptInvitation).not.toHaveBeenCalled();
    });

    it('rejects a too-short password and a confirmation mismatch', async () => {
      const vm = await validatedVm();
      vm.setPassword('short');
      vm.setConfirmPassword('short');
      expect(await vm.acceptWithEmailPassword()).toBeNull();
      expect(vm.passwordError).toMatch(/at least 8/);

      vm.setPassword('SecurePass123');
      vm.setConfirmPassword('different');
      expect(await vm.acceptWithEmailPassword()).toBeNull();
      expect(vm.confirmPasswordError).toMatch(/do not match/);
    });

    it('does not accept without a validated token', async () => {
      const vm = new InvitationAcceptanceViewModel(makeService());
      vm.setPassword('SecurePass123');
      vm.setConfirmPassword('SecurePass123');
      expect(await vm.acceptWithEmailPassword()).toBeNull();
    });

    it('sets isAccepting while the request is in flight', async () => {
      const d = deferred<AcceptInvitationResult>();
      const service = makeService({ acceptInvitation: vi.fn().mockReturnValue(d.promise) });
      const vm = await validatedVm(service);
      vm.setPassword('SecurePass123');
      vm.setConfirmPassword('SecurePass123');

      const pending = vm.acceptWithEmailPassword();
      expect(vm.isAccepting).toBe(true);

      d.resolve(validResult);
      await pending;
      expect(vm.isAccepting).toBe(false);
    });

    it('surfaces an acceptance error', async () => {
      const service = makeService({
        acceptInvitation: vi.fn().mockRejectedValue(new Error('Email already registered')),
      });
      const vm = await validatedVm(service);
      vm.setPassword('SecurePass123');
      vm.setConfirmPassword('SecurePass123');

      const result = await vm.acceptWithEmailPassword();

      expect(result).toBeNull();
      expect(vm.acceptanceError).toBe('Email already registered');
    });
  });

  describe('acceptWithOAuth', () => {
    it('stores the invitation context and initiates the provider redirect', async () => {
      const vm = new InvitationAcceptanceViewModel(makeService());
      await vm.validateToken('tok-123'); // pre-fills a valid email
      const authProvider = makeAuthProvider();

      await vm.acceptWithOAuth('google', authProvider);

      expect(mockStorage.setItem).toHaveBeenCalled();
      expect(authProvider.loginWithOAuth).toHaveBeenCalledWith(
        'google',
        expect.objectContaining({ redirectTo: expect.any(String) })
      );
    });

    it('sets acceptanceError when there is no token', async () => {
      const vm = new InvitationAcceptanceViewModel(makeService());
      const authProvider = makeAuthProvider();

      await vm.acceptWithOAuth('google', authProvider);

      expect(vm.acceptanceError).toBe('Missing invitation token');
      expect(authProvider.loginWithOAuth).not.toHaveBeenCalled();
    });

    it('sets emailError when the email is invalid', async () => {
      const service = makeService({
        validateInvitation: vi.fn().mockResolvedValue(validDetails({ email: undefined })),
      });
      const vm = new InvitationAcceptanceViewModel(service);
      await vm.validateToken('tok-123');
      vm.setEmail('not-an-email');
      const authProvider = makeAuthProvider();

      await vm.acceptWithOAuth('google', authProvider);

      expect(vm.emailError).toMatch(/Valid email is required/);
      expect(authProvider.loginWithOAuth).not.toHaveBeenCalled();
    });
  });

  describe('computed properties & reset', () => {
    it('canSubmit reflects a valid token, non-empty email, and not-accepting', async () => {
      const vm = new InvitationAcceptanceViewModel(makeService());
      expect(vm.canSubmit).toBe(false);
      await vm.validateToken('tok-123');
      expect(vm.canSubmit).toBe(true);
    });

    it('reset returns the ViewModel to its initial state', async () => {
      const vm = new InvitationAcceptanceViewModel(makeService());
      await vm.validateToken('tok-123');
      vm.setPassword('SecurePass123');

      vm.reset();

      expect(vm.token).toBeNull();
      expect(vm.invitationDetails).toBeNull();
      expect(vm.password).toBe('');
      expect(vm.isTokenValid).toBe(false);
    });
  });
});
