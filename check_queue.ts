import fs from 'fs';

const dbRaw = fs.readFileSync('data/store.json', 'utf-8');
const db = JSON.parse(dbRaw);

console.log("Queue length: ", db.queue?.length || 0);
if (db.queue?.length > 0) {
    const qItems = db.queue.filter((q: any) => q.videoId === 'xwGJYIWhZDM');
    console.log("Queue items for this video: ", qItems);
}

