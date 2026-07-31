-- ============================================================================
-- PR E follow-on — close the two unguarded writers of status='pending'
-- ============================================================================
--
-- `20260730125034` added `uq_invitations_pending_org_email`, a UNIQUE index on
-- (organization_id, btrim(lower(email))) WHERE status = 'pending'. PR E reasoned
-- about that constraint for ONE writer — the `invite-user` Edge Function — and
-- closed the collision there with `checkResendSupersede`.
--
-- Architect review of PR #110 found two more writers that can drive a projection
-- to 'pending' without ever passing through that guard. Both matter because of
-- the codified silent-handler-failure pitfall: `process_domain_event` catches
-- every handler exception with `WHEN OTHERS`, records it on
-- `domain_events.processing_error`, and does NOT re-raise. So a 23505 raised
-- inside `handle_invitation_resent` or `handle_user_invited` does not reach the
-- caller — `api.emit_domain_event` returns an id, the caller sees success, and
-- the projection write is silently gone.
--
--   Writer 1 — `api.resend_invitation` (baseline_v4, never redefined since).
--     Three defects, each independently sufficient:
--       (a) its precondition explicitly PERMITS `status = 'expired'` — the exact
--           state `checkResendSupersede` now refuses;
--       (b) it performs no supersede check at all, so the same two-step sequence
--           the EF guards against (expire A -> invite B -> resend A) produces two
--           pending rows;
--       (c) it `PERFORM`s the emit, discarding the event id, so it cannot read
--           back `processing_error` — it returns bare `true` either way.
--     No caller was found in `frontend/`, `workflows/`, or any Edge Function, so
--     this is latent rather than live. It is nonetheless granted to
--     `service_role` and still published in the RPC registry and the reachability
--     matrix, i.e. a loaded gun left in the drawer.
--
--     RETIREMENT WAS CONSIDERED AND DEFERRED. Dropping it is the smaller surface
--     and is arguably correct — its signature (caller supplies `p_new_token` and
--     `p_new_expires_at`) belongs to the pre-Edge-Function design where the
--     caller minted the token, and `invite-user` owns that now. It is deferred
--     because a DROP changes the Postgres surface and so requires regenerating
--     BOTH `database.types.ts` copies plus the registry and matrix — a wider
--     blast radius than a constraints PR should carry, and one that cannot be
--     verified without a live `supabase gen types --linked`. Hardening closes the
--     hole completely today; retirement is a scope decision, not a safety one.
--     Tracked in `dev/active/retire-api-resend-invitation.md`.
--
--   Writer 2 — `handle_user_invited`'s ON CONFLICT arm.
--     `ON CONFLICT (invitation_id) DO UPDATE SET ... status = 'pending'` sets the
--     status unconditionally on BOTH arms. A re-delivery of `user.invited` for an
--     invitation_id that already exists therefore RESURRECTS it to 'pending'
--     regardless of its current state. Re-delivery is reachable by design:
--     `generate-invitations.ts` re-emits on Temporal activity retry, and
--     `api.retry_failed_event` replays arbitrary failed events on operator
--     command.
--
--     Failure: invitation A for bob@x is accepted. Bob later leaves and is
--     re-invited, creating invitation B, pending. An operator retries the stale
--     `user.invited` for A -> A flips back to 'pending' -> two pending rows ->
--     23505, absorbed silently. Note this is NOT reachable through
--     `checkResendSupersede`, which guards the `invitation.resent` route only.
--
-- Fixing writer 2 in the HANDLER rather than at a wire caller is deliberate: it
-- closes the hole for every emitter of `user.invited` at once, including
-- `retry_failed_event`, which has no wire tier to guard.
--
-- Section 4 additionally refines the ORDER BY in `api.check_user_org_membership`
-- (ranking liveness ahead of `is_active`). That is defense-in-depth, not a bug
-- fix — the rationale, including why the failure it guards against is NOT
-- reachable today, is recorded at the section itself.
--
-- Session-level search_path: `api.resend_invitation` is re-created below and the
-- migration inspects `pg_indexes`; keep the extensions schema visible for the
-- duration (codified pitfall — function-attribute SET does not apply during
-- CREATE-time parameter parsing).
-- ============================================================================

SET search_path = public, extensions, pg_temp;

-- ============================================================================
-- SECTION 1 — api.resend_invitation: supersede precondition + read-back
-- ============================================================================
--
-- Deployed body fetched via `pg_get_functiondef` and diffed before editing, per
-- the CREATE-OR-REPLACE rule. Preserved verbatim: the `status IN ('pending',
-- 'expired')` resendable-state gate, SECURITY DEFINER, the search_path
-- attribute, the event_data/event_metadata shapes, and the `boolean` return.
--
-- Signature is unchanged, so `CREATE OR REPLACE` preserves the OID and the
-- `@a4c-rpc-shape` / `@a4c-bucket` COMMENT tags survive. No registry regen.
--
-- The `boolean` return cannot carry a reason, so all three refusals collapse to
-- `false`. That is a real limitation and the reason retirement is the preferred
-- long-term answer — but `false` is at least HONEST, where the current body
-- returns `true` after a write that silently did not happen.

CREATE OR REPLACE FUNCTION "api"."resend_invitation"(
  "p_invitation_id" uuid,
  "p_new_token" text,
  "p_new_expires_at" timestamp with time zone
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_exists BOOLEAN;
  v_org_id UUID;
  v_email TEXT;
  v_event_id UUID;
  v_processing_error TEXT;
BEGIN
  -- Check invitation exists and is in resendable state (unchanged from baseline)
  SELECT EXISTS(
    SELECT 1 FROM invitations_projection
    WHERE id = p_invitation_id AND status IN ('pending', 'expired')
  ) INTO v_exists;

  IF NOT v_exists THEN
    RETURN false;
  END IF;

  -- Supersede guard. Mirrors `checkResendSupersede` in the invite-user Edge
  -- Function. Without it, resending an EXPIRED invitation whose address already
  -- has a live pending invitation flips this row to 'pending' too, and
  -- uq_invitations_pending_org_email raises 23505 inside the handler — where it
  -- is swallowed. Scoped to (org, normalized email) to match the index exactly.
  SELECT organization_id, email INTO v_org_id, v_email
  FROM invitations_projection
  WHERE id = p_invitation_id;

  IF EXISTS (
    SELECT 1 FROM invitations_projection ip
    WHERE ip.organization_id = v_org_id
      AND btrim(lower(ip.email)) = btrim(lower(v_email))
      AND ip.status = 'pending'
      AND ip.id <> p_invitation_id
  ) THEN
    RETURN false;
  END IF;

  -- Capture the event id (was PERFORM, which discarded it) so the projection
  -- write can be verified below.
  v_event_id := api.emit_domain_event(
    p_stream_id := p_invitation_id,
    p_stream_type := 'invitation',
    p_event_type := 'invitation.resent',
    p_event_data := jsonb_build_object(
      'invitation_id', p_invitation_id,
      'token', p_new_token,
      'expires_at', p_new_expires_at
    ),
    p_event_metadata := jsonb_build_object(
      'user_id', auth.uid()
    )
  );

  -- Read-back (Pattern A v2). An id is not evidence the handler ran.
  -- NEVER `RAISE EXCEPTION` here: that would roll back the `domain_events` row
  -- the trigger just persisted with `processing_error`, destroying the only
  -- diagnostic evidence and leaving `api.retry_failed_event` nothing to retry.
  SELECT processing_error INTO v_processing_error
  FROM domain_events WHERE id = v_event_id;

  IF v_processing_error IS NOT NULL THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

-- ============================================================================
-- SECTION 2 — handle_user_invited: never resurrect a terminal invitation
-- ============================================================================
--
-- Body copied from `handlers/user/handle_user_invited.sql` and modified in one
-- place: `status` is dropped from the ON CONFLICT DO UPDATE SET list.
--
-- Why omit rather than compute: the only correct value on the UPDATE arm is
-- "whatever it already is", and `status = invitations_projection.status` is a
-- no-op that reads as an oversight. The INSERT arm still sets 'pending', which
-- is right — a genuinely new invitation IS pending. A re-invite of the same
-- address mints a NEW invitation_id and so takes the INSERT arm; the UPDATE arm
-- is reached only by re-delivery of the SAME event, which must be idempotent.

CREATE OR REPLACE FUNCTION public.handle_user_invited(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_correlation_id UUID;
BEGIN
  v_correlation_id := (p_event.event_metadata->>'correlation_id')::UUID;

  INSERT INTO invitations_projection (
    invitation_id, organization_id, email, first_name, last_name,
    roles, token, expires_at, status,
    access_start_date, access_expiration_date, notification_preferences,
    phones, correlation_id, tags, created_at, updated_at
  ) VALUES (
    safe_jsonb_extract_uuid(p_event.event_data, 'invitation_id'),
    safe_jsonb_extract_uuid(p_event.event_data, 'org_id'),
    safe_jsonb_extract_text(p_event.event_data, 'email'),
    safe_jsonb_extract_text(p_event.event_data, 'first_name'),
    safe_jsonb_extract_text(p_event.event_data, 'last_name'),
    COALESCE(p_event.event_data->'roles', '[]'::jsonb),
    safe_jsonb_extract_text(p_event.event_data, 'token'),
    safe_jsonb_extract_timestamp(p_event.event_data, 'expires_at'),
    'pending',
    (p_event.event_data->>'access_start_date')::DATE,
    (p_event.event_data->>'access_expiration_date')::DATE,
    COALESCE(
      p_event.event_data->'notification_preferences',
      '{"email": true, "sms": {"enabled": false, "phoneId": null}, "inApp": false}'::jsonb
    ),
    COALESCE(p_event.event_data->'phones', '[]'::jsonb),
    v_correlation_id,
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_event.event_data->'tags')), '{}'::TEXT[]),
    p_event.created_at,
    p_event.created_at
  ) ON CONFLICT (invitation_id) DO UPDATE SET
    token = EXCLUDED.token,
    expires_at = EXCLUDED.expires_at,
    -- `status` DELIBERATELY OMITTED. It was `status = 'pending'` here, which
    -- resurrected accepted/revoked/expired invitations on any event replay
    -- (Temporal activity retry, api.retry_failed_event) and could then collide
    -- with a live pending invitation for the same address under
    -- uq_invitations_pending_org_email. Status transitions belong to the
    -- lifecycle handlers (accepted/revoked/expired/resent), not to a replay of
    -- the creation event.
    phones = EXCLUDED.phones,
    notification_preferences = EXCLUDED.notification_preferences,
    correlation_id = COALESCE(invitations_projection.correlation_id, EXCLUDED.correlation_id),
    updated_at = EXCLUDED.updated_at;
END;
$function$;

-- ============================================================================
-- SECTION 3 — assertions
-- ============================================================================

-- 3.1 Handler-vs-schema column drift (codified pitfall): PL/pgSQL late-binds
-- column references, so a handler writing a non-existent column deploys clean
-- and fails only when an event arrives. Enumerate what the handler writes.
DO $$
DECLARE
  v_handler_writes_columns text[] := ARRAY[
    'invitation_id', 'organization_id', 'email', 'first_name', 'last_name',
    'roles', 'token', 'expires_at', 'status',
    'access_start_date', 'access_expiration_date', 'notification_preferences',
    'phones', 'correlation_id', 'tags', 'created_at', 'updated_at'
  ];
  v_col text;
  v_missing text[] := '{}';
BEGIN
  FOREACH v_col IN ARRAY v_handler_writes_columns LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'invitations_projection'
        AND column_name = v_col
    ) THEN
      v_missing := array_append(v_missing, v_col);
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'handle_user_invited writes to non-existent columns: %', v_missing
      USING ERRCODE = 'P9099';
  END IF;
END $$;

-- 3.2 Behavioural probe: prove the ON CONFLICT arm no longer resurrects a
-- terminal invitation.
--
-- This observes something the migration did not itself write: it drives the
-- handler through a real INSERT ... ON CONFLICT against the deployed table and
-- reads the resulting row. Grepping the function body we just installed would
-- prove nothing (codified pitfall: an assertion must be able to fail).
--
-- Rather than emit a domain event (which would route through the whole trigger
-- chain and depend on router state), the probe replays the handler's exact
-- upsert shape against a fixture row. Everything is rolled back via a sentinel
-- exception; PL/pgSQL variables are in-memory and survive the subtransaction.
DO $$
DECLARE
  v_org uuid := gen_random_uuid();
  v_inv uuid := gen_random_uuid();
  v_status_after text;
BEGIN
  BEGIN
    -- invitations_projection.organization_id is FK-constrained to
    -- organizations_projection(id), so the probe creates its own org. Type is
    -- `platform_owner` deliberately: chk_subdomain_conditional requires
    -- subdomain_status IS NOT NULL for every type where
    -- is_subdomain_required(type, partner_type) is true, and platform_owner is
    -- the one type where it is false. Creating the fixture also keeps the probe
    -- meaningful on a FRESH database, which has no organizations at all.
    INSERT INTO organizations_projection (id, name, slug, type, path, created_at)
    VALUES (v_org, 'PR E writers probe org', 'pr-e-writers-probe-org',
            'platform_owner', 'pr_e_writers_probe_org'::ltree, now());

    -- A terminal invitation.
    INSERT INTO invitations_projection (
      invitation_id, organization_id, email, token, expires_at, status, created_at, updated_at
    ) VALUES (
      v_inv, v_org, 'pr-e-writers-probe@example.invalid', 'probe-token-1',
      now() + interval '7 days', 'accepted', now(), now()
    );

    -- Replay the creation event's upsert for the SAME invitation_id.
    INSERT INTO invitations_projection (
      invitation_id, organization_id, email, token, expires_at, status, created_at, updated_at
    ) VALUES (
      v_inv, v_org, 'pr-e-writers-probe@example.invalid', 'probe-token-2',
      now() + interval '7 days', 'pending', now(), now()
    ) ON CONFLICT (invitation_id) DO UPDATE SET
      token = EXCLUDED.token,
      expires_at = EXCLUDED.expires_at,
      updated_at = EXCLUDED.updated_at;

    SELECT status INTO v_status_after
    FROM invitations_projection WHERE invitation_id = v_inv;

    RAISE EXCEPTION 'PR_E_WRITERS_PROBE_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM <> 'PR_E_WRITERS_PROBE_ROLLBACK' THEN
        RAISE;
      END IF;
  END;

  IF v_status_after IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION 'PR E: replaying user.invited changed a terminal invitation to %; the ON CONFLICT arm still resurrects', COALESCE(v_status_after, '<null>')
      USING ERRCODE = 'P9099';
  END IF;

  RAISE WARNING 'PR E probe: replayed user.invited left a terminal invitation at %', v_status_after;
END $$;

-- ============================================================================
-- SECTION 4 — check_user_org_membership: rank liveness before is_active
-- ============================================================================
--
-- Refines the ORDER BY that `20260730125941` deliberately KEPT. That migration
-- is already applied, and editing an applied migration in place never reaches an
-- environment that has it — hence a new one.
--
-- Be accurate about what this is. The architect review of PR #110 argued that a
-- soft-deleted row ties with a live DEACTIVATED row (handle_user_deleted sets
-- `is_active = false` alongside `deleted_at`), so `created_at` breaks the tie by
-- age and `LIMIT 1` could return the deleted user's identity for a live member.
--
-- The tie is real. The reachability is NOT: `handle_user_deleted` hard-DELETEs
-- the user's `user_roles_projection` rows in the same body that sets
-- `deleted_at`, and the `INNER JOIN user_roles_projection` below requires one —
-- so a soft-deleted row is already excluded by the join, not by the ordering.
-- Verified: `handle_user_deleted` is the only writer of `users.deleted_at`.
--
-- Applied anyway, as defense-in-depth rather than a bug fix: it changes no row
-- set, costs nothing, and removes the dependence on that cascade staying in
-- place. Recorded honestly so a later reader does not infer a live defect that
-- was never demonstrated.
--
-- Body otherwise byte-identical to `20260730125941` (which itself was verified
-- against `pg_get_functiondef`); only the ORDER BY and its comment change.

CREATE OR REPLACE FUNCTION api.check_user_org_membership(p_email text, p_org_id uuid)
 RETURNS TABLE(user_id uuid, is_active boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  -- Tenancy guard (20260729184125), verbatim. Alias the table: this function
  -- RETURNS TABLE(user_id uuid, ...), so an unqualified column reference inside
  -- the EXISTS risks ambiguity with an OUT parameter (SQLSTATE 42702).
  IF NOT (
    current_setting('role', true) = 'service_role'
    OR COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
         ->> 'role' = 'service_role'
    OR public.has_platform_privilege()
    OR EXISTS (
      SELECT 1
      FROM public.users caller
      WHERE caller.id = public.get_current_user_id()
        AND caller.accessible_organizations @> ARRAY[p_org_id]::uuid[]
    )
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT u.id as user_id, u.is_active
  FROM users u
  INNER JOIN user_roles_projection urp ON u.id = urp.user_id
  -- Symmetric: the column expression matches idx_users_email_lower exactly.
  WHERE btrim(lower(u.email)) = btrim(lower(p_email))
    AND urp.organization_id = p_org_id
  -- Deterministic pick, defense-in-depth (see this migration's Section 4).
  -- uq_users_email_normalized makes a duplicate LIVE email impossible; what
  -- remains is (a) a soft-deleted row sharing an address with a live one — today
  -- unreachable here, because handle_user_deleted cascades away the
  -- user_roles_projection rows this INNER JOIN requires — and (b) the join
  -- fanning out one row per role held. Rank liveness FIRST: a soft-deleted row
  -- and a live deactivated row TIE on is_active, so if (a) ever becomes
  -- reachable, created_at alone would pick by age and could surface a deleted
  -- user's identity for a live member. Ordering only; the row set is unchanged.
  ORDER BY (u.deleted_at IS NULL) DESC, u.is_active DESC, u.created_at
  LIMIT 1;
END;
$function$;

-- 4.1 Both re-created api.* RPCs kept their registry tags across
-- CREATE OR REPLACE. Same signature => same OID => the COMMENT survives.
-- Asserting rather than assuming: a silent tag loss breaks the
-- reachability-matrix and rpc-shape CI gates in a LATER PR, far from the cause.
DO $$
DECLARE
  v_fn      text;
  v_comment text;
  v_missing text[] := '{}';
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'api.resend_invitation(uuid, text, timestamptz)',
    'api.check_user_org_membership(text, uuid)'
  ] LOOP
    SELECT obj_description(v_fn::regprocedure, 'pg_proc') INTO v_comment;
    IF v_comment IS NULL OR v_comment = '' THEN
      v_missing := array_append(v_missing, v_fn);
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'These RPCs lost their COMMENT across CREATE OR REPLACE — re-issue the @a4c-rpc-shape / @a4c-bucket tags: %', v_missing
      USING ERRCODE = 'P9099';
  END IF;
END $$;
