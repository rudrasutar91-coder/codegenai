
const mysql = require("mysql2/promise");

const db = mysql.createPool({
    host: "localhost",
    user: "root",
    password: process.env.DB_PASSWORD || "rudrasutar@123",
    database: "college",
    port: 3306,
    waitForConnections: true,
    connectionLimit: 10
});

module.exports = db;
