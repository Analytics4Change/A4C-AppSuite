/**
 * Impersonation Service
 * Allows super administrators to temporarily act as other users for support
 * All actions are logged for audit trail
 */

import { Logger } from '@/utils/logger';

const log = Logger.getLogger('api');

export interface ImpersonationConfig {
  maxDurationMinutes: number;
  warningMinutesRemaining: number;
  requireReason: boolean;
  blockedActions: string[];
}

export interface ImpersonationContext {
  actualUserId: string;
  actualUserEmail: string;
  actualUserRole: string;
  impersonatedUserId: string;
  impersonatedUserEmail: string;
  impersonatedUserRole: string;
  startTime: Date;
  expiresAt: Date;
  reason?: string;
}

export interface ImpersonationSession {
  context: ImpersonationContext;
  timeRemaining: number; // minutes
  isExpired: boolean;
  isWarning: boolean;
}

class ImpersonationService {
  private static instance: ImpersonationService;
  private currentSession: ImpersonationContext | null = null;
  private expirationTimer: NodeJS.Timeout | null = null;
  private warningTimer: NodeJS.Timeout | null = null;
  private onExpirationCallbacks: Array<() => void> = [];
  private onWarningCallbacks: Array<() => void> = [];

  private config: ImpersonationConfig = {
    maxDurationMinutes: 30,
    warningMinutesRemaining: 5,
    requireReason: true,
    blockedActions: [
      'users.impersonate',  // Can't chain impersonation
      'global_roles.create', // Too dangerous
      'provider.delete',     // Too dangerous
      'cross_org.grant'      // Too dangerous
    ]
  };

  private constructor() {
    // Load session from sessionStorage if exists (survives page refresh)
    this.loadSession();
  }

  static getInstance(): ImpersonationService {
    if (!ImpersonationService.instance) {
      ImpersonationService.instance = new ImpersonationService();
    }
    return ImpersonationService.instance;
  }

  /**
   * Start impersonation session
   */
  async startImpersonation(
    actualUser: { id: string; email: string; role: string },
    targetUser: { id: string; email: string; role: string },
    reason?: string
  ): Promise<ImpersonationContext> {
    // Check if already impersonating
    if (this.currentSession) {
      throw new Error('Already impersonating a user. End current session first.');
    }

    // Validate reason if required
    if (this.config.requireReason && !reason) {
      throw new Error('Reason is required for impersonation');
    }

    // Check if user has permission to impersonate
    if (actualUser.role !== 'super_admin') {
      throw new Error('Only super administrators can impersonate users');
    }

    // Can't impersonate another super admin
    if (targetUser.role === 'super_admin') {
      throw new Error('Cannot impersonate another super administrator');
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.maxDurationMinutes * 60 * 1000);

    this.currentSession = {
      actualUserId: actualUser.id,
      actualUserEmail: actualUser.email,
      actualUserRole: actualUser.role,
      impersonatedUserId: targetUser.id,
      impersonatedUserEmail: targetUser.email,
      impersonatedUserRole: targetUser.role,
      startTime: now,
      expiresAt,
      reason
    };

    // Save to sessionStorage
    this.saveSession();

    // Set up expiration and warning timers
    this.setupTimers();

    // Log the impersonation start
    await this.logImpersonationEvent('start', {
      actualUser: actualUser.email,
      targetUser: targetUser.email,
      reason
    });

    log.info('Impersonation started', {
      actualUser: actualUser.email,
      impersonatedUser: targetUser.email,
      expiresAt
    });

    return this.currentSession;
  }

  /**
   * End impersonation session
   */
  async endImpersonation(): Promise<void> {
    if (!this.currentSession) {
      return;
    }

    const session = this.currentSession;

    // Log the impersonation end
    await this.logImpersonationEvent('end', {
      actualUser: session.actualUserEmail,
      targetUser: session.impersonatedUserEmail,
      duration: Math.floor((Date.now() - session.startTime.getTime()) / 1000 / 60) // minutes
    });

    log.info('Impersonation ended', {
      actualUser: session.actualUserEmail,
      impersonatedUser: session.impersonatedUserEmail
    });

    // Clear session
    this.currentSession = null;
    this.clearTimers();
    this.clearSession();

    // Reload the page to ensure clean state
    window.location.reload();
  }

  /**
   * Get current impersonation session
   */
  getCurrentSession(): ImpersonationSession | null {
    if (!this.currentSession) {
      return null;
    }

    const now = Date.now();
    const expiresAt = new Date(this.currentSession.expiresAt).getTime();
    const timeRemaining = Math.max(0, Math.floor((expiresAt - now) / 1000 / 60));
    const isExpired = timeRemaining === 0;
    const isWarning = timeRemaining <= this.config.warningMinutesRemaining;

    if (isExpired) {
      // Auto-end expired session
      this.endImpersonation();
      return null;
    }

    return {
      context: this.currentSession,
      timeRemaining,
      isExpired,
      isWarning
    };
  }

  /**
   * Check if currently impersonating
   */
  isImpersonating(): boolean {
    return this.currentSession !== null;
  }

  /**
   * Check if an action is blocked during impersonation
   */
  isActionBlocked(permissionId: string): boolean {
    if (!this.isImpersonating()) {
      return false;
    }
    return this.config.blockedActions.includes(permissionId);
  }

  /**
   * Get impersonated user for auth context
   */
  getImpersonatedUser(): { id: string; email: string; role: string } | null {
    if (!this.currentSession) {
      return null;
    }

    return {
      id: this.currentSession.impersonatedUserId,
      email: this.currentSession.impersonatedUserEmail,
      role: this.currentSession.impersonatedUserRole
    };
  }

  /**
   * Register expiration callback
   */
  onExpiration(callback: () => void): void {
    this.onExpirationCallbacks.push(callback);
  }

  /**
   * Register warning callback
   */
  onWarning(callback: () => void): void {
    this.onWarningCallbacks.push(callback);
  }

  /**
   * Setup expiration and warning timers
   */
  private setupTimers(): void {
    if (!this.currentSession) return;

    const now = Date.now();
    const expiresAt = new Date(this.currentSession.expiresAt).getTime();
    const warningAt = expiresAt - (this.config.warningMinutesRemaining * 60 * 1000);

    // Clear existing timers
    this.clearTimers();

    // Set warning timer
    if (warningAt > now) {
      this.warningTimer = setTimeout(() => {
        this.onWarningCallbacks.forEach(cb => cb());
        log.warn('Impersonation session expiring soon', {
          minutesRemaining: this.config.warningMinutesRemaining
        });
      }, warningAt - now);
    }

    // Set expiration timer
    this.expirationTimer = setTimeout(() => {
      this.onExpirationCallbacks.forEach(cb => cb());
      this.endImpersonation();
    }, expiresAt - now);
  }

  /**
   * Clear timers
   */
  private clearTimers(): void {
    if (this.expirationTimer) {
      clearTimeout(this.expirationTimer);
      this.expirationTimer = null;
    }
    if (this.warningTimer) {
      clearTimeout(this.warningTimer);
      this.warningTimer = null;
    }
  }

  /**
   * Save session to sessionStorage
   */
  private saveSession(): void {
    if (!this.currentSession) return;

    sessionStorage.setItem(
      'impersonation_session',
      JSON.stringify({
        ...this.currentSession,
        startTime: this.currentSession.startTime.toISOString(),
        expiresAt: this.currentSession.expiresAt.toISOString()
      })
    );
  }

  /**
   * Load session from sessionStorage
   */
  private loadSession(): void {
    const stored = sessionStorage.getItem('impersonation_session');
    if (!stored) return;

    try {
      const session = JSON.parse(stored);
      session.startTime = new Date(session.startTime);
      session.expiresAt = new Date(session.expiresAt);

      // Check if expired
      if (session.expiresAt > new Date()) {
        this.currentSession = session;
        this.setupTimers();
      } else {
        // Clear expired session
        this.clearSession();
      }
    } catch (error) {
      log.error('Failed to load impersonation session', error);
      this.clearSession();
    }
  }

  /**
   * Clear session from sessionStorage
   */
  private clearSession(): void {
    sessionStorage.removeItem('impersonation_session');
  }

  /**
   * Log impersonation event for audit trail
   */
  private async logImpersonationEvent(
    action: 'start' | 'end',
    details: Record<string, any>
  ): Promise<void> {
    // In production, this would send to an audit log service
    // For now, we'll log to console and could store in Supabase audit table

    const event = {
      type: 'impersonation',
      action,
      timestamp: new Date().toISOString(),
      ...details
    };

    log.info('Audit: Impersonation event', event);

    // TODO: Send to Supabase audit log table
    // await supabaseService.logAuditEvent(event);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ImpersonationConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// Export singleton instance
export const impersonationService = ImpersonationService.getInstance();

/**
 * React hook for using impersonation service
 */
export function useImpersonation() {
  const [session, setSession] = React.useState<ImpersonationSession | null>(
    impersonationService.getCurrentSession()
  );

  React.useEffect(() => {
    // Update session every second while impersonating
    const interval = setInterval(() => {
      const currentSession = impersonationService.getCurrentSession();
      setSession(currentSession);
    }, 1000);

    // Register callbacks
    const handleWarning = () => {
      // Could show a notification here
      console.warn('Impersonation session expiring soon!');
    };

    const handleExpiration = () => {
      // Could show a notification here
      console.warn('Impersonation session expired!');
      setSession(null);
    };

    impersonationService.onWarning(handleWarning);
    impersonationService.onExpiration(handleExpiration);

    return () => {
      clearInterval(interval);
    };
  }, []);

  return {
    session,
    isImpersonating: impersonationService.isImpersonating(),
    startImpersonation: impersonationService.startImpersonation.bind(impersonationService),
    endImpersonation: impersonationService.endImpersonation.bind(impersonationService),
    isActionBlocked: impersonationService.isActionBlocked.bind(impersonationService)
  };
}

// Add missing React import for the hook
import * as React from 'react';