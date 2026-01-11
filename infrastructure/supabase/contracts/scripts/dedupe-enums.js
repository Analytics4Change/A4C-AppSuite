/**
 * Post-processes generated TypeScript to deduplicate inlined enums.
 *
 * Problem: AsyncAPI bundler inlines all $refs, so each use of a shared enum
 * creates a separate AnonymousSchema copy in the generated TypeScript.
 *
 * Solution: This script identifies duplicate enums by their values,
 * keeps one canonical version with a proper name, and updates all references.
 */

const fs = require('fs');
const path = require('path');

// Map of enum values (sorted, joined) to canonical name
const ENUM_NAMES = {
  'female,male,other,prefer_not_to_say': 'Gender',
  'child,friend,guardian,other,parent,sibling,spouse': 'EmergencyContactRelationship',
  'A+,A-,AB+,AB-,B+,B-,O+,O-': 'BloodType',
  'administrator,nurse_practitioner,pharmacist,physician,supervisor': 'ApproverRole',
  'emergency,readmission,scheduled,transfer': 'AdmissionType',
  'administrative,against_medical_advice,death,planned,transfer': 'DischargeType',
  'acute_care_hospital,deceased,home,home_with_services,hospice,left_against_advice,other,psychiatric_hospital,rehabilitation_facility,skilled_nursing_facility': 'DischargeDisposition',
  'Schedule I,Schedule II,Schedule III,Schedule IV,Schedule V': 'ControlledSubstanceSchedule',
  'capsule,cream,inhaler,injection,liquid,ointment,patch,suppository,tablet': 'MedicationForm',
  'buccal,inhalation,intramuscular,intravenous,nasal,ophthalmic,oral,otic,rectal,subcutaneous,sublingual,topical,transdermal': 'AdministrationRoute',
  'client_absent,client_npo,clinical_hold,medication_unavailable,other,physician_order,vital_signs_out_of_range': 'SkipReason',
  'adverse_reaction,client_request,contraindication,cost,drug_interaction,ineffective,other,treatment_complete': 'DiscontinueReasonCategory',
  'global,org': 'ScopeType',
  'client_specific,organization_unit': 'GrantScope',
  'court_order,emergency_access,family_participation,social_services_assignment,var_contract': 'GrantAuthorizationType',
  'administrative_hold,contract_dispute,investigation,security_concern': 'SuspensionReason',
  'billing_suspension,compliance_violation,maintenance,voluntary_suspension': 'DeactivationReason',
  'administrative,billing,emergency,stakeholder,technical': 'ContactType',
  'billing,mailing,physical': 'AddressType',
  'emergency,fax,mobile,office': 'PhoneType',
  'hard_delete,soft_delete': 'RemovalType',
  'audit,emergency,support_ticket,training': 'JustificationReason',
  'forced_by_admin,manual_logout,renewal_declined,timeout': 'ImpersonationEndReason',
  'provider,provider_partner': 'ImpersonationTargetOrgType',
  'platform_owner,provider,provider_partner': 'OrganizationType',
  'court,family,other,var': 'PartnerType',
  'admin_user_creation,dns_provisioning,invitation_email,organization_creation,permission_grants,role_assignment': 'BootstrapFailureStage',
  'email_password,oauth_enterprise_sso,oauth_github,oauth_google': 'AuthMethod',
  'manual_invitation,organization_bootstrap': 'InvitationMethod',
  'partner_admin,provider_admin': 'AdminRole',
  'block_if_children,cascade_delete': 'DeletionStrategy',
  'A,CNAME': 'DNSRecordType',
  'development,dns_quorum': 'VerificationMethod',
  'development,mock,production': 'VerificationMode',
  'manual_revocation,organization_deactivated,workflow_failure': 'InvitationRevocationReason',
  'business_rule_violation,duplicate,invalid_format,out_of_range,required,unauthorized': 'ValidationErrorCode',
  'created_at,event_type': 'SortBy',
  'asc,desc': 'SortOrder',
  'display_name,is_active,name,timezone': 'OrgUpdatableFields',
  'display_name,name,timezone': 'OUUpdatableFields',
  'billing,main,personal,support,work': 'EmailType',
};

function parseEnumValues(enumBlock) {
  const matches = enumBlock.matchAll(/= "([^"]+)"/g);
  return Array.from(matches, m => m[1]).sort().join(',');
}

function dedupeEnums(content) {
  // Find all enum declarations and their positions
  // Match both 'export enum' and 'enum' patterns
  const enumRegex = /(export )?enum (AnonymousSchema_\d+|[A-Z][A-Za-z0-9_]*) \{[^}]+\}/g;
  const canonicalEnums = new Map(); // values -> canonical block
  const seenNames = new Set(); // track seen enum names to remove duplicates
  const renames = new Map(); // old name -> new name
  const toRemove = []; // enum blocks to remove (including 'export ' prefix)

  let match;
  while ((match = enumRegex.exec(content)) !== null) {
    const fullBlock = match[0]; // Includes 'export ' if present
    const enumName = match[2];
    const values = parseEnumValues(fullBlock);
    const canonicalName = ENUM_NAMES[values];

    if (canonicalName) {
      if (!canonicalEnums.has(values)) {
        // First occurrence - keep it with canonical name and export keyword
        const renamedBlock = `export enum ${canonicalName} {` + fullBlock.slice(fullBlock.indexOf('{') + 1);
        canonicalEnums.set(values, renamedBlock);
        seenNames.add(canonicalName);
      } else {
        // Duplicate by values - always remove
        toRemove.push(fullBlock);
      }
      // Mark for renaming (including first occurrence if it was anonymous)
      renames.set(enumName, canonicalName);
      if (enumName !== canonicalName) {
        toRemove.push(fullBlock); // Remove the full block including 'export '
      }
    } else {
      // Not in our canonical mapping - check for duplicate names
      if (seenNames.has(enumName)) {
        // Duplicate by name - remove
        toRemove.push(fullBlock);
      } else {
        seenNames.add(enumName);
      }
    }
  }

  let result = content;

  // Remove all duplicate/anonymous enum declarations that have canonical names
  for (const block of toRemove) {
    result = result.replace(block + '\n\n', '');
    result = result.replace(block + '\n', '');
    result = result.replace(block, '');
  }

  // Add canonical enums at the top of the enums section
  const enumsHeader = '// =============================================================================\n// Enums\n// =============================================================================\n\n';
  const canonicalBlocks = Array.from(canonicalEnums.values()).join('\n\n');

  if (canonicalBlocks && result.includes(enumsHeader)) {
    result = result.replace(enumsHeader, enumsHeader + canonicalBlocks + '\n\n');
  }

  // Update all references to use canonical names
  for (const [oldName, newName] of renames) {
    if (oldName !== newName) {
      // Only replace in interface property types, not in enum declarations
      const refRegex = new RegExp(`(?<!enum )\\b${oldName}\\b`, 'g');
      result = result.replace(refRegex, newName);
    }
  }

  return result;
}

/**
 * More robust duplicate enum removal using line-by-line parsing.
 * This handles cases where enums have the same name but different positions.
 */
function removeDuplicateEnumsByName(content) {
  const seenEnums = new Set();
  const lines = content.split('\n');
  const result = [];
  let skipEnum = false;
  let braceCount = 0;

  for (const line of lines) {
    const enumMatch = line.match(/^export enum ([A-Za-z_][A-Za-z0-9_]*) \{/);
    if (enumMatch) {
      const enumName = enumMatch[1];
      if (seenEnums.has(enumName)) {
        skipEnum = true;
        braceCount = 1;
        continue;
      }
      seenEnums.add(enumName);
    }

    if (skipEnum) {
      if (line.includes('{')) braceCount++;
      if (line.includes('}')) braceCount--;
      if (braceCount === 0) {
        skipEnum = false;
      }
      continue;
    }

    result.push(line);
  }

  // Remove any triple+ blank lines that might result from removal
  return result.join('\n').replace(/\n\n\n+/g, '\n\n');
}

// Main
const inputPath = path.join(__dirname, '..', 'types', 'generated-events.ts');
const content = fs.readFileSync(inputPath, 'utf8');

// First pass: rename anonymous schemas to canonical names
const renamedContent = dedupeEnums(content);

// Second pass: remove any remaining duplicates by name
const dedupedContent = removeDuplicateEnumsByName(renamedContent);

fs.writeFileSync(inputPath, dedupedContent);

// Count results
const anonEnums = (dedupedContent.match(/enum AnonymousSchema/g) || []).length;
const namedEnums = (dedupedContent.match(/^export enum [A-Z][A-Za-z]+[^_]/gm) || []).length;
console.log(`✓ Deduplication complete`);
console.log(`  Named enums: ${namedEnums}`);
console.log(`  Anonymous enums (single-value const patterns): ${anonEnums}`);
