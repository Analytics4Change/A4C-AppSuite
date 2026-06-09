CREATE OR REPLACE FUNCTION public.process_var_partnership_event(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  CASE p_event.event_type

    WHEN 'var_partnership.created' THEN
      -- F1 architect fold-in 2026-06-04: idempotency guard on stream_id
      -- replay. The Step 11 emit RPC enforces the duplicate-business-key
      -- precondition (partner_org_id, provider_org_id) via partial UNIQUE;
      -- this guard handles the orthogonal axis (same stream_id replay
      -- under retry / baseline rebuild). Without this, retry produces a
      -- stale failed event per codified pitfall #4 (EXCEPTION WHEN
      -- unique_violation is dead code).
      --
      -- N1 architect fold-in: created_at + updated_at use p_event.created_at
      -- per access_grant.created precedent (handlers/routers/
      -- process_access_grant_event.sql:36). Column DEFAULT now() at Step 1
      -- is a belt-and-suspenders guard against the never-permitted
      -- direct-INSERT path.
      IF EXISTS (
        SELECT 1 FROM public.var_partnerships_projection
        WHERE id = p_event.stream_id
      ) THEN
        RETURN;
      END IF;
      INSERT INTO public.var_partnerships_projection (
        id,
        partner_org_id, partner_org_name,
        provider_org_id, provider_org_name,
        partnership_type, contract_number,
        contract_start_date, contract_end_date,
        revenue_share_percentage, support_level,
        terms, status,
        created_at, updated_at
      ) VALUES (
        p_event.stream_id,
        public.safe_jsonb_extract_uuid(p_event.event_data, 'partner_org_id'),
        public.safe_jsonb_extract_text(p_event.event_data, 'partner_org_name'),
        public.safe_jsonb_extract_uuid(p_event.event_data, 'provider_org_id'),
        public.safe_jsonb_extract_text(p_event.event_data, 'provider_org_name'),
        public.safe_jsonb_extract_text(p_event.event_data, 'partnership_type'),
        public.safe_jsonb_extract_text(p_event.event_data, 'contract_number'),
        public.safe_jsonb_extract_date(p_event.event_data, 'contract_start_date'),
        public.safe_jsonb_extract_date(p_event.event_data, 'contract_end_date'),
        public.safe_jsonb_extract_numeric(p_event.event_data, 'revenue_share_percentage'),
        public.safe_jsonb_extract_text(p_event.event_data, 'support_level'),
        COALESCE(p_event.event_data->'terms', '{}'::jsonb),
        'active',
        p_event.created_at,
        p_event.created_at
      );

    WHEN 'var_partnership.updated' THEN
      -- PATCH semantics: only non-null keys overwrite. Immutable fields
      -- (id, partner_org_id, provider_org_id, contract_start_date) are
      -- not included.
      --
      -- S1 architect fold-in 2026-06-04: an `updated` event with no
      -- mutable keys still advances updated_at = p_event.created_at. This
      -- is intentional — the event itself IS the change-record; the
      -- projection's substantive columns may legitimately be stable
      -- (e.g., audit-only update). The Step 12 api.update_var_partnership
      -- emit RPC SHOULD reject empty-payload calls at the precondition
      -- layer.
      UPDATE public.var_partnerships_projection
      SET
        partner_org_name = COALESCE(
          public.safe_jsonb_extract_text(p_event.event_data, 'partner_org_name'),
          partner_org_name
        ),
        provider_org_name = COALESCE(
          public.safe_jsonb_extract_text(p_event.event_data, 'provider_org_name'),
          provider_org_name
        ),
        partnership_type = COALESCE(
          public.safe_jsonb_extract_text(p_event.event_data, 'partnership_type'),
          partnership_type
        ),
        contract_number = COALESCE(
          public.safe_jsonb_extract_text(p_event.event_data, 'contract_number'),
          contract_number
        ),
        contract_end_date = COALESCE(
          public.safe_jsonb_extract_date(p_event.event_data, 'contract_end_date'),
          contract_end_date
        ),
        revenue_share_percentage = COALESCE(
          public.safe_jsonb_extract_numeric(p_event.event_data, 'revenue_share_percentage'),
          revenue_share_percentage
        ),
        support_level = COALESCE(
          public.safe_jsonb_extract_text(p_event.event_data, 'support_level'),
          support_level
        ),
        terms = COALESCE(p_event.event_data->'terms', terms),
        updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Partnership not found for var_partnership.updated'
          USING ERRCODE = 'P0002';
      END IF;

    WHEN 'var_partnership.terminated' THEN
      UPDATE public.var_partnerships_projection
      SET status = 'terminated',
          terminated_at = p_event.created_at,
          terminated_by = COALESCE(
            public.safe_jsonb_extract_uuid(p_event.event_data, 'terminated_by'),
            public.safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
          ),
          termination_reason = public.safe_jsonb_extract_text(p_event.event_data, 'termination_reason'),
          updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Partnership not found for var_partnership.terminated'
          USING ERRCODE = 'P0002';
      END IF;

    WHEN 'var_partnership.suspended' THEN
      UPDATE public.var_partnerships_projection
      SET status = 'suspended',
          suspended_at = p_event.created_at,
          suspended_by = COALESCE(
            public.safe_jsonb_extract_uuid(p_event.event_data, 'suspended_by'),
            public.safe_jsonb_extract_uuid(p_event.event_metadata, 'user_id')
          ),
          suspension_reason = public.safe_jsonb_extract_text(p_event.event_data, 'suspension_reason'),
          updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Partnership not found for var_partnership.suspended'
          USING ERRCODE = 'P0002';
      END IF;

    WHEN 'var_partnership.reactivated' THEN
      -- Clear suspension fields, restore status='active'. No reactivated_at
      -- column on the projection (per ADR L262-286); audit lives in
      -- domain_events.
      UPDATE public.var_partnerships_projection
      SET status = 'active',
          suspended_at = NULL,
          suspended_by = NULL,
          suspension_reason = NULL,
          updated_at = p_event.created_at
      WHERE id = p_event.stream_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Partnership not found for var_partnership.reactivated'
          USING ERRCODE = 'P0002';
      END IF;

    ELSE
      -- Codified pattern: router ELSE must RAISE EXCEPTION (NOT WARNING).
      -- WHEN OTHERS in process_domain_event catches this and persists the
      -- error to domain_events.processing_error. ERRCODE P9001 follows
      -- the access_grant router precedent.
      RAISE EXCEPTION 'Unhandled event type "%" in process_var_partnership_event',
        p_event.event_type
        USING ERRCODE = 'P9001';
  END CASE;
END;
$function$;
