const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

let supabase = null;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (supabaseUrl && supabaseServiceKey) {
  console.log('[Storage] Supabase credentials found. Uploads will be stored in Supabase Storage.');
  supabase = createClient(supabaseUrl, supabaseServiceKey);
} else {
  console.log('[Storage] No Supabase credentials found. Uploads will be stored locally.');
}

const verifiedBuckets = {};

/**
 * Helper to ensure a Supabase bucket exists and is public.
 */
async function ensureBucket(bucketName) {
  if (!supabase || verifiedBuckets[bucketName]) return;
  try {
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();
    if (listError) throw listError;

    const exists = buckets.some(b => b.name === bucketName);
    if (!exists) {
      console.log(`[Storage] Creating bucket "${bucketName}"...`);
      const { error: createError } = await supabase.storage.createBucket(bucketName, {
        public: true,
        fileSizeLimit: 5242880 // 5MB
      });
      if (createError) throw createError;
      console.log(`[Storage] ✓ Bucket "${bucketName}" created successfully.`);
    }
    verifiedBuckets[bucketName] = true;
  } catch (err) {
    console.warn(`[Storage] Warning verifying bucket "${bucketName}":`, err.message);
  }
}

/**
 * Uploads a file (buffer) to the appropriate store.
 * @param {string} bucketName - Name of the bucket (or local subfolder)
 * @param {Buffer} buffer - File buffer
 * @param {string} filename - Unique target filename
 * @param {string} contentType - MIME type of the file
 * @returns {Promise<string>} - Returns the URL (public HTTPS or relative path)
 */
async function uploadFile(bucketName, buffer, filename, contentType) {
  // Always write to local disk (as a cache) so local code can read it in the current session
  const isVercel = process.env.VERCEL === '1' || !!process.env.NOW_REGION;
  const localDir = isVercel
    ? path.join('/tmp', bucketName)
    : path.join(process.cwd(), bucketName);

  if (!fs.existsSync(localDir)) {
    fs.mkdirSync(localDir, { recursive: true });
  }

  const targetPath = path.join(localDir, filename);
  fs.writeFileSync(targetPath, buffer);
  console.log(`[Storage] Local cache written: ${targetPath}`);

  if (supabase) {
    await ensureBucket(bucketName);
    console.log(`[Storage] Uploading ${filename} to Supabase storage bucket: ${bucketName}...`);
    
    const { data, error } = await supabase.storage
      .from(bucketName)
      .upload(filename, buffer, {
        contentType,
        upsert: true
      });

    if (error) {
      console.error(`[Storage] Supabase upload failed for ${filename}:`, error);
      throw error;
    }

    const { data: { publicUrl } } = supabase.storage
      .from(bucketName)
      .getPublicUrl(filename);

    console.log(`[Storage] ✓ Uploaded to Supabase. Public URL: ${publicUrl}`);
    return publicUrl;
  } else {
    // Return relative URL for local serving
    return `${bucketName}/${filename}`;
  }
}

/**
 * Upload attendee registration profile photo.
 */
async function uploadPhoto(buffer, filename, contentType = 'image/jpeg') {
  return await uploadFile('uploads', buffer, filename, contentType);
}

/**
 * Upload attendee generated card image.
 */
async function uploadCard(buffer, filename, contentType = 'image/png') {
  return await uploadFile('generated-cards', buffer, filename, contentType);
}

module.exports = {
  uploadPhoto,
  uploadCard
};
