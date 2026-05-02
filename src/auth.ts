import admin from 'firebase-admin';

let initialized = false;

function initializeFirebaseAdmin() {
  if (initialized) return;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // Fly secrets preserve real newlines, but \n-escaped values are common in
  // .env files. Normalize both shapes.
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Firebase Admin credentials missing. Set FIREBASE_PROJECT_ID, ' +
        'FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.'
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });

  initialized = true;
  console.log('[auth] firebase admin initialized');
}

export interface AuthResult {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
}

/**
 * Verifies a Firebase ID token sent by the client.
 * Throws if the token is missing, expired, or forged.
 */
export async function verifyIdToken(token: string): Promise<AuthResult> {
  initializeFirebaseAdmin();

  const decoded = await admin.auth().verifyIdToken(token);
  return {
    uid: decoded.uid,
    email: decoded.email,
    name: decoded.name,
    picture: decoded.picture,
  };
}
