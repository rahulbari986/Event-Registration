const fs = require('fs');
const path = require('path');
const cardGenerator = require('./cardGenerator');
const emailService = require('./emailService');

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

    // 4. Update registrant card & email status to indicate processing
    await db.run(
      "UPDATE registrations SET card_status = 'processing', email_status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [registrant.id]
    );

    // 5. Generate Card
    console.log(`[Queue Worker] Generating card for ${registrant.name}...`);
    const cardBuffer = await cardGenerator.generateCard(registrant);
    
    // Save locally
    const cardsDir = path.join(process.cwd(), 'generated-cards');
    if (!fs.existsSync(cardsDir)) {
      fs.mkdirSync(cardsDir, { recursive: true });
    }
    
    const cardFilename = `${registrant.id}.png`;
    const cardRelativePath = `generated-cards/${cardFilename}`;
    const cardFullPath = path.join(cardsDir, cardFilename);
    
    fs.writeFileSync(cardFullPath, cardBuffer);
    console.log(`[Queue Worker] Saved card to ${cardFullPath}`);

    // Update Registrations card path and card status
    await db.run(
      "UPDATE registrations SET card_path = ?, card_status = 'generated', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [cardRelativePath, registrant.id]
    );

    // 6. Send Email with Attachment
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
        "UPDATE registrations SET email_status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [registrant.id]
      );
      throw new Error(`Email delivery failed: ${mailErr.message}`);
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
           SET card_status = CASE WHEN card_status = 'processing' THEN 'failed' ELSE card_status END,
               email_status = CASE WHEN email_status = 'processing' THEN 'failed' ELSE email_status END,
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
  processNextJob
};
