# ConvoLab Study Tracker

A Manifest V3 Chrome extension that records active WaniKani review and Satori
Reader article time in ConvoLab.

## What it records

Tracking runs only while a supported study page is visible:

- a secure `wanikani.com/subjects/review` page or
  `satorireader.com/articles/<article>` page is visible;
- its tab is active and its Chrome window is focused;
- Chrome reports the user as active; and
- the page has received interaction within five minutes.

The content script sends only the current URL, page visibility, and interaction
timestamps. It never reads or transmits WaniKani answers, Satori Reader article
content, form values, or page content.

Completed sessions are submitted to `https://convo-lab.com` using retry-safe
client UUIDs. WaniKani sessions are saved as WaniKani reviews, while Satori
Reader sessions are saved separately as reading immersion. Failed uploads
remain in bounded queues separated by ConvoLab
account; permanently invalid entries are isolated so they cannot block later
sessions.
The ConvoLab access token is stored in `chrome.storage.local` with access
restricted to trusted extension contexts, so supported-site content scripts
cannot read it. Host-scoped content-script connections stop tracking after a
tab navigates elsewhere without granting access to unrelated tab URLs.

## Local development

```bash
npm test
```

To load it manually, open `chrome://extensions`, enable Developer mode, select
**Load unpacked**, and choose the `extension` directory.

Development happens through pull requests. See `CLAUDE.md` for review guidance.
