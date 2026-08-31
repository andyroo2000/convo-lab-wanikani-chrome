# ConvoLab Study Tracker Privacy Policy

Effective August 31, 2026

ConvoLab Study Tracker records active study time on supported WaniKani review
pages and Satori Reader article pages and syncs completed sessions to the
user's ConvoLab account.

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

The extension does not read, store, or transmit WaniKani answers, Satori Reader
article content, form values, or credentials for either service. It does not
monitor pages outside the WaniKani, Satori Reader, and ConvoLab origins declared
in its manifest.

## How data is used

Data is used only to authenticate the user's ConvoLab account, measure active
study time, synchronize completed study sessions, display synchronization
status, and prevent duplicate session uploads.

The extension does not sell user data, use it for advertising or credit
decisions, or transfer it for purposes unrelated to its single study-tracking
function.

## Storage and retention

The access token, basic account information, active-session state, and any
sessions waiting to sync are stored in Chrome's local extension storage. The
token and account information are removed when the user signs out. Chrome
removes extension-local data when the extension is uninstalled.

Successfully synchronized study sessions are retained in the user's ConvoLab
account. For privacy questions or requests concerning ConvoLab account data,
use the developer contact information on the extension's Chrome Web Store
listing.

## Changes

Material changes to this policy will be published in this repository with an
updated effective date.
