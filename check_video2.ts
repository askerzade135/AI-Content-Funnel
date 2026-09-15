import fs from 'fs';

const dbRaw = fs.readFileSync('data/store.json', 'utf-8');
const db = JSON.parse(dbRaw);

const video = db.videos.find((v: any) => v.title.includes('Masada') || v.title.includes('Great Revolt'));
if (video) {
  const scripts = db.scripts?.filter((s: any) => s.videoIds && s.videoIds.includes(video.id)) || [];
  console.log(`Scripts for this video: ${scripts.length}`);
  if (scripts.length > 0) {
      console.log(scripts.map(s => ({id: s.id, status: s.status, title: s.title})));
  }
}

