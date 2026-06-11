const Database = require('better-sqlite3');
const db = new Database('./dev.db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tablas con datos:');
for (const {name} of tables) {
  const count = db.prepare('SELECT COUNT(*) as c FROM "' + name + '"').get();
  if (count.c > 0) console.log('  ' + name + ': ' + count.c + ' filas');
}
db.close();
