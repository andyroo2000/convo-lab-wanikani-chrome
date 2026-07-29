# ConvoLab WaniKani Tracker

A Manifest V3 Chrome extension that records active WaniKani review time in
ConvoLab.

## What it records

Tracking runs only while:

- a secure `wanikani.com/subjects/review` page is visible;
- its tab is active and its Chrome window is focused;
- Chrome reports the user as active; and
- the page has received interaction within five minutes.

The content script sends only the current URL, page visibility, and interaction
timestamps. It never reads or transmits WaniKani answers, form values, or page
content.

Completed sessions are submitted to `https://convo-lab.com` using retry-safe
client UUIDs. Failed uploads remain queued locally. The ConvoLab access token is
stored in `chrome.storage.local` with access restricted to trusted extension
contexts, so WaniKani content scripts cannot read it.

## Local development

```bash
npm test
```

To load it manually, open `chrome://extensions`, enable Developer mode, select
**Load unpacked**, and choose the `extension` directory.

Development happens through pull requests. See `CLAUDE.md` for review guidance.
