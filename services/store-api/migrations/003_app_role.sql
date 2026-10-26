-- withBusiness() runs SET LOCAL ROLE pos_app. On a hosted Postgres the app signs in as an ordinary
-- admin user, not a superuser, and since Postgres 16 creating a role doesn't let its creator switch
-- to it, so grant that explicitly. A no-op for a superuser (PGlite).
DO $$
BEGIN
  EXECUTE format('GRANT pos_app TO %I WITH INHERIT FALSE, SET TRUE', current_user);
END
$$;
