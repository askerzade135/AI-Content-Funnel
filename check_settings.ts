import fs from 'fs';

const dbRaw = fs.readFileSync('data/store.json', 'utf-8');
const db = JSON.parse(dbRaw);

console.log("Settings:");
console.log(db.settings.autoProcessMode);

