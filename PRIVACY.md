# ConvoLab Study Tracker Privacy Policy

Effective September 10, 2026

ConvoLab Study Tracker records active study time on supported WaniKani review
pages and Satori Reader article pages and syncs completed sessions to the
user's ConvoLab account.

On Netflix and YouTube, a user can explicitly enable dual subtitles and a
temporary rolling audio buffer, then choose a subtitle to create a ConvoLab
audio-recognition card.

## Data the extension processes

- **ConvoLab account information.** When a user signs in, the extension sends
  the email address and password they enter directly to `https://convo-lab.com`
  over HTTPS to authenticate the account. The password is not retained by the
  extension. The returned access token and basic account information are stored
  locally in Chrome so the extension can submit study sessions.
- **Study activity.** The extension records the supported service, session
  start and end times, duration, and a random session identifier. Completed
  sessions are sent to the user's ConvoLab account over HTTPS.
- **Local browser context.** To determine whether study is active, the extension
  locally processes the URL of the current supported page, page visibility,
  window and tab focus, Chrome's active/idle state, and the timestamps of user
  interactions. Exact page URLs and interaction events are not included in the
  study sessions sent to ConvoLab.
- **Video subtitles.** After dialogue capture is enabled for a Netflix or
  YouTube tab, the extension reads available Japanese and English subtitle
  tracks to display them together. Subtitle text is processed locally until the
  user chooses to create a card. Only the selected Japanese dialogue, English
  meaning, title, and source URL are then sent to ConvoLab.
- **Temporary tab audio.** Dialogue capture keeps up to three minutes of the
  enabled tab's audio in memory so the user can adjust a selected clip. The
  rolling buffer is not written to Chrome storage. Only the trimmed clip is
  uploaded, and only after the user selects **Create at front of queue**. The
  buffer is discarded when capture stops, the tab closes, or the user signs
  out.

The extension does not read, store, or transmit WaniKani answers, Satori Reader
article content, unrelated Netflix or YouTube page content, form values, or
credentials for those services. It does not monitor pages outside the
WaniKani, Satori Reader, Netflix, YouTube, and ConvoLab origins declared in its
manifest.

## How data is used

Data is used only to authenticate the user's ConvoLab account, measure active
study time, synchronize completed study sessions, display dual subtitles,
create user-requested audio-recognition cards, display synchronization status,
and prevent duplicate session uploads.

The extension does not sell user data, use it for advertising or credit
decisions, or transfer it for purposes unrelated to its single study-tracking
function.

## Storage and retention

The access token, basic account information, active-session state, sessions
waiting to sync, a bounded record of sessions that could not be synced, and the
most recent synchronization or tracking error may be stored in Chrome's local
extension storage. The token and basic account information are removed when the
user signs out. Per-account queued session data remains locally so a valid
pending session is not stranded by sign-out; successfully synchronized entries
are removed from the queue. Failed entries and any remaining extension-local
data are removed when the extension is uninstalled.

Successfully synchronized study sessions are retained in the user's ConvoLab
account. For privacy questions or requests concerning ConvoLab account data,
use the developer contact information on the extension's Chrome Web Store
listing.

Selected subtitle text, source metadata, and trimmed audio clips used to create
cards are retained with those cards in the user's ConvoLab account until the
user deletes them.

## Changes

Material changes to this policy will be published in this repository with an
updated effective date.
