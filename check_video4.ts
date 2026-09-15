import fs from 'fs';

const dbRaw = fs.readFileSync('data/store.json', 'utf-8');
const db = JSON.parse(dbRaw);

const video = db.videos.find((v: any) => v.title.includes('Masada') || v.title.includes('Great Revolt'));
if (video) {
  console.log("geminiResult:", video.geminiResult);
  console.log("isPassed:", video.isPassed);
  console.log("rejectionCategory:", video.rejectionCategory);
  console.log("filterReason:", video.filterReason);
  console.log("isReviewed:", video.isReviewed);
}

