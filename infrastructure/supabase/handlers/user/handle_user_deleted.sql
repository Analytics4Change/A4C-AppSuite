CREATE OR REPLACE FUNCTION public.handle_user_deleted(p_event record)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    -- TOMBSTONE FIRST (load-bearing: must precede the projection DELETEs so the
    -- accessible_organizations recompute triggered by the user_organizations_
    -- projection DELETE self-guards on deleted_at IS NULL to a no-op).
    -- COALESCE order: existing tombstone wins (replay-safe), then event payload's
    -- deleted_at, then event creation time as final fallback.
    UPDATE public.users
       SET deleted_at = COALESCE(
             deleted_at,
             (p_event.event_data->>'deleted_at')::timestamptz,
             p_event.created_at
           ),
           is_active = false,
           updated_at = p_event.created_at
     WHERE id = p_event.stream_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
    END IF;

    -- CASCADE: hard-DELETE membership/identity projections anchored on user_id.
    -- Derived "membership state" no longer holds once the user is tombstoned;
    -- domain_events remains the audit trail. Audit-reference columns (assigned_by,
    -- created_by, granted_by, ...) live on OTHER rows and are untouched.
    -- Grant-revoke is handled by the AFTER-INSERT trigger
    -- emit_grant_revocations_on_user_deleted (NOT here — no emit_domain_event in
    -- this synchronous body; see migration 20260622212441 / architect F1).
    DELETE FROM public.user_roles_projection                    WHERE user_id = p_event.stream_id;
    DELETE FROM public.user_organizations_projection            WHERE user_id = p_event.stream_id;
    DELETE FROM public.user_notification_preferences_projection WHERE user_id = p_event.stream_id;
    DELETE FROM public.user_addresses                           WHERE user_id = p_event.stream_id;
    DELETE FROM public.user_phones                              WHERE user_id = p_event.stream_id;
    DELETE FROM public.user_client_assignments_projection       WHERE user_id = p_event.stream_id;
    DELETE FROM public.schedule_user_assignments_projection     WHERE user_id = p_event.stream_id;

    -- contacts_projection: preserve the contact entity, drop only the user
    -- linkage (user_id nullable; partial indexes idx_contacts_unique_user_per_org
    -- and idx_contacts_user_id, both WHERE user_id IS NOT NULL, tolerate NULLs).
    -- The explicit user_id IS NOT NULL conjunct makes replay a guaranteed no-op.
    UPDATE public.contacts_projection SET user_id = NULL
     WHERE user_id = p_event.stream_id AND user_id IS NOT NULL;
END;
$function$;
