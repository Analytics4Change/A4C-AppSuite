-- =============================================================================
-- Make the emergency_access authorization_type reachable end-to-end + bound it.
-- =============================================================================
--
-- Card: dev/active/seed-grant-role-templates-emergency-default.md
-- Follow-up to cross-tenant-access-grant Phase 2 (shipped). Architect
-- (software-architect-dbc) reviewed + confirmed Option B and the expiry guard;
-- decision record at ~/.claude/plans/misty-popping-bengio-agent-a9ecd00d9dc2ce504.md.
--
-- PROBLEM 1 (reachability): emergency_access is a first-class authorization_type
-- (in both the grant_role_templates CHECK and the cross_tenant_access_grants_
-- projection CHECK, and the projection deliberately permits NULL
-- authorization_reference ONLY for it), but it is unreachable: every call to
-- api.create_access_grant with p_authorization_type='emergency_access' fails
-- TEMPLATE_NOT_FOUND because no emergency template is seeded (only
-- var_default/var_contract exists). Phase 2 UAT probe L6 is blocked on this.
--
-- PROBLEM 2 (HIPAA time-limitation hole): once reachable, p_expires_at is
-- optional — a NULL value yields a *permanent* cross-tenant PHI grant. We close
-- both in one migration: reachability and its safety bound are one unit.
--
-- Approach: Option B (seed an emergency_default template) + a body-only pre-emit
-- guard on api.create_access_grant. Option A (make the template optional +
-- require p_permission_overrides) is incoherent with the deployed RPC:
-- permission_overrides is INTERSECT-narrowing ONLY (a filter against the
-- template set, never a source), so with no template the intersection is always
-- empty -> EMPTY_PERMISSION_SET.
--
-- WHY this permission set ({client.view, medication.view}, read-only clinical
-- PHI): emergency = read-only clinical visibility for a time-critical need.
-- Both perms are LEAF nodes in the implication graph (writes imply view; view
-- implies nothing) -> structurally incapable of escalating into any
-- write/administer/discharge perm, even if permission_implications.
-- propagate_through_grants were ever flipped to true. Strongest least-authority
-- property. Write/administer perms belong to a separate future template
-- (e.g. emergency_clinical_write) gated by its own decision, NOT the default.
--
-- Template perms reach the JWT via compute_effective_permissions.grant_derived_
-- perms, which INNER JOINs permissions_projection ON name = perm_entry->>'p'.
-- A perm name absent from permissions_projection would land in the grant row
-- but be SILENTLY dropped from the JWT. Section A asserts existence at migrate
-- time (the migration-time analog of codified pitfall #8 for the template->JWT
-- JOIN).
--
-- No new permission, no new event type, no RPC signature change (CREATE OR
-- REPLACE preserves OID + the M3 @a4c-rpc-shape COMMENT) -> no TS regen, no
-- AsyncAPI change.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Section A — fail-loud precondition: the two referenced permissions must exist
-- in permissions_projection, else the seed would land perms that the JWT layer
-- silently drops (inner JOIN in compute_effective_permissions.grant_derived_perms).
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.permissions_projection WHERE name = 'client.view')
   OR NOT EXISTS (SELECT 1 FROM public.permissions_projection WHERE name = 'medication.view') THEN
    RAISE EXCEPTION 'emergency_default seed references a permission absent from permissions_projection '
      '(would land in grant rows but be silently dropped from JWT by compute_effective_permissions JOIN)';
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- Section B — seed the emergency_default template (2 rows). Mirrors the
-- var_default seed pattern at 20260601174841 L4379-4386. Idempotent via the
-- 3-column UNIQUE (template_name, authorization_type, permission_name).
-- default_terms = {"phi_restricted": true} mirrors var_default; the decorative
-- (unenforced) time_limited_max_hours is intentionally OMITTED — the real time
-- bound is the grant's expires_at column (capped at 72h in Section C).
-- -----------------------------------------------------------------------------
INSERT INTO public.grant_role_templates
  (template_name, authorization_type, permission_name, default_terms)
VALUES
  ('emergency_default', 'emergency_access', 'client.view',     '{"phi_restricted": true}'::jsonb),
  ('emergency_default', 'emergency_access', 'medication.view', '{"phi_restricted": true}'::jsonb)
ON CONFLICT (template_name, authorization_type, permission_name) DO NOTHING;


-- -----------------------------------------------------------------------------
-- Section C — bound emergency-access grant expiry in api.create_access_grant.
-- Body-only change (signature UNCHANGED). The full body below is the deployed
-- definition fetched verbatim via Mgmt API pg_get_functiondef (codified pitfall
-- #6); the ONLY change is two new pre-emit guards added to the existing
-- emergency_access branch (search "NEW (this migration)"). CREATE OR REPLACE
-- with the same signature preserves the OID and the M3 @a4c-rpc-shape COMMENT.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.create_access_grant(p_consultant_org_id uuid, p_provider_org_id uuid, p_scope text, p_scope_id uuid, p_authorization_type text, p_grant_role_template_name text, p_consultant_user_id uuid DEFAULT NULL::uuid, p_authorization_reference uuid DEFAULT NULL::uuid, p_legal_reference text DEFAULT NULL::text, p_permission_overrides text[] DEFAULT NULL::text[], p_terms jsonb DEFAULT '{}'::jsonb, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_reason text DEFAULT 'Grant created via cross-tenant grant flow'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_claims              jsonb       := current_setting('request.jwt.claims', true)::jsonb;
    v_caller_id           uuid        := public.get_current_user_id();
    v_org_id              uuid        := NULLIF(v_claims ->> 'org_id', '')::uuid;
    v_access_blocked      boolean     := COALESCE((v_claims ->> 'access_blocked')::boolean, false);
    v_provider_path       extensions.ltree;
    v_scope_path          extensions.ltree;
    v_client_ou_id        uuid;
    v_client_status       text;  -- S1 architect fold-in 2026-06-08 (Chunk 4 review)
    v_authorization_valid boolean;
    v_template_count      int;
    v_permissions_jsonb   jsonb;
    v_template_terms      jsonb       := '{}'::jsonb;
    v_final_terms         jsonb;
    v_grant_id            uuid;
    v_event_id            uuid;
    v_processing_error    text;
    v_now                 timestamptz := now();
    v_terms_row           record;
BEGIN
    -- =====================================================================
    -- PRE-EMIT GUARDS (RAISE EXCEPTION; no audit row yet)
    -- =====================================================================

    -- Caller auth + tenant context
    IF v_caller_id IS NULL OR v_org_id IS NULL THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;

    -- access_blocked JWT-claim guard
    IF v_access_blocked THEN
        RAISE EXCEPTION 'Access blocked: organization is deactivated'
            USING ERRCODE = '42501';
    END IF;

    -- Required-param presence
    IF p_consultant_org_id IS NULL OR p_provider_org_id IS NULL THEN
        RAISE EXCEPTION 'consultant_org_id and provider_org_id are required'
            USING ERRCODE = '22004';
    END IF;
    IF p_scope_id IS NULL THEN
        RAISE EXCEPTION 'scope_id is required' USING ERRCODE = '22004';
    END IF;
    IF p_grant_role_template_name IS NULL OR p_grant_role_template_name = '' THEN
        RAISE EXCEPTION 'grant_role_template_name is required'
            USING ERRCODE = '22004';
    END IF;

    -- S2 architect fold-in 2026-06-08 (Chunk 4 review): same-org guard.
    -- consultant_org_id = provider_org_id is semantic nonsense (org granting
    -- itself access to its own data) and would feed a redundant row to
    -- sync_accessible_organizations_from_grants. Reject pre-emit.
    IF p_consultant_org_id = p_provider_org_id THEN
        RAISE EXCEPTION 'consultant_org_id must differ from provider_org_id'
            USING ERRCODE = '22023';
    END IF;

    -- S3 architect fold-in 2026-06-08 (Chunk 4 review): expires_at must be
    -- in the future. Phase 1's grant_derived_perms CTE filters
    -- (expires_at IS NULL OR expires_at > now()), so a back-dated value
    -- would land an active projection row that JWT issuance immediately
    -- filters out — projection-state drift. Reject pre-emit.
    IF p_expires_at IS NOT NULL AND p_expires_at <= v_now THEN
        RAISE EXCEPTION 'expires_at must be in the future'
            USING ERRCODE = '22023';
    END IF;

    -- p_scope CHECK (matches cross_tenant_access_grants_projection_scope_check)
    IF p_scope NOT IN ('organization_unit', 'client_specific') THEN
        RAISE EXCEPTION 'Invalid scope: must be organization_unit or client_specific'
            USING ERRCODE = '22023';
    END IF;

    -- p_authorization_type CHECK (5-value enum mirrors
    -- cross_tenant_access_grants_projection_authorization_type_check
    -- at Phase 1 baseline_v4:3037-3071)
    IF p_authorization_type NOT IN (
        'var_contract', 'court_order', 'family_participation',
        'social_services_assignment', 'emergency_access'
    ) THEN
        RAISE EXCEPTION 'Invalid authorization_type: must be one of var_contract, court_order, family_participation, social_services_assignment, emergency_access'
            USING ERRCODE = '22023';
    END IF;

    -- authorization_reference NULL invariant
    -- (Phase 1 Step 14 CHECK: NULL only for emergency_access)
    IF p_authorization_type = 'emergency_access' THEN
        IF p_authorization_reference IS NOT NULL THEN
            RAISE EXCEPTION 'authorization_reference must be NULL for emergency_access'
                USING ERRCODE = '22023';
        END IF;
        -- NEW (this migration): emergency grants MUST be time-bounded. An
        -- unbounded emergency cross-tenant PHI grant is a HIPAA
        -- time-limitation hole (grant_derived_perms admits a row while
        -- expires_at IS NULL OR > now()).
        IF p_expires_at IS NULL THEN
            RAISE EXCEPTION 'expires_at is required for emergency_access'
                USING ERRCODE = '22004';
        END IF;
        -- NEW (this migration): cap the emergency window at 72h. This ceiling
        -- is POLICY-IN-CODE — it is NOT driven by default_terms (terms are
        -- unenforced snapshot metadata). Compliance-ratified at 72h
        -- (2026-06-15); a one-line change if the policy value moves.
        IF p_expires_at > (v_now + interval '72 hours') THEN
            RAISE EXCEPTION 'expires_at for emergency_access may not exceed 72 hours from now'
                USING ERRCODE = '22023';
        END IF;
    ELSE
        IF p_authorization_reference IS NULL THEN
            RAISE EXCEPTION 'authorization_reference is required for non-emergency_access authorization_type'
                USING ERRCODE = '22023';
        END IF;
    END IF;

    -- Provider org path lookup (F2 architect fold-in)
    SELECT path
    INTO v_provider_path
    FROM public.organizations_projection
    WHERE id = p_provider_org_id
      AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Provider organization not found or deleted'
            USING ERRCODE = '42501';
    END IF;

    -- HIPAA permission gate (ADR L204 + F2 fold-in)
    -- Path-scoped check: provider-admin authority at the provider org path is
    -- load-bearing. has_platform_privilege() short-circuit for platform owners.
    IF NOT (
        public.has_platform_privilege()
        OR public.has_effective_permission('grant.create', v_provider_path)
    ) THEN
        RAISE EXCEPTION 'Permission denied: grant.create at provider organization scope'
            USING ERRCODE = '42501';
    END IF;

    -- =====================================================================
    -- PER-TYPE AUTHORIZATION VALIDATION (envelope-return, not RAISE)
    -- =====================================================================
    -- ADR L205: dispatch via CASE on p_authorization_type to the appropriate
    -- _validate_authorization_<type> private helper. Phase 2 ships
    -- var_contract + emergency_access; Phase N adds court/agency/family.

    CASE p_authorization_type
        WHEN 'var_contract' THEN
            v_authorization_valid := public._validate_authorization_var_contract(
                p_authorization_reference, p_consultant_org_id, p_provider_org_id
            );
        WHEN 'emergency_access' THEN
            -- N3 architect fold-in 2026-06-08: pre-emit guard above already
            -- enforces p_authorization_reference IS NULL for emergency_access,
            -- so the validator always receives NULL and returns TRUE
            -- unconditionally. Kept for signature uniformity with Phase N
            -- helpers per _validate_authorization_emergency_access docblock.
            v_authorization_valid := public._validate_authorization_emergency_access(
                p_authorization_reference, p_consultant_org_id, p_provider_org_id
            );
        ELSE
            -- Phase N types not yet implemented (court/agency/family).
            -- Envelope-return (not RAISE) so the caller gets a structured
            -- "not yet supported" response.
            RETURN jsonb_build_object(
                'success', false,
                'error',   'NOT_IMPLEMENTED',
                'errorDetails', jsonb_build_object(
                    'code',    'NOT_IMPLEMENTED',
                    'message', 'authorization_type not yet supported (Phase N work)'
                )
            );
    END CASE;

    IF NOT v_authorization_valid THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'AUTHORIZATION_VALIDATION_FAILED',
            'errorDetails', jsonb_build_object(
                'code',    'AUTHORIZATION_VALIDATION_FAILED',
                'message', 'No active backing record found for the supplied authorization_type + reference'
            )
        );
    END IF;

    -- =====================================================================
    -- SCOPE PATH RESOLUTION (for permission-snapshot tuples)
    -- =====================================================================
    -- Each {p, s} permission tuple snapshots `s` at the grant's scope path
    -- — the narrowest legitimate scope under HIPAA least-authority. All
    -- permissions in one grant share this path (the grant is the
    -- delegation unit; per-permission scope-narrowing belongs on a future
    -- policy-override RPC, not on grant creation).
    --
    -- For p_scope='organization_unit': scope_id is the OU id directly.
    -- For p_scope='client_specific':   scope_id is the client id; resolve
    --                                   the client's current OU placement
    --                                   (clients_projection.organization_unit_id),
    --                                   then look up that OU's path.

    IF p_scope = 'organization_unit' THEN
        SELECT path INTO v_scope_path
        FROM public.organization_units_projection
        WHERE id = p_scope_id
          AND deleted_at IS NULL;
        IF NOT FOUND THEN
            RETURN jsonb_build_object(
                'success', false,
                'error',   'SCOPE_NOT_FOUND',
                'errorDetails', jsonb_build_object(
                    'code',    'SCOPE_NOT_FOUND',
                    'message', 'organization_unit referenced by scope_id not found or deleted'
                )
            );
        END IF;
    ELSIF p_scope = 'client_specific' THEN
        -- S1 architect fold-in 2026-06-08 (Chunk 4 review): also read status.
        -- clients_projection.status CHECK is ('active','inactive','discharged')
        -- per 20260327205738_clients_projection.sql:116. A grant issued over
        -- a 'discharged' client would silently extend consultant access to
        -- a discharged record — HIPAA post-discharge access must be an
        -- explicit, gated path, not a side-door via grant creation.
        SELECT organization_unit_id, status
        INTO v_client_ou_id, v_client_status
        FROM public.clients_projection
        WHERE id = p_scope_id;
        IF NOT FOUND OR v_client_ou_id IS NULL THEN
            RETURN jsonb_build_object(
                'success', false,
                'error',   'SCOPE_NOT_FOUND',
                'errorDetails', jsonb_build_object(
                    'code',    'SCOPE_NOT_FOUND',
                    'message', 'client referenced by scope_id not found or not placed in an organization_unit'
                )
            );
        END IF;
        IF v_client_status = 'discharged' THEN
            RETURN jsonb_build_object(
                'success', false,
                'error',   'CLIENT_DISCHARGED',
                'errorDetails', jsonb_build_object(
                    'code',    'CLIENT_DISCHARGED',
                    'message', 'Cannot create grant over a discharged client'
                )
            );
        END IF;
        SELECT path INTO v_scope_path
        FROM public.organization_units_projection
        WHERE id = v_client_ou_id
          AND deleted_at IS NULL;
        IF NOT FOUND THEN
            RETURN jsonb_build_object(
                'success', false,
                'error',   'SCOPE_NOT_FOUND',
                'errorDetails', jsonb_build_object(
                    'code',    'SCOPE_NOT_FOUND',
                    'message', 'organization_unit for client not found (data integrity issue)'
                )
            );
        END IF;
    END IF;

    -- =====================================================================
    -- TEMPLATE LOOKUP + PERMISSION SNAPSHOT (INTERSECT narrowing only)
    -- =====================================================================
    -- F1 + K architect fold-in: Phase 1 deployed grant_role_templates with
    -- 3-column UNIQUE (template_name, authorization_type, permission_name)
    -- — ADR L232 still shows 2-column (ADR addendum tracked in
    -- observations.md). Filter all template reads on the triple.

    -- Existence guard: at least one template row matches
    SELECT count(*) INTO v_template_count
    FROM public.grant_role_templates
    WHERE template_name      = p_grant_role_template_name
      AND authorization_type = p_authorization_type
      AND is_active          = true;
    IF v_template_count = 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'TEMPLATE_NOT_FOUND',
            'errorDetails', jsonb_build_object(
                'code',    'TEMPLATE_NOT_FOUND',
                'message', 'No active grant_role_templates row matches (template_name, authorization_type, is_active)'
            )
        );
    END IF;

    -- F5 fold-in: INTERSECT operates on LITERAL template permission names
    -- only. Implications are NOT expanded here — implications happen at JWT
    -- issuance via compute_effective_permissions, GATED on grant-source rows
    -- by permission_implications.propagate_through_grants (HIPAA least-
    -- authority; default FALSE blocks implication-widening for grant-derived
    -- perms). Stage E probe F5 asserts the var_default 4-perm guarantee.
    IF p_permission_overrides IS NULL THEN
        SELECT jsonb_agg(jsonb_build_object('p', permission_name, 's', v_scope_path::text))
        INTO v_permissions_jsonb
        FROM public.grant_role_templates
        WHERE template_name      = p_grant_role_template_name
          AND authorization_type = p_authorization_type
          AND is_active          = true;
    ELSE
        SELECT jsonb_agg(jsonb_build_object('p', perm_name, 's', v_scope_path::text))
        INTO v_permissions_jsonb
        FROM (
            SELECT permission_name AS perm_name
            FROM public.grant_role_templates
            WHERE template_name      = p_grant_role_template_name
              AND authorization_type = p_authorization_type
              AND is_active          = true
            INTERSECT
            SELECT unnest(p_permission_overrides)
        ) narrowed;
        -- INTERSECT may yield empty if overrides don't intersect with template
        IF v_permissions_jsonb IS NULL OR jsonb_array_length(v_permissions_jsonb) = 0 THEN
            RETURN jsonb_build_object(
                'success', false,
                'error',   'EMPTY_PERMISSION_SET',
                'errorDetails', jsonb_build_object(
                    'code',    'EMPTY_PERMISSION_SET',
                    'message', 'permission_overrides INTERSECT template yielded no permissions; grant would be empty'
                )
            );
        END IF;
    END IF;

    -- Merge template default_terms via jsonb concat fold. v1 var_default all
    -- rows share default_terms; the fold is forward-compatible if Phase N
    -- templates vary per-permission. Right-side wins on key overlap
    -- (PG jsonb || semantics). Deterministic ORDER BY permission_name for
    -- replay-stability — relies on grant_role_templates_unique
    -- (template_name, authorization_type, permission_name) per F1/K, which
    -- guarantees permission_name is a unique tie-break within the filtered
    -- triple (N4 architect fold-in 2026-06-08).
    FOR v_terms_row IN
        SELECT default_terms
        FROM public.grant_role_templates
        WHERE template_name      = p_grant_role_template_name
          AND authorization_type = p_authorization_type
          AND is_active          = true
        ORDER BY permission_name
    LOOP
        v_template_terms := v_template_terms || COALESCE(v_terms_row.default_terms, '{}'::jsonb);
    END LOOP;

    -- ADR L209: v_final_terms := template.default_terms || p_terms
    -- Right-side wins on key overlap — caller-supplied terms override
    -- template defaults when they conflict.
    v_final_terms := v_template_terms || COALESCE(p_terms, '{}'::jsonb);

    -- =====================================================================
    -- EMIT access_grant.created EVENT (stream_id = pre-generated v_grant_id)
    -- =====================================================================
    -- Handler at process_access_grant_event.sql:11-39 reads event_data:
    --   consultant_org_id, consultant_user_id, provider_org_id,
    --   scope, scope_id, authorization_type, legal_reference,
    --   granted_by, expires_at, permissions (TOP LEVEL), terms,
    --   authorization_reference

    v_grant_id := gen_random_uuid();

    v_event_id := api.emit_domain_event(
        p_stream_id   := v_grant_id,
        p_stream_type := 'access_grant',
        p_event_type  := 'access_grant.created',
        p_event_data  := jsonb_build_object(
            'consultant_org_id',       p_consultant_org_id,
            'consultant_user_id',      p_consultant_user_id,
            'provider_org_id',         p_provider_org_id,
            'scope',                   p_scope,
            'scope_id',                p_scope_id,
            'authorization_type',      p_authorization_type,
            'authorization_reference', p_authorization_reference,
            'legal_reference',         p_legal_reference,
            'granted_by',              v_caller_id,
            'expires_at',              p_expires_at,
            'permissions',             v_permissions_jsonb,
            'terms',                   v_final_terms
        ),
        p_event_metadata := jsonb_build_object(
            'user_id',         v_caller_id,
            'organization_id', v_org_id,
            'source',          'api.create_access_grant',
            'reason',          p_reason
        )
    );

    -- =====================================================================
    -- PATTERN A v2 READ-BACK (BOTH checks per infrastructure CLAUDE.md)
    -- =====================================================================

    -- Check 1: IF NOT FOUND on projection read-back
    PERFORM 1
    FROM public.cross_tenant_access_grants_projection
    WHERE id = v_grant_id;
    IF NOT FOUND THEN
        SELECT processing_error INTO v_processing_error
        FROM public.domain_events WHERE id = v_event_id;
        RETURN jsonb_build_object(
            'success', false,
            'error',   'PROCESSING_FAILED',
            'errorDetails', jsonb_build_object(
                'code',    'PROCESSING_FAILED',
                'message', 'Event processing failed: ' ||
                    COALESCE(v_processing_error, 'projection read-back returned no row')
            ),
            'eventId', v_event_id
        );
    END IF;

    -- Check 2: processing_error on captured event_id (race-safe)
    SELECT processing_error INTO v_processing_error
    FROM public.domain_events WHERE id = v_event_id;
    IF v_processing_error IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'PROCESSING_FAILED',
            'errorDetails', jsonb_build_object(
                'code',    'PROCESSING_FAILED',
                'message', 'Event processing failed: ' || v_processing_error
            ),
            'eventId', v_event_id
        );
    END IF;

    -- =====================================================================
    -- SUCCESS ENVELOPE
    -- =====================================================================

    RETURN jsonb_build_object(
        'success', true,
        'eventId', v_event_id,
        'grant',   jsonb_build_object(
            'id',                      v_grant_id,
            'consultantOrgId',         p_consultant_org_id,
            'consultantUserId',        p_consultant_user_id,
            'providerOrgId',           p_provider_org_id,
            'scope',                   p_scope,
            'scopeId',                 p_scope_id,
            'authorizationType',       p_authorization_type,
            'authorizationReference',  p_authorization_reference,
            'permissions',             v_permissions_jsonb,
            'terms',                   v_final_terms,
            'expiresAt',               p_expires_at,
            'grantedBy',               v_caller_id,
            'grantedAt',               v_now
        )
    );
END;
$function$;

