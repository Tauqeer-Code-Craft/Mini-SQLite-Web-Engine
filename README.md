# Mini-SQLite Web Engine

A fully functional, lightweight SQL database engine written in TypeScript/JavaScript. It runs entirely in the browser, using a custom **Binary B-Tree** storage engine backed by `localStorage` to simulate disk persistence.

This project demonstrates how databases work under the hood, including parsing, query execution, indexing, and binary data serialization.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)
![React](https://img.shields.io/badge/React-18-blue)

## 🚀 Features

### Core Database
*   **SQL Support**: `CREATE TABLE`, `INSERT`, `SELECT`, `UPDATE`, `DELETE`.
*   **Joins**: Supports `INNER JOIN` and `LEFT JOIN` (Nested Loop implementation).
*   **Transactions**: Atomic `BEGIN`, `COMMIT`, and `ROLLBACK` support.
*   **Where Clauses**: Filtering with `=`, `<`, `>`, `<=`, `>=`.
*   **Data Types**: Strong typing for `INTEGER` and `TEXT`.
*   **Primary Keys**: Automatic uniqueness enforcement and Auto-Increment support.

### Storage Engine
*   **B-Tree Indexing**: Every table is rooted in a B-Tree for efficient `O(log n)` lookups.
*   **Binary Persistence**: Data is serialized into raw binary buffers (`Uint8Array`) before storage, simulating a real database file format.
*   **Virtual Disk**: An abstraction layer that maps "Page IDs" to storage slots.

### Interface
*   **Interactive REPL**: A terminal-like React component to execute queries.
*   **Persistent History**: Data survives page reloads (stored in LocalStorage).
*   **Unit Tests**: Built-in test suite runnable via the `TEST` command.

---

## 🏗 Architecture Layers

The database engine is built on a layered architecture, designed to mimic standard relational databases like SQLite or PostgreSQL.

### 1. Interface Layer (`Repl.tsx`)
The entry point for the user. It accepts raw SQL strings, passes them to the database engine, and formats the results (arrays of objects) into an HTML table or status messages.

### 2. SQL Processing Layer (`parser.ts`, `database.ts`)
*   **Parser**: Uses Regex to tokenize SQL strings and convert them into a structured `ParsedCommand` object (AST).
*   **Dispatcher**: The `Database.execute()` method acts as the controller, routing commands to the appropriate logic (e.g., finding the correct table for a `SELECT` or managing `BEGIN/COMMIT` logic).

### 3. Execution Engine Layer (`table.ts`)
*   **Table Abstraction**: High-level API for data manipulation (e.g., `insert()`, `select()`).
*   **Row Serialization**: Converts JavaScript Objects (e.g., `{id: 1, name: "Alice"}`) into compact binary buffers (`Uint8Array`). It handles header length calculation and type encoding.
*   **Schema Enforcement**: Validates data types against the defined schema before writing.

### 4. Access Methods / Storage Engine (`btree.ts`)
*   **B-Tree**: The core data structure. It organizes data into **Pages** (Nodes).
*   **Indexing**: Ensures Primary Keys are sorted and allows `O(log n)` retrieval logic.
*   **Page Management**: Handles the complexity of splitting nodes (Leaf Split) when a 4KB page is full and updating parent pointers.

### 5. Physical Storage Layer (`VirtualDisk`)
*   **Virtual Disk**: An abstraction simulating a block device. It reads and writes fixed-size 4KB blocks (Pages) identified by a numeric `PageID`.
*   **Persistence**: Uses `localStorage` as the physical medium, encoding binary pages into Base64 strings.
*   **Transaction Manager**: Implements buffering. Writes are held in a memory map during a transaction and only flushed to `localStorage` on `COMMIT`.

---

## 📂 Project Structure

```text
/
├── lib/
│   ├── database.ts    # Main entry point. Manages tables and executes queries.
│   ├── table.ts       # Table abstraction. Handles row serialization/deserialization.
│   ├── btree.ts       # The Core. Implements B-Tree logic (split, insert, search).
│   ├── parser.ts      # Regex-based SQL parser. Converts strings to Command objects.
│   ├── types.ts       # TypeScript interfaces for Schema, Rows, and Pages.
│   ├── utils.ts       # Helpers for binary encoding, type validation, and cloning.
│   └── tests.ts       # Integration tests for all database features.
│
├── components/
│   └── Repl.tsx       # The visual terminal interface.
│
└── App.tsx            # Root React component.
```

---

## 🛠 Usage

### Basic Commands
```sql
-- Create a table
CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)

-- Insert data
INSERT INTO users VALUES (1, 'Alice', 30)
INSERT INTO users (name, age) VALUES ('Bob', 25) -- Auto-increment ID

-- Select data
SELECT * FROM users
SELECT * FROM users WHERE age > 25

-- Update and Delete
UPDATE users SET age = 31 WHERE id = 1
DELETE FROM users WHERE name = 'Bob'
```

### Joins
```sql
CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, item TEXT)
INSERT INTO orders VALUES (100, 1, 'Laptop')

SELECT * FROM users JOIN orders ON users.id = orders.user_id
```

### Transactions
```sql
BEGIN
INSERT INTO users VALUES (99, 'Temporary', 0)
ROLLBACK -- 'Temporary' user is gone

BEGIN
INSERT INTO users VALUES (100, 'Permanent', 0)
COMMIT -- Saved to disk
```

### System Commands
*   `TEST`: Run the internal test suite.
*   `CLEAR`: Clear the terminal output.
*   `RESET`: **Hard wipe** the database (clears LocalStorage).

---

## 🧠 Technical Challenges & "Stuck" Points

Building a database engine from scratch presents several complex challenges. Here is where the development process required the most effort:

### 1. Binary Serialization in JavaScript
**The Challenge:** JavaScript does not have C-style structs.
**The Solution:** We manually construct `Uint8Array` buffers using `DataView`. 
*   *Rows* are variable-length. We have to calculate the byte length of strings, store the length header (2 bytes), and then the data.
*   *Debugging*: Off-by-one errors in byte offsets caused "corrupted" reads where an integer would be read as part of a string.

### 2. B-Tree Implementation
**The Challenge:** Implementing node splitting and recursion.
**The Solution:** 
*   The B-Tree logic resides in `lib/btree.ts`.
*   Handling the split of a `LEAF` node when it exceeds `PAGE_SIZE` (4KB) was tricky. We had to sort the cells, split them into two new pages, and bubble the median key up to the parent.
*   *Limitation*: Currently, this engine handles Root splits perfectly, but deep internal node splits are simplified for the demo.

### 3. The "Virtual Disk"
**The Challenge:** Simulating random access files in a browser.
**The Solution:** `lib/database.ts` implements a `VirtualDisk` class.
*   It maps `PageID (number)` -> `Base64 String` in LocalStorage.
*   It handles the `Transaction Buffer`. When `BEGIN` is called, writes are diverted to a generic Map in memory. `COMMIT` flushes them to LocalStorage, while `ROLLBACK` simply discards the Map.

### 4. Parsing SQL with Regex
**The Challenge:** SQL is a complex grammar.
**The Solution:** `lib/parser.ts` uses Regular Expressions.
*   *Stuck Point*: Handling spaces, quotes, and commas in `INSERT` statements (e.g., `'New York, NY'`) was breaking the parser initially. We switched to a more robust regex that respects quoted strings.
*   *Trade-off*: A full tokenizer/lexer would be more robust but would triple the codebase size.

---

## 🔮 Future Improvements

1.  **B-Tree Deletion Rebalancing**: Currently, `DELETE` marks records as removed but doesn't merge underflow pages.
2.  **Query Optimizer**: The Join implementation is a simple Nested Loop (`O(N*M)`). A Hash Join or Merge Join would be faster.
3.  **File System API**: Replace LocalStorage with the Origin Private File System (OPFS) for true binary file support.

---

## 📦 Installation

1.  Clone the repository.
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Run the development server:
    ```bash
    npm run dev
    ```

---

*Built with ❤️ for learning Database Internals.*
#   M i n i - S Q L i t e - W e b - E n g i n e  
 