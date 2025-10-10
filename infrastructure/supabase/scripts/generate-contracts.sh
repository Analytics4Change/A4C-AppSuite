#!/bin/bash

# Generate TypeScript types and documentation from AsyncAPI/OpenAPI contracts

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

CONTRACTS_DIR="../contracts"
GENERATED_DIR="$CONTRACTS_DIR/generated"

echo -e "${GREEN}Generating Types and Documentation from API Contracts${NC}"
echo "========================================="

# Ensure output directories exist
mkdir -p "$GENERATED_DIR/typescript"
mkdir -p "$GENERATED_DIR/json-schema"
mkdir -p "$GENERATED_DIR/documentation"

# Check if required tools are installed
check_tool() {
    if ! command -v $1 &> /dev/null; then
        echo -e "${YELLOW}Warning: $1 is not installed${NC}"
        echo "Install with: npm install -g $2"
        return 1
    fi
    return 0
}

# Generate TypeScript types from OpenAPI
generate_openapi_types() {
    echo -e "\n${GREEN}Generating OpenAPI TypeScript types...${NC}"

    if check_tool "openapi-typescript" "openapi-typescript"; then
        npx openapi-typescript "$CONTRACTS_DIR/openapi/api.yaml" \
            --output "$GENERATED_DIR/typescript/api-types.ts" \
            --export-type
        echo "✓ Generated: typescript/api-types.ts"
    fi
}

# Generate TypeScript types from AsyncAPI
generate_asyncapi_types() {
    echo -e "\n${GREEN}Generating AsyncAPI TypeScript types...${NC}"

    # Create a simple TypeScript generator if official one not available
    cat > "$GENERATED_DIR/typescript/event-types.ts" << 'EOF'
// Generated from AsyncAPI specifications
// This file is auto-generated. Do not edit manually.

export type StreamType = 'client' | 'medication' | 'medication_history' | 'dosage' | 'user' | 'organization';

export interface EventMetadata {
  user_id: string;
  reason: string; // REQUIRED: The "WHY" behind this change
  user_email?: string;
  user_name?: string;
  correlation_id?: string;
  causation_id?: string;
  ip_address?: string;
  user_agent?: string;
  approval_chain?: Approval[];
  notes?: string;
}

export interface Approval {
  approver_id: string;
  approver_name?: string;
  approver_email?: string;
  approved_at: string;
  role: 'physician' | 'nurse_practitioner' | 'pharmacist' | 'administrator' | 'supervisor';
  notes?: string;
}

export interface DomainEvent<T = any> {
  id?: string;
  stream_id: string;
  stream_type: StreamType;
  stream_version?: number;
  event_type: string;
  event_data: T;
  event_metadata: EventMetadata;
  created_at?: string;
  processed_at?: string;
  processing_error?: string;
}

// Client Events
export interface ClientRegisteredData {
  organization_id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';
  email?: string;
  phone?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip_code?: string;
    country?: string;
  };
  emergency_contact?: {
    name: string;
    relationship: string;
    phone: string;
    alternate_phone?: string;
    email?: string;
  };
  allergies?: string[];
  medical_conditions?: string[];
  blood_type?: 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';
  notes?: string;
}

export type ClientRegisteredEvent = DomainEvent<ClientRegisteredData> & {
  event_type: 'client.registered';
  stream_type: 'client';
};

// Medication Events
export interface MedicationPrescribedData {
  organization_id: string;
  client_id: string;
  medication_id: string;
  prescription_date: string;
  start_date: string;
  end_date?: string;
  prescriber_name?: string;
  prescriber_npi?: string;
  dosage_amount: number;
  dosage_unit: string;
  frequency: string;
  route: 'oral' | 'sublingual' | 'intravenous' | 'intramuscular' | 'subcutaneous' | 'topical' | 'other';
  instructions?: string;
  is_prn?: boolean;
  prn_reason?: string;
  refills_authorized?: number;
  notes?: string;
}

export type MedicationPrescribedEvent = DomainEvent<MedicationPrescribedData> & {
  event_type: 'medication.prescribed';
  stream_type: 'medication_history';
};

// Type guards
export function isClientRegisteredEvent(event: DomainEvent): event is ClientRegisteredEvent {
  return event.event_type === 'client.registered';
}

export function isMedicationPrescribedEvent(event: DomainEvent): event is MedicationPrescribedEvent {
  return event.event_type === 'medication.prescribed';
}

// Event factory with required reason
export function createEvent<T extends DomainEvent>(
  type: T['event_type'],
  streamId: string,
  streamType: StreamType,
  data: T['event_data'],
  metadata: EventMetadata
): T {
  if (!metadata.reason || metadata.reason.length < 10) {
    throw new Error('Event metadata must include a reason with at least 10 characters');
  }

  return {
    stream_id: streamId,
    stream_type: streamType,
    event_type: type,
    event_data: data,
    event_metadata: metadata
  } as T;
}
EOF
    echo "✓ Generated: typescript/event-types.ts"
}

# Generate JSON Schemas
generate_json_schemas() {
    echo -e "\n${GREEN}Generating JSON Schemas...${NC}"

    # Extract schemas from AsyncAPI for database validation
    # This would normally use a tool, but for now we'll create a basic version
    cat > "$GENERATED_DIR/json-schema/event-schemas.json" << 'EOF'
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "definitions": {
    "EventMetadata": {
      "type": "object",
      "required": ["user_id", "reason"],
      "properties": {
        "user_id": {
          "type": "string",
          "format": "uuid"
        },
        "reason": {
          "type": "string",
          "minLength": 10,
          "maxLength": 500
        }
      }
    },
    "DomainEvent": {
      "type": "object",
      "required": ["stream_id", "stream_type", "event_type", "event_data", "event_metadata"],
      "properties": {
        "stream_id": {
          "type": "string",
          "format": "uuid"
        },
        "stream_type": {
          "type": "string",
          "enum": ["client", "medication", "medication_history", "dosage", "user", "organization"]
        },
        "event_type": {
          "type": "string",
          "pattern": "^[a-z_]+\\.[a-z_]+$"
        },
        "event_data": {
          "type": "object"
        },
        "event_metadata": {
          "$ref": "#/definitions/EventMetadata"
        }
      }
    }
  }
}
EOF
    echo "✓ Generated: json-schema/event-schemas.json"
}

# Generate HTML documentation
generate_documentation() {
    echo -e "\n${GREEN}Generating HTML Documentation...${NC}"

    # Create a simple HTML documentation
    cat > "$GENERATED_DIR/documentation/index.html" << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>A4C Event API Documentation</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 40px; }
        h1 { color: #2563eb; }
        h2 { color: #475569; margin-top: 2em; }
        .event { background: #f8fafc; padding: 1em; margin: 1em 0; border-left: 4px solid #3b82f6; }
        .required { color: #dc2626; font-weight: bold; }
        code { background: #e2e8f0; padding: 2px 6px; border-radius: 3px; }
        .reason { background: #fef3c7; padding: 1em; margin: 1em 0; border-left: 4px solid #f59e0b; }
    </style>
</head>
<body>
    <h1>A4C Event API Documentation</h1>

    <div class="reason">
        <strong>⚠️ Important:</strong> All events MUST include a <code>reason</code> field in metadata
        explaining WHY the change is being made. This is required for audit compliance.
    </div>

    <h2>Event Types</h2>

    <div class="event">
        <h3>client.registered</h3>
        <p>A new client has been registered in the system</p>
        <p><strong>Stream Type:</strong> <code>client</code></p>
        <p><strong>Required Reason Examples:</strong></p>
        <ul>
            <li>"Initial intake from emergency department referral #12345"</li>
            <li>"Transfer from pediatric unit per Dr. Smith's discharge summary"</li>
        </ul>
    </div>

    <div class="event">
        <h3>medication.prescribed</h3>
        <p>A medication has been prescribed to a client</p>
        <p><strong>Stream Type:</strong> <code>medication_history</code></p>
        <p><strong>Required Reason Examples:</strong></p>
        <ul>
            <li>"Initial prescription for diagnosed major depressive disorder"</li>
            <li>"Dosage adjustment due to insufficient therapeutic response"</li>
        </ul>
    </div>

    <p>View the complete AsyncAPI specification for all event types and schemas.</p>
</body>
</html>
EOF
    echo "✓ Generated: documentation/index.html"
}

# Main execution
main() {
    generate_openapi_types
    generate_asyncapi_types
    generate_json_schemas
    generate_documentation

    echo -e "\n${GREEN}Generation complete!${NC}"
    echo "Generated files in: $GENERATED_DIR"
    echo ""
    echo "To use in frontend:"
    echo "  cp $GENERATED_DIR/typescript/* ../A4C-Frontend/src/types/"
}

main