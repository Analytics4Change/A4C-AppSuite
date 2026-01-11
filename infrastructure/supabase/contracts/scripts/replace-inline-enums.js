/**
 * Script to replace inline enum definitions with $ref to centralized enums.yaml
 * This eliminates AnonymousSchema generation by Modelina
 */

const fs = require('fs');
const path = require('path');
const yaml = require('yaml');

// Mapping from enum values (sorted) to enum names in enums.yaml
const ENUM_MAPPINGS = {
  // Sort values alphabetically and join to create key
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
  // RevocationReason removed - now free text field
  // ExpirationType removed - now free text field
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
};

function getEnumKey(values) {
  return values.slice().sort().join(',');
}

function findEnumName(values) {
  const key = getEnumKey(values);
  return ENUM_MAPPINGS[key] || null;
}

// Process a single YAML file
function processFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const doc = yaml.parseDocument(content);

  let replacements = 0;

  function processNode(node, parentKey = '', depth = 0) {
    if (!node || typeof node !== 'object') return;

    if (yaml.isMap(node)) {
      const items = node.items;

      for (let i = 0; i < items.length; i++) {
        const pair = items[i];
        const key = pair.key?.value;
        const value = pair.value;

        // Check if this property has an enum definition
        if (yaml.isMap(value)) {
          const typeItem = value.items?.find(p => p.key?.value === 'type');
          const enumItem = value.items?.find(p => p.key?.value === 'enum');

          if (enumItem && yaml.isSeq(enumItem.value)) {
            const enumValues = enumItem.value.items.map(item =>
              yaml.isScalar(item) ? item.value : String(item)
            );

            // Skip single-value enums (const patterns)
            if (enumValues.length === 1) {
              continue;
            }

            const enumName = findEnumName(enumValues);
            if (enumName) {
              console.log(`  Found ${key}: ${enumValues.join(', ')} → ${enumName}`);

              // Check if there's a description to preserve
              const descItem = value.items?.find(p => p.key?.value === 'description');

              // Replace with $ref
              value.items = value.items.filter(p =>
                p.key?.value !== 'type' &&
                p.key?.value !== 'enum' &&
                p.key?.value !== 'description'
              );

              if (descItem) {
                // Use allOf to combine $ref with description
                value.items.push(
                  doc.createPair('allOf', doc.createNode([
                    { '$ref': `../components/enums.yaml#/components/schemas/${enumName}` },
                    { description: descItem.value.value }
                  ]))
                );
              } else {
                // Simple $ref
                value.items.push(
                  doc.createPair('$ref', `../components/enums.yaml#/components/schemas/${enumName}`)
                );
              }

              replacements++;
            }
          }
        }

        // Recurse into nested structures
        processNode(value, key, depth + 1);
      }
    } else if (yaml.isSeq(node)) {
      for (const item of node.items) {
        processNode(item, parentKey, depth + 1);
      }
    }
  }

  processNode(doc.contents);

  if (replacements > 0) {
    fs.writeFileSync(filePath, doc.toString());
    console.log(`  Made ${replacements} replacements`);
  }

  return replacements;
}

// Main
const domainsDir = path.join(__dirname, '..', 'asyncapi', 'domains');
const schemasFile = path.join(__dirname, '..', 'asyncapi', 'components', 'schemas.yaml');

console.log('Processing domain files...\n');

let totalReplacements = 0;

const files = fs.readdirSync(domainsDir).filter(f => f.endsWith('.yaml'));
for (const file of files) {
  const filePath = path.join(domainsDir, file);
  console.log(`Processing ${file}:`);
  totalReplacements += processFile(filePath);
  console.log('');
}

if (fs.existsSync(schemasFile)) {
  console.log('Processing components/schemas.yaml:');
  totalReplacements += processFile(schemasFile);
}

console.log(`\nTotal replacements: ${totalReplacements}`);
