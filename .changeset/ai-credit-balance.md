---
"@omnidotdev/facet": patch
---

Show the remaining monthly AI credit balance in the Describe-a-part panel ("N credits left this month"), so the per-generation credit cost has context instead of being a bare number. The balance comes from the gateway's capability probe, updates after each generation without a re-fetch, and is simply omitted when unavailable.
