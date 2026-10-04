- **Google Meet: long uninterrupted speech no longer loses words.** Past 30 s without a pause the
  speaker buffer dropped everything said since its last STT request — measured at 23 of 119 words.
  That audio now carries into the next window.
- **STT backends behind Cloudflare or with validated model ids (e.g. Groq) pass the readiness probe.**
  The probe sends a User-Agent and the configured `TRANSCRIPTION_MODEL`; before, a working token was
  reported `unauthorized` or `invalid_endpoint` and bot spawns were refused.
- **German transcripts drop the faint-audio "Vielen Dank." hallucination.** See [Configuration](/configuration).
