# Certificate preservation during instructor account deletion

Deleting an instructor currently deletes their courses. Certificates issued to **other** members for those courses must not disappear as a side effect. The admin deletion route now rejects such a request with HTTP 409 before any destructive write. Certificates belonging to the account being deleted are still erased with that account. Direct course deletion retains its existing certificate guard.

This is deliberately a narrow safety rule, not an account-transfer flow. An administrator cannot complete deletion of an instructor with third-party certificates until a separate preservation mechanism exists. The UI explains the block without promising a transfer feature.

## Possible follow-up, requiring product and privacy review

- Design a detached, immutable certificate record for the learner that retains the issued course and learner names, issue time, and stable credential ID without requiring the deleted instructor's course row. Keep the learner account relation so deleting that learner still erases their credential.
- Migrate only actually issued certificates; do not infer credentials from historical completion timestamps. Keep PDF download and certificate-list access owner-scoped, and update all queries that assume a live course relation.
- In one serializable account-deletion transaction, detach or snapshot other learners' certificates, remove the instructor's own certificates, revoke active course rewards with a visible reason, and delete the course/account. Exercise concurrent issuance, retry, migration replay and account-erasure cases on both database providers.

The current mock retry regression checks that a simulated serialization failure re-runs the guard and sees a newly issued certificate. A live PostgreSQL concurrency test remains open.
