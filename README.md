<div align="center">

# OffMic

**A private voice channel for your team, during your Teams meetings.**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4f6bed.svg)](https://developer.chrome.com/docs/extensions/develop/migrate)
![Version](https://img.shields.io/badge/version-0.1.0-green.svg)

</div>

---

## The problem

You are in a Teams meeting with a client. Your team needs to talk something over, right now, before answering. Today that means switching to another tool, opening a side conversation, or staying quiet and waiting.

## The solution

OffMic adds a private voice channel between your teammates, driven by one thing only: **your microphone state in Teams**.

| Teams mic | You talk to | You hear |
| :--- | :--- | :--- |
| **Muted** | your team | your team |
| **Live** | the client | your team (on by default) |

No extra button to manage, no shortcut to memorize. You mute yourself the way you always do, and that gesture becomes the trigger. Mic muted, I talk to my team. Mic live, I talk to the client.

## How it works

OffMic **never controls** the Teams microphone. It watches it.

1. **Detect.** A content script observes the Teams web mic button and derives the muted or live state.
2. **Capture.** An offscreen document opens the microphone alongside Teams.
3. **Decide.** The outgoing track is enabled only when the connection is up **and** the Teams mic is muted.

Voice travels over **peer-to-peer WebRTC**, in a mesh. It never goes through a server. The signaling server only introduces peers to each other, just long enough to exchange SDP descriptions and ICE candidates. Once the peers are connected, nothing flows through it anymore.

```
  Alice ◄──────── P2P audio ────────► Bob
     ▲                                 ▲
     └───── SDP / ICE ─────┬───────────┘
                           │
                 signaling server
                 (never any media)
```

## Before you install

- **Headphones are mandatory.** If your team's voice comes out of your speakers while your Teams mic is live, the client will hear it. No software can fix that.
- **Teams web only.** A browser extension has no reach into the Teams desktop client.
- **Detection depends on the Teams DOM.** Microsoft can change its UI and break it. English and French interfaces are recognized, with a polling fallback.
- **Chrome for now.** The offscreen document is Chrome specific. A Firefox port is planned.
- **Up to 5 or 6 people.** Beyond that, a peer-to-peer mesh costs too much upstream bandwidth.

## Usage

1. Join your meeting on Teams web.
2. Open the OffMic popup, enter a room name shared with your team, and your own name.
3. Click **Connect**. The ring in the toolbar icon turns green.
4. Mute your Teams mic to talk to your team, unmute it to talk to the client.

The room name is the only shared secret. Pick one nobody will guess.

The gear icon opens the settings: language, appearance, which microphone and audio output OffMic uses, and the two volumes (your mic, and the team you hear). Everything applies live, without dropping the connection.

Each teammate in the list also carries its own mic toggle and volume slider, so one loud voice can be turned down instead of turning everyone else up. Those are per session: someone who leaves and comes back is back at full volume.

## Installation, if you want to host your own relay server

None of this is needed to use OffMic. The extension already points at a hosted relay, so installing it and joining a room is all it takes. Follow the steps below only if you would rather run the signaling for your team yourself.

### Requirements

Node.js 18 or newer, and Chrome.

### 1. Clone

```bash
git clone https://github.com/Bysimeit/OffMic.git
cd OffMic
```

There is no build step. A fresh clone already points at the public relay `wss://offmic.xeron.be`, so you can skip straight to the next section.

To use your own server instead, open `extension/config.js` and change the one line in it:

```js
const OFFMIC_CONFIG = {
  serverUrl: "wss://relay.example.com"
};
```

That value is only the **default** shown on a fresh Chrome profile. The address is editable in the popup at any time, and what you type there is remembered, so trying another relay never requires touching a file.

### 2. Load the extension

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked**, then pick the `extension/` folder
4. Open the popup and click the microphone permission link

Step 4 matters: an offscreen document has no UI, so it cannot show a permission prompt. You have to grant access once from the dedicated page, otherwise capture fails with `NotAllowedError`.

### 3. Run the signaling server

```bash
cd server
npm install
npm start
```

The server listens on port **48085**, configurable through the `PORT` environment variable.

A `Dockerfile` is included in `server/` if you would rather run it in a container.

## Privacy

- **No account, no sign-up, no usage tracking.**
- **Voice never passes through a server.** Media is end-to-end encrypted by WebRTC (DTLS-SRTP) and goes straight from peer to peer.
- The signaling server keeps rooms **in memory** and writes nothing to disk.
- Your settings stay in your browser's local storage.

The weak spot is not technical, it is acoustic: see the note about headphones above.

## License

Released under the **GNU Affero General Public License v3.0**. See [LICENSE](LICENSE).
