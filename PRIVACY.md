# Zapp Privacy Policy

Last updated: 27 November 2026

Zapp is a bug-report tool. The Zapp browser extension records a browser tab and sends the recording, with diagnostic logs, to a Zapp server. This policy explains what the extension collects and where it goes.

## Who runs the server

Zapp is self-hostable. The extension sends data only to the Zapp server address **you enter** in the extension. The extension's developer does not operate that server and receives none of your data. Whoever runs the server you connect to is responsible for how it is stored; ask them for their policy.

## What the extension collects

Only when you start a capture (screenshot or recording) on a tab:

- **Screen content** of what you choose to capture: a screenshot of the tab, or a video of the tab, a window or your screen if you record. Anything visible in the shared area is recorded.
- **Console output** of that tab (logs, warnings, errors).
- **Network activity** of that tab: request URLs, methods, status codes, timings and headers/bodies where available. Values that look like credentials (authorization, cookie, password, token, secret, API key) are redacted before upload.
- **Page details**: the tab's URL and title, and basic environment information such as browser and screen size.
- **Your actions** on the page during the recording (for example clicks and navigation), used to build the report timeline.

The extension does not capture anything in the background. Nothing is collected unless you start a capture, and capture is limited to the tab you choose.

## What the extension stores on your device

- Your Zapp **server address** and **sign-in session token**, in the browser's extension storage, so you stay signed in. Signing out removes them.
- **Draft captures** in the browser's local database until you upload or discard them.

## What is sent, and when

A capture is sent to your Zapp server only after you review it and press **Create**. You sign in on your Zapp website, never inside the extension, so the extension never sees your password. After you sign in, the website gives the extension a session token. The extension talks to no server other than the one you configure.

## What we do not do

- No selling or sharing of data with third parties.
- No advertising, analytics or tracking inside the extension.
- No use of data for credit or lending decisions.
- No remote code: all extension code ships inside the package.

## Permissions

| Permission | Why |
|---|---|
| `tabCapture`, `offscreen` | Record the tab you choose |
| `desktopCapture` | Show Chrome's share dialog when you record the desktop, so you can share a tab, a window or the screen |
| `debugger` | Read console and network activity of the captured tab |
| `activeTab`, `scripting`, `tabs` | Show the in-page panel and read the current tab's URL and title |
| `storage` | Remember your server, session and drafts |
| Optional host access | Granted per server address, so the extension can reach the Zapp server you configure |

## Deleting your data

Drafts and sign-in data can be removed by discarding the draft, signing out, or uninstalling the extension. Reports already uploaded live on your Zapp server and are deleted there, by you or the server's administrator.

## Changes

Changes to this policy are published in this file with a new date.

## Contact

Open an issue at https://github.com/dimsmaul/zapp/issues.
