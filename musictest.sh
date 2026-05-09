#!/bin/bash
set -e

if [ -z "$SPOTIFY_CLIENT_ID" ] || [ -z "$SPOTIFY_CLIENT_SECRET" ]; then
  echo "Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET first"
  exit 1
fi

TOKEN=$(curl -s -X POST https://accounts.spotify.com/api/token \
  -H "Authorization: Basic $(echo -n "$SPOTIFY_CLIENT_ID:$SPOTIFY_CLIENT_SECRET" | base64 -w 0)" \
  -d "grant_type=client_credentials" \
  | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "Failed to get token."
  exit 1
fi

echo "Got token: ${TOKEN:0:20}..."
echo

echo "=== Test 1: q=pop ==="
curl -s -G "https://api.spotify.com/v1/search" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "q=pop" \
  --data-urlencode "type=track" \
  --data-urlencode "limit=5" | head -c 300
echo; echo

echo "=== Test 2: q=pop year:2020 ==="
curl -s -G "https://api.spotify.com/v1/search" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "q=pop year:2020" \
  --data-urlencode "type=track" \
  --data-urlencode "limit=5" | head -c 300
echo; echo

echo "=== Test 3: q=year:2020 ==="
curl -s -G "https://api.spotify.com/v1/search" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "q=year:2020" \
  --data-urlencode "type=track" \
  --data-urlencode "limit=5" | head -c 300
echo; echo

echo '=== Test 4: q=artist:"Taylor Swift" ==='
curl -s -G "https://api.spotify.com/v1/search" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'q=artist:"Taylor Swift"' \
  --data-urlencode "type=track" \
  --data-urlencode "limit=5" | head -c 300
echo; echo
