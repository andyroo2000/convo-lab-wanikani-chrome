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
- opens a waveform editor with draggable handles and keyboard-editable start/end
  times, playback, and optional 25 ms fade-in and fade-out edges;
- keeps a bounded, temporary buffer of video stills and offers up to five from
  the trimmed audio span, with **No image** selected by default; and
- optionally includes the chosen screenshot on the front of the listening card.

Screenshots are sampled about once every 1.2 seconds, cropped to the video,
and kept in memory for up to three minutes (at most 16 MiB of encoded images).
Browser protection may make screenshots unavailable, particularly on Netflix.
Blank captures are skipped; audio-only cards remain available.
Netflix subtitle metadata is read only after enabling capture. If the title was
already loaded, reopen it after enabling so the extension can see its subtitle
tracks. The editor supports Tab navigation and Escape to cancel.

Creating the card submits the edited text, trimmed WAV, and optional selected
image in one multipart request to `POST /api/study/cards/capture`. Card creation,
both media attachments, and queue-front promotion commit atomically. The editor
retains a stable card ID across retries, preventing duplicates after a lost
response while the editor remains open; unsent cards are not saved across tab
closure. Stopping capture, closing the tab, navigating to another site, or
signing out discards the buffers.

See the [privacy policy](PRIVACY.md) for the complete data-handling disclosure.

## Local development

```bash
npm test
```

To load it manually, open `chrome://extensions`, enable Developer mode, select
**Load unpacked**, and choose the `extension` directory.

Development happens through pull requests. See `CLAUDE.md` for review guidance.
