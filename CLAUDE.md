# Review guidance

Prioritize:

- correct session boundaries across tab, window, browser-idle, and service-worker lifecycle changes;
- retry-safe uploads with stable client session IDs;
- credential isolation from content scripts and untrusted pages;
- a minimal permission set and strict production-origin handling;
- no collection of WaniKani answers, page content, or credentials;
- accessible extension UI and focused automated tests.

Treat lost or inflated study time, exposed ConvoLab credentials, and duplicate uploads as blockers.
