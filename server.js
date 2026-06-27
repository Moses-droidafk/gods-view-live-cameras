require('dotenv').config();const express = require("express");

const mysql = require("mysql2");
const session = require("express-session");
const bcrypt = require("bcrypt");
const axios = require("axios");

const app = express();

// ======================
// MIDDLEWARE
// ======================

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: "godsviewsecret",
    resave: false,
    saveUninitialized: false
}));

app.set("view engine", "ejs");

// ======================
// DATABASE
// ======================

console.log("HOST:", process.env.DB_HOST);
console.log("PORT:", process.env.DB_PORT);
console.log("USER:", process.env.DB_USER);
console.log("DATABASE:", process.env.DB_NAME);
console.log("PASSWORD LENGTH:", process.env.DB_PASSWORD ? process.env.DB_PASSWORD.length : 0);

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true
    }
});

db.connect((err) => {

    if (err) {
        console.log(err);
    }
    else {
        console.log("✅ Connected to MySQL");
    }

});

// ======================
// LOGIN PROTECTION
// ======================

function requireLogin(req, res, next) {

    if (!req.session.user) {
        return res.redirect("/login");
    }

    next();

}

// ======================
// ADMIN PROTECTION
// ======================

function requireAdmin(req, res, next) {

    if (!req.session.user) {
        return res.redirect("/login");
    }

    if (req.session.user.role !== "admin") {
        return res.send("Access denied");
    }

    next();

}

// ======================
// HOME PAGE
// ======================

app.get("/", requireLogin, (req, res) => {

    const search = req.query.search || "";

    db.query(
        `SELECT * FROM cameras
        WHERE name LIKE ?
        OR location LIKE ?
        OR category LIKE ?`,

        [
            `%${search}%`,
            `%${search}%`,
            `%${search}%`
        ],

        (err, results) => {

            if (err) {
                return res.send("Database error");
            }

            res.render("index", {
                cameras: results,
                search: search,
                user: req.session.user
            });

        }
    );

});

// ======================
// REGISTER
// ======================

app.get("/register", (req, res) => {
    res.render("register");
});

app.post("/register", async (req, res) => {

    const { username, email, password } = req.body;

    try {

        const hashedPassword =
            await bcrypt.hash(password, 10);

        db.query(
            "INSERT INTO users(username,email,password) VALUES(?,?,?)",
            [username, email, hashedPassword],

            (err) => {

                if (err) {
                    console.log(err);
                    return res.send("Registration failed");
                }

                res.redirect("/login");

            });

    }
    catch (error) {

        console.log(error);
        res.send("Registration failed");

    }

});

// ======================
// LOGIN
// ======================

app.get("/login", (req, res) => {
    res.render("login");
});

app.post("/login", (req, res) => {

    const { email, password } = req.body;

    db.query(
        "SELECT * FROM users WHERE email=?",
        [email],

        async (err, results) => {

            if (err) {
                return res.send("Database error");
            }

            if (results.length === 0) {
                return res.send("User not found");
            }

            const user = results[0];

            const match =
                await bcrypt.compare(
                    password,
                    user.password
                );

            if (!match) {
                return res.send("Wrong password");
            }

            req.session.user = user;

            res.redirect("/");

        });

});

// ======================
// LOGOUT
// ======================

app.get("/logout", (req, res) => {

    req.session.destroy(() => {
        res.redirect("/login");
    });

});

// ======================
// MAP PAGE
// ======================

app.get("/map", requireLogin, (req, res) => {

    db.query(
        "SELECT * FROM cameras",

        (err, results) => {

            if (err) {
                return res.send("Database error");
            }

            res.render("map", {
                cameras: results,
                user: req.session.user
            });

        });

});

// ======================
// CAMERA PAGE
// ======================

app.get("/camera/:id", requireLogin, (req, res) => {

    db.query(
        "SELECT * FROM cameras WHERE id=?",
        [req.params.id],

        (err, results) => {

            if (err) {
                return res.send("Database error");
            }

            if (results.length === 0) {
                return res.send("Camera not found");
            }

            const camera = results[0];

            let mode = "external";

            if (
                camera.stream_url &&
                camera.stream_url.includes(".m3u8")
            ) {
                mode = "video";
            }
            else if (
                camera.stream_url &&
                (
                    camera.stream_url.includes("earthcam") ||
                    camera.stream_url.includes("skylinewebcams")
                )
            ) {
                mode = "iframe";
            }

            res.render("camera", {
                camera,
                mode,
                user: req.session.user
            });

        });

});

// ======================
// FAVORITES
// ======================

app.get("/add-favorite/:id", requireLogin, (req, res) => {

    const userId = req.session.user.id;
    const cameraId = req.params.id;

    db.query(
        `INSERT IGNORE INTO favorites
        (user_id, camera_id)
        VALUES (?, ?)`,
        [userId, cameraId],

        () => {
            res.redirect("/favorites");
        });

});

app.get("/favorites", requireLogin, (req, res) => {

    const userId = req.session.user.id;

    db.query(
        `SELECT cameras.*
        FROM favorites
        JOIN cameras
        ON favorites.camera_id = cameras.id
        WHERE favorites.user_id=?`,

        [userId],

        (err, results) => {

            if (err) {
                return res.send("Database error");
            }

            res.render("favorites", {
                cameras: results,
                user: req.session.user
            });

        });

});

app.get("/remove-favorite/:id",
    requireLogin,

    (req, res) => {

        db.query(
            `DELETE FROM favorites
            WHERE user_id=? AND camera_id=?`,

            [
                req.session.user.id,
                req.params.id
            ],

            () => {
                res.redirect("/favorites");
            });

    });

// ======================
// ADMIN DASHBOARD
// ======================

app.get("/admin", requireAdmin, (req, res) => {

    db.query("SELECT * FROM cameras", (err, cameras) => {

        if (err) {
            return res.send("Database error");
        }

        db.query("SELECT COUNT(*) AS totalUsers FROM users",
        (err, userResult) => {

            db.query(
                "SELECT COUNT(*) AS totalFavorites FROM favorites",

                (err, favoriteResult) => {

                    const totalCameras = cameras.length;

                    const onlineCameras =
                        cameras.filter(
                            cam => cam.status === "online"
                        ).length;

                    const offlineCameras =
                        cameras.filter(
                            cam => cam.status === "offline"
                        ).length;

                    res.render("admin", {

                        cameras,

                        user: req.session.user,

                        stats: {

                            totalUsers:
                                userResult[0].totalUsers,

                            totalFavorites:
                                favoriteResult[0].totalFavorites,

                            totalCameras,

                            onlineCameras,

                            offlineCameras

                        }

                    });

                });

        });

    });

});
// ======================
// ADD CAMERA
// ======================

app.get("/admin/add-camera",
    requireAdmin,

    (req, res) => {

        res.render("add-camera", {
            user: req.session.user
        });

    });

app.post("/admin/add-camera",
    requireAdmin,

    (req, res) => {

        const {
            name,
            location,
            description,
            category,
            stream_url,
            source,
            camera_type,
            latitude,
            longitude
        } = req.body;

        db.query(
            `INSERT INTO cameras
            (
                name,
                location,
                description,
                category,
                stream_url,
                latitude,
                longitude,
                source,
                camera_type
            )

            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,

            [
                name,
                location,
                description,
                category,
                stream_url,
                latitude || null,
                longitude || null,
                source,
                camera_type
            ],

            (err) => {

                if (err) {
                    console.log(err);
                    return res.send("Failed to add camera");
                }

                res.redirect("/admin");

            });

    });

// ======================
// DELETE CAMERA
// ======================

app.get("/admin/delete-camera/:id",
    requireAdmin,

    (req, res) => {

        db.query(
            "DELETE FROM cameras WHERE id=?",
            [req.params.id],

            (err) => {

                if (err) {
                    return res.send("Database error");
                }

                res.redirect("/admin");

            });

    });

// ======================
// VIEW USERS
// ======================

app.get("/admin/users",
    requireAdmin,

    (req, res) => {

        db.query(
            "SELECT * FROM users",

            (err, results) => {

                if (err) {
                    return res.send("Database error");
                }

                res.render("users", {
                    users: results,
                    user: req.session.user
                });

            });

    });

// ======================
// DELETE USER
// ======================

app.get("/admin/delete-user/:id",
    requireAdmin,

    (req, res) => {

        db.query(
            "DELETE FROM users WHERE id=?",
            [req.params.id],

            (err) => {

                if (err) {
                    return res.send("Database error");
                }

                res.redirect("/admin/users");

            });

    });

// ======================
// CAMERA STATUS CHECKER
// ======================

async function checkCamera(url) {

    try {

        const response =
            await axios.get(url, {
                timeout: 5000
            });

        return response.status === 200
            ? "online"
            : "offline";

    }
    catch {

        return "offline";

    }

}

app.get("/admin/check-cameras",
    requireAdmin,

    async (req, res) => {

        db.query(
            "SELECT * FROM cameras",

            async (err, cameras) => {

                if (err) {
                    return res.send("Database error");
                }

                for (let cam of cameras) {

                    const status =
                        await checkCamera(
                            cam.stream_url
                        );

                    db.query(
                        "UPDATE cameras SET status=? WHERE id=?",
                        [status, cam.id]
                    );

                }

                res.send("✅ Camera status update complete");

            });

    });

// ======================
// START SERVER
// ======================

app.listen(3000, () => {

    console.log(
        "🚀 God's View running on http://localhost:3000"
    );

});