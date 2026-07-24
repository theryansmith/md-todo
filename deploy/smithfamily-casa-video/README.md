# Self-hosted video on smithfamily.casa

Host a long video (past Apple's 15-minute Shared Album limit) on your own
homelab and share **one public link** that plays in iPhone Safari, Android,
and any browser — no App Store, no account, no size cap but your own disk.

```
https://video.smithfamily.casa/spring-recital/
```

## Why not just use iCloud?

Apple gives you two sharing options and neither fits a 22-minute *public* clip:

| Mechanism | Public link for anyone? | Length cap |
|---|---|---|
| **iCloud Shared Album** (public icloud.com link) | ✅ | ❌ **15 min — hard limit** |
| **iCloud Shared Photo Library** | ❌ invite-only, ≤6 Apple IDs | ✅ none |

The 15-minute cap can't be raised, and you can't embed a web URL inside the
Photos app. So for a 22-minute video that "anyone anywhere online" can watch,
self-hosting is the clean answer. (If you truly want it *in* a Shared Album,
see [`split-for-icloud.sh`](#option-b-keep-it-in-an-icloud-shared-album).)

---

## What's here

| File | Purpose |
|---|---|
| `docker-compose.yml` | Runs Caddy — a tiny web server with **automatic HTTPS** |
| `Caddyfile` | Serves `./site/` over `video.smithfamily.casa`, correct HLS MIME types |
| `transcode.sh` | ffmpeg: turns a source video into web-ready HLS + MP4 + poster + watch page |
| `split-for-icloud.sh` | Lossless split into <15-min parts (Option B) |
| `site/` | Web root Caddy serves; each video becomes `site/<slug>/` |
| `site/_player.html.template` | The watch-page template (adaptive HLS, MP4 fallback, download button) |

---

## Option A — self-host (recommended)

### 1. DNS

Add a record at your domain registrar / DNS provider pointing the subdomain at
your homelab's **public** IP:

```
video.smithfamily.casa   A     <your.public.ip.here>
# (and an AAAA record if you have IPv6)
```

### 2. Open the ports

Forward TCP **80** and **443** from your router to the machine that will run
Caddy. Port 80 is needed for the Let's Encrypt HTTP challenge; 443 serves the
site. (If your ISP blocks inbound 80/443, use Caddy's DNS challenge or put a
Cloudflare Tunnel in front — ask and I'll wire either up.)

### 3. Transcode your video

On the homelab host (needs `ffmpeg` and `docker`):

```bash
cd deploy/smithfamily-casa-video
./transcode.sh ~/Movies/recital.mov spring-recital "Maya's Spring Recital"
```

This writes `site/spring-recital/` containing the HLS ladder (1080p/720p/480p),
a downloadable MP4, a poster image, and `index.html`. A 22-min clip typically
takes a few minutes to an hour depending on CPU.

### 4. Go live

```bash
docker compose up -d
```

Caddy fetches a TLS cert automatically on first request. Your link is live:

```
https://video.smithfamily.casa/spring-recital/
```

Paste it into Messages, email, anywhere. It plays inline on iPhone (native
HLS), streams adaptively on Android/desktop, and has a **Download** button.

Add more videos anytime by re-running `transcode.sh` with a new slug — no
restart needed, Caddy serves them immediately.

---

## Option B — keep it in an iCloud Shared Album

If you'd rather it live in Photos' public Shared Album, split it under the
15-minute cap (lossless, no re-encode):

```bash
./split-for-icloud.sh ~/Movies/recital.mov 11   # two ~11-min halves
```

Import the resulting `*-part-*.mp4` files to Photos, add them to a Shared
Album, and turn on its **Public Website** link. Trade-off: it's two clips and
re-uploaded to Apple.

---

## Notes & knobs

- **Quality/size:** tune the `-crf` (MP4) and `-b:v` (HLS) values in
  `transcode.sh`. Lower CRF = better quality, bigger file.
- **hls.js** loads from a CDN for non-Safari browsers. If you want a fully
  offline/CDN-free page, vendor `hls.min.js` into `site/` and point the
  `<script src>` at it — happy to make that change.
- **Privacy:** directory browsing is off, so videos are only reachable by their
  exact link (slugs act as unguessable-ish keys). For real access control, put
  Caddy `basic_auth` in front of a slug — ask and I'll add it.
- **Storage:** HLS + MP4 roughly doubles disk use vs. a single file. Delete a
  video by removing its `site/<slug>/` folder.
