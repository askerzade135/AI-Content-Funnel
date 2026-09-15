import fs from 'fs';

const dbRaw = fs.readFileSync('data/store.json', 'utf-8');
const db = JSON.parse(dbRaw);

const video = db.videos.find((v: any) => v.title.includes('Masada') || v.title.includes('Great Revolt'));
if (video) {
  console.log("Found Video:");
  console.log(JSON.stringify({
    id: video.id,
    title: video.title,
    status: video.status,
    createdAt: video.createdAt,
    updatedAt: video.updatedAt,
    error: video.error,
    duration: video.duration,
  }, null, 2));
} else {
  console.log("Video not found in DB.");
}

const processing = db.videos.filter((v: any) => ['processing_gemini', 'queued'].includes(v.status));
console.log(`\nCurrently in queue/processing: ${processing.length}`);
for (const p of processing) {
    console.log(`- ${p.title} (Status: ${p.status}, Time: ${p.updatedAt})`);
}
