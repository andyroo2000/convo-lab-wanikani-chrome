# ConvoLab Study Tracker

A Manifest V3 Chrome extension that records active WaniKani review and Satori
Reader article time, displays Japanese and English video subtitles, and creates
ConvoLab audio-recognition cards from Netflix and YouTube dialogue.

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

## Netflix and YouTube dialogue capture

While signed in, open a Netflix or YouTube video, click the extension, and
select **Enable on this tab**. The extension then:

- displays Japanese and English subtitle tracks together when the title makes
  those tracks available;
- keeps up to three minutes of that tab's audio in memory only;
- adds a **+ Card** control beside each current Japanese subtitle; and
- opens a waveform editor where the clip start and end can be dragged, played
  back, and given optional 25 ms fade-in and fade-out edges.

Creating the card uploads only the edited dialogue text and trimmed WAV clip to
the signed-in ConvoLab account. The new audio-recognition card is promoted to
the front of the new-card queue. Stopping dialogue capture, closing the tab, or
signing out discards the in-memory rolling buffer.

See the [privacy policy](PRIVACY.md) for the complete data-handling disclosure.

## Local development

```bash
npm test
```

To load it manually, open `chrome://extensions`, enable Developer mode, select
**Load unpacked**, and choose the `extension` directory.

Development happens through pull requests. See `CLAUDE.md` for review guidance.
