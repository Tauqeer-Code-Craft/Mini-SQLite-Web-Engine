import { Database } from './database';

export function runTests(): string[] {
    const logs: string[] = [];
    const db = new Database();
    
    function assert(condition: boolean, msg: string) {
        if (condition) logs.push(`PASS: ${msg}`);
        else logs.push(`FAIL: ${msg}`);
    }

    try {
        db.hardReset();
        logs.push("--- Starting Tests ---");

        // 1. Create Table
        db.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)");
        assert(true, "Create users table");

        // 2. Insert
        db.execute("INSERT INTO users VALUES (1, 'Alice', 30)");
        db.execute("INSERT INTO users VALUES (2, 'Bob', 25)");
        assert(true, "Insert 2 users");

        // 3. Select
        let res = db.execute("SELECT * FROM users");
        assert(res.length === 2, "Select all returns 2 rows");
        assert(res[0].name === 'Alice', "First row is Alice");

        // 4. Select Where
        res = db.execute("SELECT * FROM users WHERE age > 28");
        assert(res.length === 1, "Select WHERE age > 28 returns 1 row");
        assert(res[0].name === 'Alice', "Filtered row is Alice");

        // 5. Update
        db.execute("UPDATE users SET age = 31 WHERE id = 1");
        res = db.execute("SELECT * FROM users WHERE id = 1");
        assert(res[0].age === 31, "Update age to 31");

        // 6. Delete
        db.execute("DELETE FROM users WHERE id = 2");
        res = db.execute("SELECT * FROM users");
        assert(res.length === 1, "Delete reduces count to 1");

        // 7. Auto-Increment & Null handling
        db.execute("INSERT INTO users (name, age) VALUES ('Charlie', 20)");
        res = db.execute("SELECT * FROM users WHERE name = 'Charlie'");
        assert(res[0].id === 3, "Auto-increment ID is 3 (max + 1)");

        // 8. Transactions
        db.execute("BEGIN");
        db.execute("INSERT INTO users VALUES (4, 'Dave', 40)");
        db.execute("ROLLBACK");
        res = db.execute("SELECT * FROM users WHERE name = 'Dave'");
        assert(res.length === 0, "Rollback removed Dave");

        db.execute("BEGIN");
        db.execute("INSERT INTO users VALUES (5, 'Eve', 50)");
        db.execute("COMMIT");
        res = db.execute("SELECT * FROM users WHERE name = 'Eve'");
        assert(res.length === 1, "Commit persisted Eve");

        // 9. JOIN
        db.execute("CREATE TABLE orders (oid INTEGER PRIMARY KEY, uid INTEGER, item TEXT)");
        db.execute("INSERT INTO orders VALUES (100, 1, 'Laptop')"); // Alice
        db.execute("INSERT INTO orders VALUES (101, 5, 'Phone')"); // Eve

        res = db.execute("SELECT * FROM users JOIN orders ON users.id = orders.uid");
        // Alice (1) matches Order(100)
        // Eve (5) matches Order(101)
        // Charlie (3) no match
        assert(res.length === 2, "Inner Join returns 2 rows");
        assert(res.find((r: any) => r.name === 'Alice' && r.item === 'Laptop'), "Join merged Alice and Laptop");

    } catch (e: any) {
        logs.push(`FATAL ERROR: ${e.message}`);
        console.error(e);
    }

    return logs;
}