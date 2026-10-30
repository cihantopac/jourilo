# Pulse dashboard fixture

Client-rendered (History API) dashboard with a fake session. Test account (fixture only):
`demo@example.test` / `demo-password`.

Seeded problems behind sign-in: focus hidden under a fixed help bar (2.4.11), a Tab trap in the range picker (2.1.2),
a ~650 ms click handler (slow INP). Used by `tests/browser/auth-spa.test.ts`.
