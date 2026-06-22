-- AFTER-INSERT trigger fn on public.domain_events WHEN (NEW.event_type = 'user.deleted').
-- Revokes active cross-tenant grants whose consultant_user_id is the deleted user,
-- by emitting one access_grant.revoked event per grant. Event-chaining lives in an
-- AFTER-INSERT trigger (NOT a nested emit from the BEFORE handler handle_user_deleted):
-- a nested emit would bury an inner failure in the inner event's processing_error,
-- which api.delete_user's outer Pattern-A-v2 read-back never inspects. Running after
-- the outer user.deleted row is durable, any inner emit failure surfaces as a normal
-- retryable processing_error on its own event row. (architect F1, migration 20260622212441)
--
-- Trigger DDL (in the migration, not this ref file):
--   CREATE TRIGGER emit_grant_revocations_on_user_deleted_trigger
--     AFTER INSERT ON public.domain_events FOR EACH ROW
--     WHEN (NEW.event_type = 'user.deleted')
--     EXECUTE FUNCTION public.emit_grant_revocations_on_user_deleted();
CREATE OR REPLACE FUNCTION public.emit_grant_revocations_on_user_deleted()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_grant record;
BEGIN
    -- INVARIANT: a deleted user can only be a grant *consultant*, never a grant
    -- *target* (targets are orgs/clients, never users), so consultant_user_id =
    -- NEW.stream_id is the COMPLETE revoke set. Revisit for Phase N if any
    -- user-as-target grant type is ever introduced.
    FOR v_grant IN
        SELECT id
        FROM public.cross_tenant_access_grants_projection
        WHERE consultant_user_id = NEW.stream_id
          AND status = 'active'
    LOOP
        -- Handler process_access_grant_event keys its UPDATE on event_data->>'grant_id'
        -- (NOT stream_id); set both. revoked_by NULL = automated (AsyncAPI contract
        -- AccessGrantRevokedData.revoked_by made nullable in the same PR). READ-SIDE
        -- POSTCONDITION: rows revoked via this path carry revoked_by IS NULL —
        -- consumers must treat revoked_by as nullable.
        PERFORM api.emit_domain_event(
            p_stream_id      := v_grant.id,
            p_stream_type    := 'access_grant',
            p_event_type     := 'access_grant.revoked',
            p_event_data     := jsonb_build_object(
                'grant_id',           v_grant.id,
                'revoked_by',         NULL,
                'revocation_reason',  'consultant_user_deleted',
                'revocation_details', 'Consultant user was soft-deleted; grant auto-revoked by handle_user_deleted cascade.'
            ),
            p_event_metadata := jsonb_build_object(
                'automated', true,
                'source',    'handle_user_deleted_cascade',
                'user_id',   NULL,
                'reason',    'consultant_user_deleted'
            )
        );
    END LOOP;

    RETURN NULL;  -- AFTER trigger: return value ignored
END;
$function$;
