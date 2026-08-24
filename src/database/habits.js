const db = require('./db');

function runAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) return reject(err);
            resolve(this);
        });
    });
}

function getAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

async function getHabitStatus(userId, habitName) {
    const row = await getAsync(`SELECT * FROM habits WHERE user_id = ? AND name LIKE ?`, [userId, `%${habitName}%`]);
    if (!row) {
        return { error: `Habit '${habitName}' not found.` };
    }
    return row;
}

async function logHabit(userId, habitName, addedCount) {
    let habit = await getAsync(`SELECT * FROM habits WHERE user_id = ? AND name LIKE ?`, [userId, `%${habitName}%`]);
    
    // Auto-create habit if not found
    if (!habit) {
        // Set default target to 100 for now. This could be customized later.
        await runAsync(`INSERT INTO habits (user_id, name, target_count) VALUES (?, ?, ?)`, [userId, habitName, 100]);
        habit = await getAsync(`SELECT * FROM habits WHERE user_id = ? AND name = ?`, [userId, habitName]);
    }

    const newCount = habit.current_count + addedCount;
    await runAsync(`UPDATE habits SET current_count = ? WHERE id = ?`, [newCount, habit.id]);
    await runAsync(`INSERT INTO habit_logs (habit_id, user_id) VALUES (?, ?)`, [habit.id, userId]);

    // Check if milestone target is reached
    const targetReached = newCount >= habit.target_count && habit.current_count < habit.target_count;
    
    return {
        habit_name: habit.name,
        previous_count: habit.current_count,
        new_count: newCount,
        target_count: habit.target_count,
        target_reached: targetReached
    };
}

async function setHabitTarget(userId, habitName, targetCount) {
    let habit = await getAsync(`SELECT * FROM habits WHERE user_id = ? AND name LIKE ?`, [userId, `%${habitName}%`]);
    if (!habit) {
        await runAsync(`INSERT INTO habits (user_id, name, target_count) VALUES (?, ?, ?)`, [userId, habitName, targetCount]);
        return { success: true, message: `Created new habit '${habitName}' with target ${targetCount}.` };
    } else {
        await runAsync(`UPDATE habits SET target_count = ? WHERE id = ?`, [targetCount, habit.id]);
        return { success: true, message: `Updated target for '${habit.name}' from ${habit.target_count} to ${targetCount}.` };
    }
}

module.exports = { getHabitStatus, logHabit, setHabitTarget };
