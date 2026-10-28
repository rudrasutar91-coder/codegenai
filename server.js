const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// ===================================
// MYSQL DATABASE CONNECTION
// ===================================

const db = mysql.createPool({
    host: "localhost",
    user: "root",
    password: process.env.DB_PASSWORD || "rudrasutar@123",
    database: "codegenai",
    port: 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// ===================================
// HELPER FUNCTIONS
// ===================================

function parseUserId(value) {
    if (value === undefined || value === null || value === "") {
        return null;
    }

    const id = Number(value);

    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error("Invalid user ID.");
    }

    return id;
}

function getUserId(req) {
    return parseUserId(req.query.userId);
}

// ===================================
// HOME & DATABASE STATUS
// ===================================

app.get("/", (req, res) => {
    res.send("CODEGENAI API Server is Running!");
});

app.get("/api/db-status", async (req, res) => {
    try {
        await db.query("SELECT 1");

        res.json({
            success: true,
            message: "MySQL Database Connected Successfully!"
        });
    } catch (error) {
        console.error("Database error:", error.message);

        res.status(500).json({
            success: false,
            message: "MySQL connection failed."
        });
    }
});

// ===================================
// REGISTER API
// POST /register
// ===================================

app.post("/register", async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (
            typeof name !== "string" ||
            typeof email !== "string" ||
            typeof password !== "string" ||
            !name.trim() ||
            !email.trim() ||
            !password
        ) {
            return res.status(400).json({
                success: false,
                message: "Please enter all details."
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 8 characters."
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        await db.execute(
            `INSERT INTO users (name, email, password)
             VALUES (?, ?, ?)`,
            [
                name.trim(),
                email.trim().toLowerCase(),
                hashedPassword
            ]
        );

        res.status(201).json({
            success: true,
            message: "Registration successful!"
        });
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                success: false,
                message: "Email already registered."
            });
        }

        console.error("Register error:", error.message);

        res.status(500).json({
            success: false,
            message: "Registration failed."
        });
    }
});

// ===================================
// LOGIN API
// POST /login
// ===================================

app.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (
            typeof email !== "string" ||
            typeof password !== "string" ||
            !email.trim() ||
            !password
        ) {
            return res.status(400).json({
                success: false,
                message: "Enter email and password."
            });
        }

        const [users] = await db.execute(
            `SELECT id, name, email, password
             FROM users
             WHERE email = ?`,
            [email.trim().toLowerCase()]
        );

        if (
            users.length === 0 ||
            !(await bcrypt.compare(password, users[0].password))
        ) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password."
            });
        }

        const user = users[0];

        res.json({
            success: true,
            message: "Login successful!",
            user: {
                id: user.id,
                name: user.name,
                email: user.email
            }
        });
    } catch (error) {
        console.error("Login error:", error.message);

        res.status(500).json({
            success: false,
            message: "Login failed."
        });
    }
});

// ===================================
// SAVE STUDENT DETAILS
// POST /api/students
// ===================================

app.post("/api/students", async (req, res) => {
    try {
        const { name, course, email } = req.body;

        if (
            typeof name !== "string" ||
            typeof course !== "string" ||
            typeof email !== "string" ||
            !name.trim() ||
            !course.trim() ||
            !email.trim()
        ) {
            return res.status(400).json({
                success: false,
                message: "Enter all student details."
            });
        }

        const [result] = await db.execute(
            `INSERT INTO students (name, course, email)
             VALUES (?, ?, ?)`,
            [name.trim(), course.trim(), email.trim().toLowerCase()]
        );

        res.status(201).json({
            success: true,
            message: "Student details saved!",
            studentId: result.insertId
        });
    } catch (error) {
        console.error("Student error:", error.message);

        res.status(500).json({
            success: false,
            message: "Unable to save student details."
        });
    }
});

// GET STUDENTS
app.get("/api/students", async (req, res) => {
    try {
        const [students] = await db.execute(
            `SELECT id, name, course, email, created_at
             FROM students ORDER BY id DESC`
        );

        res.json({ success: true, students });
    } catch (error) {
        console.error("Fetch students error:", error.message);

        res.status(500).json({
            success: false,
            message: "Unable to fetch students."
        });
    }
});

// ===================================
// AI CODE GENERATOR + AUTO SAVE
// POST /api/generate
// ===================================

app.post("/api/generate", async (req, res) => {
    try {
        const { prompt, language, userId } = req.body;

        if (typeof prompt !== "string" || !prompt.trim()) {
            return res.status(400).json({
                success: false,
                message: "Enter your coding requirement."
            });
        }

        let parsedUserId;

        try {
            parsedUserId = parseUserId(userId);
        } catch (error) {
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }

        const selectedLanguage =
            typeof language === "string" && language.trim()
                ? language.trim()
                : "Python";

        // Verify that a supplied user ID exists
        if (parsedUserId !== null) {
            const [users] = await db.execute(
                "SELECT id FROM users WHERE id = ?",
                [parsedUserId]
            );

            if (users.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: "User not found. Please login again."
                });
            }
        }

        // Call local Ollama AI
        const aiResponse = await fetch(
            "http://localhost:11434/api/generate",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "qwen2.5-coder:3b",
                    system:
                        "You are CODEGENAI. Generate complete, " +
                        "beginner-friendly code in the requested language. " +
                        "Explain the code briefly. Do not claim that code " +
                        "was executed or tested.",
                    prompt:
                        `Language: ${selectedLanguage}\n` +
                        `Requirement: ${prompt.trim()}`,
                    stream: false
                })
            }
        );

        if (!aiResponse.ok) {
            throw new Error("Ollama request failed.");
        }

        const aiData = await aiResponse.json();
        const generatedCode = aiData.response;

        if (
            typeof generatedCode !== "string" ||
            !generatedCode.trim()
        ) {
            throw new Error("AI returned empty code.");
        }

        // Save generated code to MySQL
        const [result] = await db.execute(
            `INSERT INTO generation_history
             (user_id, title, language, prompt, generated_code)
             VALUES (?, ?, ?, ?, ?)`,
            [
                parsedUserId,
                prompt.trim().substring(0, 200),
                selectedLanguage,
                prompt.trim(),
                generatedCode
            ]
        );

        res.json({
            success: true,
            message: "Code generated and saved to history!",
            historyId: result.insertId,
            language: selectedLanguage,
            code: generatedCode
        });
    } catch (error) {
        console.error("Generation error:", error.message);

        res.status(500).json({
            success: false,
            message:
                "Code generation or saving failed. Check MySQL and Ollama."
        });
    }
});

// ===================================
// SAVE HISTORY MANUALLY
// POST /api/history
// ===================================

app.post("/api/history", async (req, res) => {
    try {
        const {
            userId,
            title,
            name,
            language,
            prompt,
            code,
            generated_code
        } = req.body;

        const historyTitle = title || name;
        const historyCode = generated_code ?? code;

        if (
            typeof historyTitle !== "string" ||
            typeof language !== "string" ||
            typeof prompt !== "string" ||
            typeof historyCode !== "string" ||
            !historyTitle.trim() ||
            !language.trim() ||
            !prompt.trim() ||
            !historyCode.trim()
        ) {
            return res.status(400).json({
                success: false,
                message: "Title, language, prompt and code are required."
            });
        }

        const parsedUserId = parseUserId(userId);

        if (parsedUserId !== null) {
            const [users] = await db.execute(
                "SELECT id FROM users WHERE id = ?",
                [parsedUserId]
            );

            if (users.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: "User not found."
                });
            }
        }

        const [result] = await db.execute(
            `INSERT INTO generation_history
             (user_id, title, language, prompt, generated_code)
             VALUES (?, ?, ?, ?, ?)`,
            [
                parsedUserId,
                historyTitle.trim().substring(0, 200),
                language.trim(),
                prompt.trim(),
                historyCode
            ]
        );

        res.status(201).json({
            success: true,
            message: "History saved successfully!",
            id: result.insertId
        });
    } catch (error) {
        console.error("Save history error:", error.message);

        res.status(500).json({
            success: false,
            message: "Unable to save history."
        });
    }
});

// ===================================
// GET / SEARCH / FILTER / SORT HISTORY
// GET /api/history?userId=1
// ===================================

app.get("/api/history", async (req, res) => {
    try {
        const userId = getUserId(req);

        const search =
            typeof req.query.search === "string"
                ? req.query.search.trim()
                : "";

        const language =
            typeof req.query.language === "string"
                ? req.query.language.trim()
                : "";

        const sort = req.query.sort === "oldest" ? "ASC" : "DESC";

        let sql = `
            SELECT id, title, title AS name, language, prompt,
                   generated_code, generated_code AS code,
                   created_at, created_at AS date
            FROM generation_history
            WHERE user_id <=> ?
        `;

        const params = [userId];

        if (language && language.toLowerCase() !== "all") {
            sql += " AND LOWER(language) = LOWER(?)";
            params.push(language);
        }

        if (search) {
            sql += ` AND (
                title LIKE ? OR prompt LIKE ?
                OR language LIKE ? OR generated_code LIKE ?
            )`;

            const term = `%${search}%`;
            params.push(term, term, term, term);
        }

        sql += ` ORDER BY created_at ${sort}, id ${sort}`;

        const [history] = await db.execute(sql, params);

        res.json({
            success: true,
            count: history.length,
            history
        });
    } catch (error) {
        console.error("Fetch history error:", error.message);

        res.status(500).json({
            success: false,
            message: "Unable to fetch history."
        });
    }
});

// ===================================
// DELETE ONE HISTORY RECORD
// DELETE /api/history/5?userId=1
// ===================================

app.delete("/api/history/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);
        const userId = getUserId(req);

        if (!Number.isSafeInteger(id) || id <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid history ID."
            });
        }

        const [result] = await db.execute(
            `DELETE FROM generation_history
             WHERE id = ? AND user_id <=> ?`,
            [id, userId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "History record not found."
            });
        }

        res.json({
            success: true,
            message: "History deleted successfully."
        });
    } catch (error) {
        console.error("Delete history error:", error.message);

        res.status(500).json({
            success: false,
            message: "Unable to delete history."
        });
    }
});

// ===================================
// CLEAR ALL HISTORY
// DELETE /api/history?userId=1
// ===================================

app.delete("/api/history", async (req, res) => {
    try {
        const userId = getUserId(req);

        const [result] = await db.execute(
            `DELETE FROM generation_history
             WHERE user_id <=> ?`,
            [userId]
        );

        res.json({
            success: true,
            message: "History cleared successfully.",
            deletedCount: result.affectedRows
        });
    } catch (error) {
        console.error("Clear history error:", error.message);

        res.status(500).json({
            success: false,
            message: "Unable to clear history."
        });
    }
});

// ===================================
// START SERVER
// ===================================

async function startServer() {
    try {
        await db.query("SELECT 1");

        console.log("MySQL Database Connected Successfully!");

        app.listen(PORT, () => {
            console.log(
                `CODEGENAI server running at http://localhost:${PORT}`
            );
        });
    } catch (error) {
        console.error("MySQL connection failed:", error.message);
        process.exit(1);
    }
}

startServer();