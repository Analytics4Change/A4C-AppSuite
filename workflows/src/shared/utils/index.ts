/**
 * Shared Utilities
 *
 * Exports common utilities for workflows and activities
 */

export { getSupabaseClient, resetSupabaseClient } from './supabase';
export {
  emitEvent,
  getEnvironmentTags,
  buildTags,
  generateSpanId,
  buildTracingForEvent,
  createActivityTracingContext,
} from './emit-event';
export {
  getLogger,
  workflowLog,
  activityLog,
  apiLog,
  workerLog,
  type LogLevel,
} from './logger';
