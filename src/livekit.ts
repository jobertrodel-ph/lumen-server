import { AccessToken } from 'livekit-server-sdk';
import { Request, Response } from 'express';
import { verifyIdToken } from './auth';

const LIVEKIT_ROOM = 'lumen-world';

/**
 * Issues a LiveKit access token for the authenticated user. The same
 * Firebase ID token used to enter the game world authorizes voice access.
 *
 * Token lifetime is intentionally short (1 hour). Client refreshes by
 * re-fetching when needed.
 */
export async function handleLivekitToken(req: Request, res: Response): Promise<void> {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    res.status(500).json({ error: 'voice not configured' });
    return;
  }

  const auth = (req.body?.token as string) ?? '';
  if (!auth) {
    res.status(400).json({ error: 'missing token' });
    return;
  }

  let identity: string;
  let displayName: string;
  try {
    const decoded = await verifyIdToken(auth);
    identity = decoded.uid;
    displayName = decoded.name?.trim() || 'Visitor';
  } catch {
    res.status(401).json({ error: 'invalid token' });
    return;
  }

  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    name: displayName,
    ttl: '1h',
  });

  at.addGrant({
    roomJoin: true,
    room: LIVEKIT_ROOM,
    canPublish: true,
    canSubscribe: true,
  });

  const jwt = await at.toJwt();
  res.json({ token: jwt, room: LIVEKIT_ROOM, url: process.env.LIVEKIT_URL });
}
