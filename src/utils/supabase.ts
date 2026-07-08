import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl     = process.env.SUPABASE_URL!;
const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
}

// We use the service role key here because this runs server-side only.
// The service role key bypasses Row Level Security — that's intentional.
// It means your backend can read/write any file regardless of who owns it.
// NEVER send this key to the frontend.
export const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const BUCKET = process.env.SUPABASE_AUDIO_BUCKET || 'voicer-audio';

// ─────────────────────────────────────────────────────────────
// STORAGE HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Generate a signed URL for temporary playback access to a private file.
 * expiresIn: seconds the URL stays valid (default 1 hour)
 *
 * The frontend calls GET /submissions/:id, your API gets the storagePath
 * from the DB, calls this, and returns the signed URL.
 * The file itself never passes through your server.
 */
export const getSignedUrl = async (storagePath: string, expiresIn = 3600): Promise<string> => {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresIn);

  if (error || !data?.signedUrl) {
    throw new Error(`Failed to generate signed URL: ${error?.message}`);
  }

  return data.signedUrl;
};

/**
 * Delete a file from storage when a submission is hard-deleted.
 * storagePath example: "audio/550e8400-e29b-41d4-a716-446655440000.webm"
 */
export const deleteFile = async (storagePath: string): Promise<void> => {
  const { error } = await supabase.storage
    .from(BUCKET)
    .remove([storagePath]);

  if (error) throw new Error(`Failed to delete file: ${error.message}`);
};

/**
 * Generate a signed upload URL — optional server-side approach.
 *
 * Two ways to handle audio uploads:
 *
 * Option A (recommended): Frontend uses the Supabase JS SDK directly with the ANON key.
 *   The frontend calls supabase.storage.from('voicer-audio').upload(path, file)
 *   using the anon key (which you give to the frontend). Then it sends the path to your API.
 *   Your API never sees the file. Simple, fast.
 *
 * Option B (this function): Your API generates a signed upload URL with an expiry,
 *   sends it to the frontend, and the frontend POSTs the file directly to that URL.
 *   Use this if you want to control the file path server-side before upload happens.
 */
export const getSignedUploadUrl = async (
  storagePath: string
): Promise<string> => {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error || !data?.signedUrl) {
    throw new Error(`Failed to generate upload URL: ${error?.message}`);
  }

  return data.signedUrl;
};

/**
 * Upload a buffer directly from the server — use this for exports only
 * (CSV/JSON/ZIP files that your server generates, not audio from users).
 */
export const uploadBuffer = async (
  path: string,
  buffer: Buffer,
  contentType: string
): Promise<{ path: string }> => {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType, upsert: true });

  if (error || !data) {
    throw new Error(`Failed to upload file: ${error?.message}`);
  }
``
  return { path: data.path };
};

export { BUCKET };
