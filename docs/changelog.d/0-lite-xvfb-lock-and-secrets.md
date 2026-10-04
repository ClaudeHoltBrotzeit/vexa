- **Vexa Lite: bots join again after a container restart.** A restart kept the previous run's X
  display lock, Xvfb refused to start, and every bot failed with "Missing X server". The entrypoint
  now clears the stale lock before the display starts.
- **Vexa Lite: no published secrets, loopback-only front doors.** `ADMIN_TOKEN`,
  `INTERNAL_API_SECRET`, `VEXA_DISPATCH_SIGNING_KEY` and `NEXTAUTH_SECRET` are generated when unset
  instead of defaulting to well-known values, and the ports bind to `127.0.0.1` unless
  `BIND_ADDR=0.0.0.0` is set. An existing `.env` with `ADMIN_TOKEN=changeme` keeps working but
  `make up` warns. See [Configuration](/configuration).
