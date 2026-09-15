import fs from 'fs';

const dbRaw = fs.readFileSync('data/store.json', 'utf-8');
const db = JSON.parse(dbRaw);

const video = db.videos.find((v: any) => v.title.includes('Masada') || v.title.includes('Great Revolt'));
if (video) {
  console.log(JSON.stringify(video, null, 2));
}

