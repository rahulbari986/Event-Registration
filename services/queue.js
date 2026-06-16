const fs = require('fs');
const path = require('path');
const cardGenerator = require('./cardGenerator');
const emailService = require('./emailService');
const storageManager = require('./storage');

let workerInterval = null;
let isProcessing = false;

/**
 * Enqueues a job in the queue
 * @param {Object} db - SQLite DB instance
 * @param {number} registrationId - ID of the registrant
 */
async function enqueueJob(db, registrationId) {
  await db.run(
    'INSERT INTO jobs (registration_id, status, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
    [registrationId, 'queued']
  );
  console.log(`Enqueued card generation job for registrant ID: ${registrationId}`);
}

/**
 * Main worker tick to process one queued job at a time
 * @param {Object} db - SQLite DB instance
 */
async function processNextJob(db) {
  if (isProcessing) return;
  isProcessing = true;

  try {
    // 1. Fetch oldest queued job
    const job = await db.get(
      "SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1"
    );

    if (!job) {
      isProcessing = false;
      return;
    }

    console.log(`[Queue Worker] Processing job ID: ${job.id} for registrant: ${job.registration_id}`);

    // 2. Lock job
    await db.run(
      "UPDATE jobs SET status = 'processing' WHERE id = ?",
      [job.id]
    );

    // 3. Fetch registrant details
    const registrant = await db.get(
      "SELECT * FROM registrations WHERE id = ?",
      [job.registration_id]
    );

    if (!registrant) {
      throw new Error(`Registrant with ID ${job.registration_id} not found.`);
    }

    // Check if registrant is already fully processed (both card generated and email sent)
    if (registrant.card_status === 'generated' && registrant.email_status === 'sent') {
      console.log(`[Queue Worker] Registrant ${registrant.id} is already fully processed. Marking job as completed.`);
      await db.run(
        "UPDATE jobs SET status = 'completed', processed_at = CURRENT_TIMESTAMP WHERE id = ?",
        [job.id]
      );
      isProcessing = false;
      return;
    }

    // 4. Update registrant card & email status to indicate processing (if not already generated/sent)
    await db.run(
      `UPDATE registrations 
       SET card_status = CASE WHEN card_status = 'generated' THEN 'generated' ELSE 'processing' END, 
           email_status = CASE WHEN email_status = 'sent' THEN 'sent' ELSE 'processing' END, 
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [registrant.id]
    );

    let cardUrl = registrant.card_path;
    const cardFilename = `${registrant.id}.png`;
    const isVercel = process.env.VERCEL === '1' || !!process.env.NOW_REGION;
    const cardsDir = isVercel ? '/tmp/generated-cards' : path.join(process.cwd(), 'generated-cards');
    const cardFullPath = path.join(cardsDir, cardFilename);

    // 5. Generate Card if not already done
    if (registrant.card_status !== 'generated') {
      console.log(`[Queue Worker] Generating card for ${registrant.name}...`);
      const cardBuffer = await cardGenerator.generateCard(registrant);
      
      // Save locally (cache) and upload to cloud (Supabase)
      cardUrl = await storageManager.uploadCard(cardBuffer, cardFilename);

      // Update Registrations card path and card status
      await db.run(
        "UPDATE registrations SET card_path = ?, card_status = 'generated', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [cardUrl, registrant.id]
      );
    } else {
      console.log(`[Queue Worker] Card already generated for registrant ${registrant.id}. Skipping generation.`);
    }

    // 6. Send Email with Attachment if not already sent
    if (registrant.email_status !== 'sent') {
      console.log(`[Queue Worker] Sending email to ${registrant.email}...`);
      try {
        await emailService.sendConfirmationEmail(registrant, cardFullPath);
        
        // Update email status
        await db.run(
          "UPDATE registrations SET email_status = 'sent', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          [registrant.id]
        );
      } catch (mailErr) {
        console.error(`[Queue Worker] Email failed for registrant ID ${registrant.id}:`, mailErr);
        await db.run(
          "UPDATE registrations SET email_status = CASE WHEN email_status = 'sent' THEN 'sent' ELSE 'failed' END, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          [registrant.id]
        );
        throw new Error(`Email delivery failed: ${mailErr.message}`);
      }
    } else {
      console.log(`[Queue Worker] Email already sent to ${registrant.email}. Skipping email dispatch.`);
    }

    // 7. Complete Job
    await db.run(
      "UPDATE jobs SET status = 'completed', processed_at = CURRENT_TIMESTAMP WHERE id = ?",
      [job.id]
    );
    console.log(`[Queue Worker] Successfully processed job ID: ${job.id}`);

  } catch (err) {
    console.error(`[Queue Worker] Error in job execution:`, err);
    
    // Attempt to fail job gracefully
    try {
      // Find what job we were working on
      const currentProcessingJob = await db.get(
        "SELECT * FROM jobs WHERE status = 'processing' LIMIT 1"
      );

      if (currentProcessingJob) {
        await db.run(
          "UPDATE jobs SET status = 'failed', error_message = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?",
          [err.message, currentProcessingJob.id]
        );
        
        // Also update registrant card/email status if they are stuck in processing
        await db.run(
          `UPDATE registrations 
           SET card_status = CASE WHEN card_status = 'generated' THEN 'generated' WHEN card_status = 'processing' THEN 'failed' ELSE card_status END,
               email_status = CASE WHEN email_status = 'sent' THEN 'sent' WHEN email_status = 'processing' THEN 'failed' ELSE email_status END,
               updated_at = CURRENT_TIMESTAMP 
           WHERE id = ?`,
          [currentProcessingJob.registration_id]
        );
      }
    } catch (dbErr) {
      console.error('[Queue Worker] Failed to update job status to FAILED in database:', dbErr);
    }
  } finally {
    isProcessing = false;
  }
}

/**
 * Starts the background worker interval
 * @param {Object} db - SQLite DB instance
 * @param {number} intervalMs - Polling interval in ms (default 3000ms)
 */
function startWorker(db, intervalMs = 3000) {
  if (workerInterval) return;
  
  console.log(`[Queue Worker] Starting background worker with interval: ${intervalMs}ms`);
  workerInterval = setInterval(() => {
    processNextJob(db).catch(err => {
      console.error('[Queue Worker] Uncaught worker error:', err);
    });
  }, intervalMs);
}

/**
 * Processes a job synchronously in one database transaction/update.
 * Optimizes performance by reducing DB roundtrips on Vercel.
 */
async function processSynchronously(db, registrantId) {
  try {
    const registrant = await db.get("SELECT * FROM registrations WHERE id = ?", [registrantId]);
    if (!registrant) {
      throw new Error(`Registrant with ID ${registrantId} not found.`);
    }

    console.log(`[Sync Processor] Generating card for ${registrant.name}...`);
    const cardBuffer = await cardGenerator.generateCard(registrant);

    const cardFilename = `${registrant.id}.png`;
    const cardUrl = await storageManager.uploadCard(cardBuffer, cardFilename);

    console.log(`[Sync Processor] Sending email to ${registrant.email}...`);
    let emailStatus = 'sent';
    
    const isVercel = process.env.VERCEL === '1' || !!process.env.NOW_REGION;
    const cardsDir = isVercel ? '/tmp/generated-cards' : path.join(process.cwd(), 'generated-cards');
    const cardFullPath = path.join(cardsDir, cardFilename);

    try {
      await emailService.sendConfirmationEmail(registrant, cardFullPath);
    } catch (mailErr) {
      console.error(`[Sync Processor] Email failed for registrant ID ${registrant.id}:`, mailErr);
      emailStatus = 'failed';
    }

    // Single query database update - prevent overwriting 'sent' status with 'failed'
    await db.run(
      `UPDATE registrations 
       SET card_path = ?, card_status = 'generated', 
           email_status = CASE WHEN email_status = 'sent' THEN 'sent' ELSE ? END, 
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [cardUrl, emailStatus, registrant.id]
    );

    console.log(`[Sync Processor] Successfully processed registrant ID: ${registrant.id}`);
  } catch (err) {
    console.error(`[Sync Processor] Error processing registrant:`, err);
    try {
      await db.run(
        `UPDATE registrations 
         SET card_status = CASE WHEN card_status = 'generated' THEN 'generated' ELSE 'failed' END, 
             email_status = CASE WHEN email_status = 'sent' THEN 'sent' ELSE 'failed' END, 
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [registrantId]
      );
    } catch (dbErr) {
      console.error('[Sync Processor] Failed to set status to FAILED:', dbErr);
    }
  }
}

/**
 * Stops the background worker
 */
function stopWorker() {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    console.log('[Queue Worker] Background worker stopped.');
  }
}

module.exports = {
  enqueueJob,
  startWorker,
  stopWorker,
  processNextJob,
  processSynchronously
};
