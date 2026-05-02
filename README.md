# Lumen — game server

Colyseus-based multiplayer server for Lumen. Runs on Fly.io. Verifies Firebase
ID tokens so only signed-in Google users can join.

## What it does

- Defines a `world` room where all players connect.
- Validates each connection's Firebase ID token via the Firebase Admin SDK.
- Holds authoritative state: who's online, where everyone is.
- Broadcasts state diffs to all clients automatically (Colyseus schema).
- Rate-limits movement so a hostile client can't teleport across the map.

## Stack

- **Colyseus 0.16** — room-based realtime framework
- **Firebase Admin SDK** — verifies ID tokens issued by your Firebase Auth
- **Express** — only used for the `/health` endpoint Fly's load balancer pings
- **TypeScript** + **tsx** for dev, **tsc** for prod build
- **Docker** + **Fly.io** for deploy

## Setup (one-time)

### 1. Get a Firebase Admin service account

You'll do this in your browser. Don't commit the file anywhere.

1. <https://console.firebase.google.com> → your project
2. Gear icon → **Project settings** → **Service accounts** tab
3. Click **Generate new private key** → downloads a JSON file

You only need three values from this file:

- `project_id`
- `client_email`
- `private_key`

Once you've copied them in step 3 below, **delete the JSON file**. It's a long-lived credential with full project admin access — treat it like a password.

### 2. Install Fly CLI in Firebase Studio

In your **server workspace** terminal:

```bash
curl -L https://fly.io/install.sh | sh
export FLYCTL_INSTALL="/home/user/.fly"
export PATH="$FLYCTL_INSTALL/bin:$PATH"
echo 'export FLYCTL_INSTALL="/home/user/.fly"' >> ~/.bashrc
echo 'export PATH="$FLYCTL_INSTALL/bin:$PATH"' >> ~/.bashrc
flyctl version
```

Then sign in (or sign up):

```bash
flyctl auth signup    # or: flyctl auth login
```

A device-code URL prints. Open it in another tab, paste the code, done.

### 3. Launch the app on Fly

From the server workspace:

```bash
flyctl launch --no-deploy
```

Answer:

- Existing `fly.toml`? → **Yes, copy it**
- App name → pick something globally unique (e.g. `lumen-yourname`); update `app = ` in `fly.toml` to match
- Region → confirm `sin` (Singapore) or pick what's closest to your users
- Postgres / Redis / Tigris? → **No** to all three
- Deploy now? → **No**

### 4. Set the Firebase Admin secrets

Now feed the three values into Fly:

```bash
flyctl secrets set \
  FIREBASE_PROJECT_ID="your-project-id" \
  FIREBASE_CLIENT_EMAIL="firebase-adminsdk-xxx@your-project.iam.gserviceaccount.com"
```

The private key is trickier because it contains real newlines. Easiest way:

```bash
flyctl secrets set FIREBASE_PRIVATE_KEY="$(cat <<'EOF'
-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQ...
...full key from JSON...
-----END PRIVATE KEY-----
EOF
)"
```

Paste the full multi-line private key between `EOF` markers. Press Enter, then type `EOF` on its own line, then Enter.

Verify they were set (only names show, never values):

```bash
flyctl secrets list
```

### 5. Deploy

```bash
flyctl deploy
```

First deploy takes 2-4 minutes (downloads base images, builds, uploads). Subsequent deploys are usually under a minute thanks to Docker layer caching.

Once it succeeds you'll see:

```
visit your newly deployed app at https://lumen-yourname.fly.dev/
```

Test the health endpoint in a browser:

```
https://lumen-yourname.fly.dev/health
```

Should return `{"status":"ok","uptime":...}`.

The Colyseus matchmaking endpoint is at:

```
wss://lumen-yourname.fly.dev/
```

You'll point your client at this URL in the next phase.

## Daily workflow

Edit code → commit & push → `flyctl deploy`. That's it.

```bash
git add .
git commit -m "Tweak movement validation"
git push
flyctl deploy
```

Logs in real time:

```bash
flyctl logs
```

SSH into the running machine if something goes sideways:

```bash
flyctl ssh console
```

## Troubleshooting

- **`Firebase Admin credentials missing`** in logs — check `flyctl secrets list` shows all three. Re-set any that are missing.
- **Auth failures even with a real token** — the most common cause is the private key got mangled during paste. Re-set it using the heredoc method above. The key MUST contain real newlines, not `\n` escapes.
- **Machine keeps restarting** — `flyctl logs` will tell you why. If it's an OOM kill, bump memory in `fly.toml` from 256 to 512 MB.
- **Cold-start delays** — make sure `auto_stop_machines = "off"` and `min_machines_running = 1`. WebSocket apps are bad candidates for scale-to-zero.
