const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Database will be created in the root folder
const dbPath = path.resolve(__dirname, '../../valmorain.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('[DB] Connected to the Valmorain SQLite database.');
        
        // Initialize Tables
        db.serialize(() => {
            // Stores long-term details learned about group members
            db.run(`CREATE TABLE IF NOT EXISTS user_facts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                fact TEXT NOT NULL,
                learned_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Habit configuration and tracking
            db.run(`CREATE TABLE IF NOT EXISTS habits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                target_count INTEGER DEFAULT 1,
                current_count INTEGER DEFAULT 0,
                frequency TEXT DEFAULT 'daily', -- e.g. 'daily', 'weekly'
                reset_day TEXT, -- e.g. 'Monday' or null
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Timestamped history of completed activities
            db.run(`CREATE TABLE IF NOT EXISTS habit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                habit_id INTEGER NOT NULL,
                user_id TEXT NOT NULL,
                completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (habit_id) REFERENCES habits (id)
            )`);
            
            console.log('[DB] Database tables initialized.');
        });
    }
});

module.exports = db;
