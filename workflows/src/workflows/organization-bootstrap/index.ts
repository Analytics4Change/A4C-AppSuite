/**
 * Organization Bootstrap Workflow
 *
 * Exports the main workflow for organization provisioning.
 */

export { organizationBootstrapWorkflow } from './workflow';

// Backwards compatibility alias for in-flight workflows started with old name
// Can be removed once all old workflow executions complete (after Dec 2025)
export { organizationBootstrapWorkflow as organizationBootstrap } from './workflow';
