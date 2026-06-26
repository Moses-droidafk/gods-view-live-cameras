const express = require("express");
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

const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "mosesdeluka001",
    database: "camera_system"
});

db.connect((err) => {

    if (err) {
        console.log("❌ Database connection failed");
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
// HOME PAGE + SEARCH
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
// REGISTER PAGE
// ======================

app.get("/register", (req, res) => {
    res.render("register");
});

// ======================
// REGISTER USER
// ======================

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

            }
        );

    }
    catch (error) {

        console.log(error);
        res.send("Registration failed");

    }

});

// ======================
// LOGIN PAGE
// ======================

app.get("/login", (req, res) => {
    res.render("login");
});

// ======================
// LOGIN USER
// ======================

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

        }
    );

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

        }
    );

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

        }
    );

});

// ======================
// ADD FAVORITE
// ======================

app.get("/add-favorite/:id", requireLogin, (req, res) => {

    const userId = req.session.user.id;
    const cameraId = req.params.id;

    db.query(
        `INSERT IGNORE INTO favorites
        (user_id, camera_id)
        VALUES (?, ?)`,
        [userId, cameraId],

        (err) => {

            if (err) {
                console.log(err);
            }

            res.redirect("/favorites");

        }
    );

});

// ======================
// VIEW FAVORITES
// ======================

app.get("/favorites", requireLogin, (req, res) => {

    const userId = req.session.user.id;

    db.query(

        `SELECT cameras.*
        FROM favorites
        JOIN cameras
        ON favorites.camera_id = cameras.id
        WHERE favorites.user_id = ?`,

        [userId],

        (err, results) => {

            if (err) {
                return res.send("Database error");
            }

            res.render("favorites", {
                cameras: results,
                user: req.session.user
            });

        }

    );

});

// ======================
// REMOVE FAVORITE
// ======================

app.get(
    "/remove-favorite/:id",
    requireLogin,

    (req, res) => {

        const userId = req.session.user.id;
        const cameraId = req.params.id;

        db.query(
            `DELETE FROM favorites
            WHERE user_id = ?
            AND camera_id = ?`,

            [userId, cameraId],

            (err) => {

                if (err) {
                    return res.send("Database error");
                }

                res.redirect("/favorites");

            }
        );

    }
);

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

// ======================
// ADMIN CHECK CAMERAS
// ======================

app.get(
    "/admin/check-cameras",

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

                res.send(
                    "✅ Camera status update complete"
                );

            }
        );

    }
);

// ======================
// START SERVER
// ======================

app.listen(3000, () => {

    console.log(
        "🚀 God's View running at http://localhost:3000"
    );

});