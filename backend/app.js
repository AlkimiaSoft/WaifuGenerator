const config = require('./config');
const express = require('express');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');
const flash = require('connect-flash');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const cors = require('cors'); // Import the CORS middleware
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const crypto = require('crypto');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sendVerificationEmail } = require('./mailer');
const { check, validationResult } = require('express-validator');
const stripe = require('stripe')(config.stripe.secretKey);

require('dotenv').config();


const app = express();

app.post('/stripe_webhook', bodyParser.raw({ type: 'application/json' }), async (request, response) => {
    const payload = request.body;
    const sig = request.headers['stripe-signature'];

    let event;

    try {
        event = stripe.webhooks.constructEvent(payload, sig, config.stripe.webhookSecret);
    } catch (err) {
        return response.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (
        event.type === 'checkout.session.completed'
        || event.type === 'checkout.session.async_payment_succeeded'
    ) {
        fulfillCheckout(event.data.object.id);
    }

    response.status(200).end();
});


// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
    secret: process.env.SESSION_SECRET, // Change this to a random string
    resave: false,
    saveUninitialized: true
}));
// Configure flash middleware
app.use(flash());

// Set up middleware to pass flash messages to your views
app.use((req, res, next) => {
    res.locals.success_msg = req.flash('success_msg');
    res.locals.error_msg = req.flash('error_msg');
    res.locals.error = req.flash('error');
    next();
});

app.use(passport.initialize());
app.use(passport.session());


// Enable CORS middleware
app.use(cors());

// Set EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '/views'));
app.use(express.static('frontend'));
//DB CONNECTION
// Initialize SQLite database connection
const db = new sqlite3.Database(process.env.DATABASE_PATH, (err) => {
    if (err) {
        console.error('Error connecting to SQLite database:', err.message);
    } else {
        console.log('Connected to SQLite database');
    }
});

// Create users table if not exists
db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT,
    password TEXT,
    googleId TEXT,
    displayName TEXT,
    email TEXT,
    remainingCreations INTEGER,
    avatarUrl TEXT
)`, (err) => {
    if (err) {
        console.error('Error creating users table:', err.message);
    } else {
        console.log('Users table created successfully');
    }
});

// Create likes table if not exists
db.run(`CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voterId INTEGER,
    creationId INTEGER,
    creatorId INTEGER,
    voteTime DATETIME,
    voteType INTEGER
)`, (err) => {
    if (err) {
        console.error('Error creating votes table:', err.message);
    } else {
        console.log('Votes table created successfully');
    }
});

// db.run(`CREATE TABLE IF NOT EXISTS chats (
//     id TEXT PRIMARY KEY,
//     createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
//   )`, (err) => {
//     if (err) {
//         console.error('Error creating chats table:', err.message);
//     } else {
//         console.log('Chat table created successfully');
//     }
// });

//foreign key per chatcontent si creem la taula chat
//FOREIGN KEY(chatId) REFERENCES chats(id)
db.run(`CREATE TABLE IF NOT EXISTS chatContent (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chatId TEXT,
    messageContent TEXT,
    sender TEXT
  )`, (err) => {
    if (err) {
        console.error('Error creating chatContent table:', err.message);
    } else {
        console.log('chatContent table created successfully');
    }
});

// Configure Passport local strategy with SQLite
passport.use(new LocalStrategy(
    function (username, password, done) {

        db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
            if (err) {
                return done(err);
            }
            if (!row) {
                return done(null, false, { message: 'Incorrect username' });
            }
            // if (!row.userVerified) {
            //     return done(null, false, { message: 'Email not verified' });
            // }
            bcrypt.compare(password, row.password, (err, isMatch) => {
                if (err) {
                    return done(err);
                }
                if (isMatch) {
                    return done(null, row);
                } else {
                    return done(null, false, { message: 'Incorrect password' });
                }
            });
        });
    }
));

// Serialize user
passport.serializeUser(function (user, done) {
    done(null, user.id);
});

//Deserialize user
passport.deserializeUser(function (id, done) {
    db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => {
        if (err) {
            return done(err);
        }
        done(null, row);
    });
});

app.use((req, res, next) => {
    res.locals.user = req.user;
    next();
});


// Serve frontend files
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/gallery', express.static(path.join(__dirname, 'gallery')));
app.use('/thumbnails', express.static(path.join(__dirname, 'thumbnails')));
app.use(express.static(path.join(__dirname, '../slideshows')));


// Google OAuth strategy
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENTID,
    clientSecret: process.env.GOOGLE_CLIENTSECRET,
    callbackURL: process.env.BASE_URL + '/auth/google/callback' // Change the callback URL to your actual endpoint
},
    function (accessToken, refreshToken, profile, done) {

        const avatarUrl = profile.photos && profile.photos.length > 0 ? profile.photos[0].value : null;

        db.get('SELECT * FROM users WHERE googleId = ?', [profile.id], (err, row) => {
            if (err) {
                return done(err);
            }
            if (!row) {
                // User not found, create a new user
                db.run('INSERT INTO users (googleId, displayName, email, avatarUrl, remainingCreations, userVerified) VALUES (?, ?, ?, ?, ?, ?)', [profile.id, profile.displayName, profile.emails[0].value, avatarUrl, 5, 1], (err) => {
                    if (err) {
                        return done(err);
                    }
                    // Fetch the newly created user
                    db.get('SELECT * FROM users WHERE googleId = ?', [profile.id], (err, user) => {
                        if (err) {
                            return done(err);
                        }
                        return done(null, user);
                    });
                });
            } else {
                // User found, return the user
                return done(null, row);
            }
        });
    }
));

// Configure Passport local signup strategy
passport.use('local-signup', new LocalStrategy({
    usernameField: 'username',
    passwordField: 'password',
    passReqToCallback: true // Pass req to the callback for additional data (if needed)
}, (req, username, password, done) => {

    const { email } = req.body;

    // Check if the username is already taken
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
        if (err) {
            return done(err);
        }
        if (row) {
            return done(null, false, { message: 'Username is already taken' });
        }
        db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
            if (err) {
                return done(err);
            }
            if (row) {
                return done(null, false, { message: 'Email is already in use' });
            }
            //TODO
            // Hash the password
            bcrypt.hash(password, 10, (err, hashedPassword) => {
                if (err) {
                    return done(err);
                }
                //Generate Token
                const verificationToken = jwt.sign({ email }, 'thisIsMyJWTSecretThatICannotTellAnybody', { expiresIn: '1d' });

                // If the username is available, create a new user record
                db.run('INSERT INTO users (username, password, email, displayName, remainingCreations,userVerified,verificationToken) VALUES (?, ?, ?, ?, ?, ?, ?)', [username, hashedPassword, email, username, 5, false, verificationToken], (err) => {
                    if (err) {
                        return done(err);
                    }



                    // Fetch the newly created user
                    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
                        if (err) {
                            return done(err);
                        }

                        // Send verification email
                        sendVerificationEmail(user, verificationToken);

                        return done(null, user);
                    });

                });
            });
        });
    });
}));

// Routes
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/login.html'));
});

// Local login route
app.post('/login', passport.authenticate('local', {
    successRedirect: '/dashboard',
    failureRedirect: '/login',
    failureFlash: true
}));



// Google OAuth route
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login' }),
    function (req, res) {
        // Successful authentication, redirect to dashboard or do something else
        res.redirect('/dashboard');
    });

const firstNames = ['Ikerada', 'Manamaya', 'Managuchi', 'Muya', 'Dokaki', 'Sunen', 'Fuyashi', 'Uyebaru', 'Ogano', 'Kimari', 'Matsumaya', 'Uyekita', 'Kurizora', 'Isekawa', 'Wakagiri', 'Kinobi', 'Nabira', 'Tonari', 'Wakikaze', 'Harizaki', 'Hashibira', 'Suzuzora', 'Nonaga', 'Shinoraki', 'Tatsuchi', 'Miyasuchi', 'Susano', 'Hirogusa', 'Yakutsu', 'Zaruta', 'Hisamari', 'Segita', 'Hiratsami', 'Hisagai', 'Hawa', 'Hamahaya', 'Azumoto', 'Sekigimoto', 'Agayama', 'Yamayuki', 'Kaguse', 'Fubuto', 'Rikizawa', 'Amayashi', 'Amari', 'Tahatsumi', 'Kawawara', 'Adasuchi', 'Matsuka', 'Harato', 'Wakukita', 'Tomikino', 'Takegome', 'Uzuki', 'Ikenari', 'Haramaki', 'Fukuzato', 'Fujimiya', 'Amara', 'Tanimoto', 'Kodakono', 'Hashinashi', 'Morinishi', 'Yanaya', 'Hoguchi', 'Kobagawa', 'Manami', 'Isogami', 'Homuro', 'Kagushiro', 'Masawa', 'Ichisano', 'Yamamano', 'Kojima', 'Hashitsu', 'Sune', 'Imakuwa', 'Harakiri', 'Akagaki', 'Nariyoshi', 'Yashima', 'Tatsuno', 'Yoshikawa', 'Tsuruoka', 'Tanabe', 'Dokuro', 'Arashiro', 'Kozato', 'Oishi', 'Tsuchiya', 'Eguchi', 'Minamoto', 'Ametsuchi', 'Yukiyama', 'Miyazawa', 'Tano', 'Watanuki', 'Takagi', 'Ishibashi', 'Imamura', 'Jo', 'Yamabe', 'Sawaya', 'Tsukiyama', 'Kitagawa'];
const surNames = ['Kunitan', 'Sayoshi', 'Naritane', 'Tadake', 'Benjiyasu', 'Ineshida', 'Ketaro', 'Kamansei', 'Yakabei', 'Hinmochi', 'Milimiko', 'Hoshine', 'Midome', 'Kimime', 'Ryosa', 'Kirazuka', 'Masutsu', 'Haninuye', 'Kanemami', 'Tatsumo', 'Kukitako', 'Tokizuka', 'Tanigi', 'Akotsune', 'Minena', 'Osarako', 'Sayonari', 'Sayokuri', 'Orimachi', 'Azunatsu', 'Achiko', 'Makizuka', 'Kazatako', 'Himekiko', 'Kuruze', 'Temika', 'Natsukuri', 'Tame', 'Wakase', 'Kurari', 'Hikachiko', 'Hidiri', 'Hainari', 'Arisuki', 'Yara', 'Hoshirabi', 'Umetako', 'Tanakayo', 'Toshirise', 'Milikari', 'Sawaki', 'Himeshiko', 'Sakikura', 'Urasuki', 'Kyotako', 'Imani', 'Saizumi', 'Atsudoka', 'Natsurari', 'Sayochiru', 'Kohayoshi', 'Emirime', 'Takanase', 'Kozatsuki', 'Tsudoka', 'Wana', 'Tatsushi', 'Kahokichi', 'Aize', 'Natsumika', 'Komami', 'Sanomi', 'Kirarime', 'Edoka', 'Tadachiru', 'Anekayo', 'Gime', 'Maemachi', 'Kimiruri', 'Asumi', 'Misa', 'Reira', 'Kouko', 'Toshie', 'Himeko', 'Mayako', 'Isaki', 'Ome', 'Yu', 'Aishun', 'Rinako', 'Sute', 'Arisa', 'Honomi', 'Tatsumi', 'Fuji', 'Tamaki', 'Ai', 'Taki', 'Amarante', 'Eriko', 'Kinuyo', 'Fuyu', 'Emu', 'Aneka'];


function getRandomName() {
    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const surName = surNames[Math.floor(Math.random() * surNames.length)];
    return `${firstName} ${surName}`;
}

// Dashboard route (protected route)
app.get('/dashboard', isAuthenticated, (req, res) => {

    var user = null;
    var lastCreations = null;

    const userId = req.user.id

    // db.get('SELECT * FROM users WHERE id = ?', [userId], (err, row) => {
    //     if (err) {
    //         return done(err);
    //     } else{
    //         user = row;
    //     }
    // });

    const query = 'SELECT * FROM creations WHERE userId = ? order by creationTime desc LIMIT 3';

    db.all(query, [userId], (err, rows) => {
        if (err) {
            console.error('Error fetching creations:', err);
            res.status(500).json({ error: 'An error occurred while fetching creations.' });
        } else {
            lastCreations = rows;
            res.render('dashboardContent', {
                isAuthenticated: true,
                mainPartial: 'main-content-dashboard',
                activePage: 'dashboard',
                currenUser: user,
                creations: lastCreations
            });
        }
    });



});

// Creator route (protected route)
app.get('/creator', isAuthenticated, isVerified, (req, res) => {
    const waifuName = getRandomName();
    res.render('mainContent', {
        isAuthenticated: true,
        mainPartial: 'main-content-creator',
        activePage: 'creator',
        waifuName: waifuName
    });
});

// Logout route
app.get('/logout', (req, res, next) => {
    req.logout(function (err) {
        if (err) { return next(err); }
        res.redirect('/');
    });
});

// Middleware to check if user is authenticated
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/login');
}

// Middleware to check if user is verified
function isVerified(req, res, next) {

    const userId = req.user.id;

    db.get('SELECT userVerified FROM users WHERE id = ?', [userId], (err, row) => {
        if (err) {
            return reject(err);
        }
        if (row.userVerified)
            return next();
        else
            res.redirect('/dashboard');
    });

}

const getUserCredits = (userId) => {
    return new Promise((resolve, reject) => {
        db.get('SELECT remainingCreations FROM users WHERE id = ? LIMIT 1', [userId], (err, row) => {
            if (err) {
                return reject(err);
            }
            resolve(row.remainingCreations);
        });
    });

};

const hasEnoughCredits = async (req, res, next) => {
    try {
        const userId = req.user.id; // Assuming user ID is stored in req.user
        const requiredCredits = 1; // Example required credits

        const userCredits = await getUserCredits(userId);
        if (userCredits >= requiredCredits) {
            return next();
        } else {
            return res.status(403).json({ message: 'Not enough credits' });
        }
    } catch (err) {
        return res.status(500).json({ message: 'Error checking credits', error: err.message });
    }
};




const updateRemainingCreations = async (userId, deltaUpdate, res) => {

    var remainingCreations = await getUserCredits(userId);
    var newValue = remainingCreations + deltaUpdate;

    db.run('UPDATE users SET remainingCreations = ? WHERE id = ?', [newValue, userId], (error, result) => {
        if (error) {
            console.error('Error updating public status:', error);
            //res.status(500).json({ error: 'Internal server error' });
        } else {
            //res.status(200).json({ success: true });
        }
    });

};

// Route handler for main page
app.get('/', (req, res) => {
    // Check if user is authenticated
    if (req.user) {
        // If authenticated, render the layout with authenticated content
        console.log('is authenticated');
        res.redirect('/dashboard');
        // res.render('mainContent', {
        //     isAuthenticated: true,
        //     mainPartial: 'main-content-home',
        //     activePage: 'home'
        // });
    } else {
        // If not authenticated, render the layout with not authenticated content
        console.log('NOT authenticated');
        // res.render('mainContent', {
        //     isAuthenticated: false,
        //     mainPartial: 'main-content-home',
        //     activePage: 'home'
        // });
        res.sendFile(path.join(__dirname, '../frontend/welcome.html'));
    }
});

// Route handler for main page
app.get('/welcome', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/welcome.html'));
});

// Route to serve signup form
app.get('/signup', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/signup.html'));
});

// app.post('/signup', passport.authenticate('local-signup', {
//     successRedirect: '/dashboard',
//     failureRedirect: '/signup',
//     failureFlash: true
// }));

app.post('/signup', [
    // Add validation middleware if you want
    check('username').notEmpty().withMessage('Username is required'),
    check('email').isEmail().withMessage('Invalid email address'),
    check('password').notEmpty().withMessage('Password is required')
], (req, res, next) => {

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        req.flash('error', errors.array().map(err => err.msg).join(', '));
        return res.redirect('/signup');
    }

    const { username, email, password } = req.body;

    passport.authenticate('local-signup', {
        successRedirect: '/dashboard',
        failureRedirect: '/signup',
        failureFlash: true
    })(req, res, next);
});


app.get('/verify-email', (req, res) => {
    const token = req.query.token;

    if (!token) {
        return res.status(400).send('Invalid token');
    }

    jwt.verify(token, 'thisIsMyJWTSecretThatICannotTellAnybody', (err, decoded) => {
        if (err) {
            return res.status(400).send('Invalid token');
        }

        const email = decoded.email;

        db.run('UPDATE users SET userVerified = 1, verificationToken = NULL WHERE email = ?', [email], (err) => {
            if (err) {
                return res.status(500).send('Error verifying email');
            }

            res.render('mainContent', {
                isAuthenticated: req.isAuthenticated(),
                mainPartial: 'main-content-validated',
                activePage: 'home'
            });

        });
    });
});

// Define a route for generating an image
app.post('/generateImage', isAuthenticated, hasEnoughCredits, async (req, res) => {
    try {
        // const requestBody = {
        //     age: age,
        //     bodyShape: bodyShape,
        //     expression: expression,
        //     hairLength: hairLength,
        //     hairType: hairType,
        //     hairColor: hairColor,
        //     eyeColor: eyeColor
        //   };

        const requestBody = req.body;
        const age = requestBody.age;
        const bodyShape = requestBody.bodyShape;
        const breastSize = requestBody.breastSize;
        const expression = requestBody.expression;
        const hairLength = requestBody.hairLength;
        const hairType = requestBody.hairType;
        const hairColor = requestBody.hairColor;
        const eyeColor = requestBody.eyeColor;
        const waifuName = requestBody.waifuName;
        const fullClothes = requestBody.fullClothes;
        const upperBodyClothes = requestBody.upperBodyClothes;
        const lowerBodyClothes = requestBody.lowerBodyClothes;
        const onePieceClothesColor = requestBody.onePieceClothesColor;
        const upperClothesColor = requestBody.upperClothesColor;
        const lowerClothesColor = requestBody.lowerClothesColor;

        //mount clothes subquery
        var clothesSubquery = "";
        if (fullClothes != "")
            clothesSubquery = fullClothes;
        if (onePieceClothesColor != '')
            clothesSubquery = '((' + onePieceClothesColor + ' ' + clothesSubquery + '))';

        if (upperBodyClothes != "")
            clothesSubquery = '((' + upperClothesColor + ' ' + upperBodyClothes + ')), ';

        if (lowerBodyClothes != "")
            clothesSubquery += '((' + lowerClothesColor + ' ' + lowerBodyClothes + '))';


        // var prompt = "masterpiece, best quality, 1girl, " + age + ", " + bodyShape + ", " + breastSize + ", " + expression + ", " + eyeColor + ", " + hairColor + ", " + hairLength + ", " + hairType + ", white shirt, black skirt";
        var prompt = "masterpiece, best quality, 1girl, " + age + ", " + bodyShape + ", " + breastSize + ", " + expression + ", " + eyeColor + ", " + hairColor + ", " + hairLength + ", " + hairType + ", " + clothesSubquery;
        var negative_prompt = "disfigured, 3D, cgi, extra limbs, bad quality, poor quality";
        var model = "dark-sushi-mix-v2-25";
        //var model = "animagine-xl-v-3-1";
        var width = 512;
        var height = 768;
        var steps = 20;
        var guidance = 7;
        var scheduler = "euler_a";

        // Define the request headers with the Bearer authorization token
        const apiKey = process.env.IMG_API_KEY;
        var bearerToken = 'Bearer ' + apiKey;
        var headers = {
            'Authorization': bearerToken,
            'Content-Type': 'application/json', // Specify the content type as JSON
            'Accept': '*/*'
        };

        // Define the request body
        const data = {
            "model": model,
            "prompt": prompt,
            "negative_prompt": negative_prompt,
            "width": width,
            "height": height,
            "steps": steps,
            "guidance": guidance,
            "scheduler": scheduler,
            "output_format": "png"
        };

        // Make a POST request to the external API
        const response = await axios.post('https://api.getimg.ai/v1/stable-diffusion/text-to-image', data, { headers });
        //const response = await axios.post('https://api.getimg.ai/v1/stable-diffusion-xl/text-to-image', data, { headers });
        // get the image as a base64 string
        const jsonData = response.data;
        const imageTagContent = jsonData.image;

        const seed = jsonData.seed;
        const cost = jsonData.cost;

        //Guardem la imatge a disc i el registre de la creacio al sql
        // Decode the base64 string to binary data
        const binaryData = Buffer.from(imageTagContent, 'base64');



        // Generate a unique filename using SHA-256 hash
        const hash = crypto.createHash('sha256').update(binaryData).digest('hex');
        const filename = `${hash}.png`; // Use the hash as the filename with .png extension

        // Write the binary data to a file
        const filePath = `gallery/${filename}`;
        fs.writeFileSync('backend/' + filePath, binaryData);

        // Replace this with your actual database insert operation
        //const baseUrl = `${req.protocol}://${req.hostname}:${req.socket.localPort}`;
        const imageUrl = `/${filePath}`; // Example URL

        const thumbnailPath = `thumbnails/${filename}`;
        const thumbnailUrl = `/${thumbnailPath}`;

        // Create a sharp object from the Buffer
        const sharpImage = sharp(binaryData);
        // Define thumbnail options
        const thumbnailOptions = {
            width: 200, // Width of the thumbnail
            height: 300, // Height of the thumbnail
            fit: 'cover', // Fit strategy (cover, contain, fill, inside, outside)
        };

        // Generate thumbnail and save to thumbnail folder
        sharpImage
            .resize(thumbnailOptions.width, thumbnailOptions.height, {
                fit: thumbnailOptions.fit,
            })
            .toFile('backend/' + thumbnailPath, (err, info) => {
                if (err) {
                    console.error('Error creating thumbnail:', err);
                } else {
                    console.log('Thumbnail created:', info);
                }
            });




        // Store the file path or URL in the database
        db.run(
            'INSERT INTO creations (userId, imageUrl, thumbnailUrl, public, creationTime, model, prompt, negative_prompt, imageWidth, imageHeight, scheduler, steps, guidance, seed, cost, WaifuName, likes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [req.user.id, imageUrl, thumbnailUrl, 1, new Date().toISOString(), "dark-sushi-mix-v2-25", prompt, negative_prompt, width, height, scheduler, steps, guidance, seed, cost, waifuName, 0],
            async function (err) {
                if (err) {
                    console.error('Error inserting record:', err);
                    //res.status(500).json({ error: 'An error occurred while inserting record.' });
                } else {
                    console.log('Record inserted with ID:', this.lastID);

                    //Get the image nice description from an LLM endpoint
                    //Let's call it async
                    try {
                        const callback_url = process.env.BASE_URL + '/creation_description_complete';
                        headers = {
                            'Content-Type': 'application/json', // Specify the content type as JSON
                            'Accept': '*/*'
                        };

                        const pyData = {
                            creationId: this.lastID,
                            name: waifuName,
                            prompt: prompt,
                            imgUrl: 'test',
                            callback_url: callback_url
                        }
                        // Make a POST request to the external API
                        const pyResponse = await axios.post('http://localhost:5000/getCreationDescription/', JSON.stringify(pyData), { headers });
                        const pyJsonData = pyResponse.data;
                    } catch (error) {
                        // Handle errors
                        console.error('Error fetching data:', error);
                        res.status(500).json({ error: 'An error occurred while fetching data.' });
                    }

                }
            }
        );


        // Set the response content type to base64
        res.setHeader('Content-Type', 'text/plain');

        //Decrease in 1 value the remainingCreations
        updateRemainingCreations(req.user.id, -1, res)



        // Send the image tag content as a response
        res.send(imageTagContent);
    } catch (error) {
        // Handle errors
        console.error('Error fetching data:', error);
        res.status(500).json({ error: 'An error occurred while fetching data.' });
    }

});


// Route to fetch creations belonging to the current user
app.get('/mycreations', isAuthenticated, (req, res) => {
    const userId = req.user.id; // Assuming you have user information available in req.user

    const sortField = req.query.sortField || 'creationTime';
    const sortOrder = req.query.sortOrder === 'asc' ? 'asc' : 'desc';

    const query = `SELECT * FROM creations WHERE userId = ? order by ${sortField} ${sortOrder}`;

    db.all(query, [userId], (err, rows) => {
        if (err) {
            console.error('Error fetching creations:', err);
            res.status(500).json({ error: 'An error occurred while fetching creations.' });
        } else {
            res.render('creationsGalleryContent', {
                isAuthenticated: true,
                mainPartial: 'main-content-mycreations',
                activePage: 'mycreations',
                creations: rows,
                sortField: sortField,
                sortOrder: sortOrder,
                isMyCreation: true

            });
            //res.json(rows); // Send the array of creations as JSON response
        }
    });
});

// Route to fetch creations belonging to the current user
app.get('/gallery', (req, res) => {

    var sortField = req.query.sortField || 'creationTime';
    const sortOrder = req.query.sortOrder === 'asc' ? 'asc' : 'desc';


    // Validate the sortField to prevent SQL injection
    const validSortFields = ['creationTime', 'likes']; // Add all valid sort fields
    if (!validSortFields.includes(sortField)) {
        sortField = 'creationTime';
    }

    var query = '';
    var param = '';
    const isAuthenticated = req.isAuthenticated();

    if (isAuthenticated) {
        param = req.user.id;
        query = `SELECT *, (select count(*) > 0 from votes where creationId = c.id and voterId = ?) as isLiked FROM creations c WHERE public = 1 ORDER BY ${sortField} ${sortOrder}`;
    } else {
        param = 0;
        query = `SELECT *, ? as isLiked FROM creations c WHERE public = 1 ORDER BY ${sortField} ${sortOrder}`;
    }
    console.info(query);

    db.all(query, [param], (err, rows) => {
        if (err) {
            console.error('Error fetching creations:', err);
            res.status(500).json({ error: 'An error occurred while fetching creations.' });
        } else {
            res.render('creationsGalleryContent', {
                isAuthenticated: isAuthenticated, //req.isAuthenticated,
                mainPartial: 'main-content-publicGallery',
                activePage: 'gallery',
                creations: rows,
                sortField: sortField,
                sortOrder: sortOrder,
                isMyCreation: false
            });
            //res.json(rows); // Send the array of creations as JSON response
        }
    });
});

// Route to serve signup form
app.post('/creations/:id/delete', isAuthenticated, (req, res) => {
    const { id } = req.params;

    db.run('DELETE FROM creations WHERE id = ?', [id], (error, result) => {
        if (error) {
            console.error('Error deleting creation:', error);
            //res.status(500).json({ error: 'Internal server error' });
        } else {
            res.redirect('/mycreations');
        }
    });



});

app.get('/creations/:id', (req, res) => {
    try {
        const { id } = req.params;

        const isAuthenticated = req.isAuthenticated();

        var userId = -1;
        if (isAuthenticated)
            userId = req.user.id; // Assuming you have user information available in req.user

        const query = 'SELECT * FROM creations WHERE id = ? AND (userId = ? OR public = 1)';

        db.all(query, [id, userId], (err, rows) => {
            if (err) {
                console.error('Error fetching creations:', err);
                res.status(500).json({ error: 'An error occurred while fetching creations.' });
            } else {
                if (rows.length > 0) {
                    const isMyCreation = userId == rows[0].userId;
                    res.render('creationsGalleryContent', {
                        isAuthenticated: isAuthenticated,
                        mainPartial: 'main-content-creation',
                        activePage: 'creation',
                        creations: rows,
                        sortField: '',
                        sortOrder: '',
                        isMyCreation: isMyCreation
                    });

                } else {
                    res.status(404).json({ error: 'The resource was not found. The requested creation does not exist or it does not belong to you and it is not made public.' });
                }

                //res.json(rows); // Send the array of creations as JSON response
            }
        });

    } catch (error) {
        console.error('Error fetching creation information:', error);
        res.status(500).send('Error fetching creation information');
    }
});

// Route to handle updating creation public status
app.post('/updateCreationPublicStatus', (req, res) => {
    const { id, isPublic } = req.body;

    // Update creation in the database based on ID
    // Example: Update the 'public' field in the 'creations' table
    // Adjust this according to your database schema and ORM/library
    db.run('UPDATE creations SET public = ? WHERE id = ?', [isPublic, id], (error, result) => {
        if (error) {
            console.error('Error updating public status:', error);
            res.status(500).json({ error: 'Internal server error' });
        } else {
            res.status(200).json({ success: true });
        }
    });
});

app.post('/likeCreation', isAuthenticated, (req, res) => {

    const { id } = req.body;
    voterId = req.user.id;
    newLikesValue = 0;


    db.get('SELECT userId, likes FROM creations WHERE id = ?', [id], (err, creation) => {
        if (err) {
            res.status(500).json({ error: err });
        } else {
            creatorId = creation.userId;
            //TODO REvisar que aquest usuari no la hagi votat ja
            db.get('SELECT * FROM votes WHERE voterId = ? AND creationId = ?', [voterId, id], (err, row) => {
                if (err) {
                    res.status(500).json({ error: err });
                }
                if (!row) {
                    //if this voterId has not vote th creationId lets Add it
                    db.run('INSERT INTO votes (voterId, creationId, creatorId, voteTime, voteType) VALUES (?, ?, ?, ?, ?)', [voterId, id, creatorId, new Date().toISOString(), 1], (err) => {
                        if (err) {
                            res.status(500).json({ error: err });
                        } else {
                            newLikesValue = creation.likes + 1;
                            updateLikes(res, newLikesValue, id);
                        }


                    });

                } else {
                    //Si ja existia la votacio la elimino
                    db.run('DELETE FROM votes WHERE voterId = ? AND creationId = ? ', [voterId, id], (err) => {
                        if (err) {
                            res.status(500).json({ error: err });
                        } else {
                            newLikesValue = creation.likes - 1;
                            updateLikes(res, newLikesValue, id);
                        }


                    });
                }


            });
        }
    });

});

function updateLikes(res, newLikesValue, id) {
    db.run('UPDATE creations SET likes = ? WHERE id = ?', [newLikesValue, id], (error, result) => {
        if (error) {
            console.error('Error updating likes:', error);
            res.status(500).json({ error: 'Internal server error' });
        } else {
            db.get('SELECT * FROM creations WHERE id = ?', [id], (err, row) => {
                if (err) {
                    res.status(500).json({ error: 'Internal server error' });
                } else {
                    res.status(200).json({ success: true, likes: row.likes });
                }


            });

        }
    });
}

app.post('/create-checkout-session', async (req, res) => {
    const session = await stripe.checkout.sessions.create({
        line_items: [
            {
                // Provide the exact Price ID (for example, pr_1234) of the product you want to sell
                price: 'price_1PfiyRJYiYs0VE5ED8c8Hgpr',
                quantity: 1,
            },
        ],
        mode: 'payment',
        success_url: `${process.env.BASE_URL}/success`,
        cancel_url: `${process.env.BASE_URL}/cancel`,
    });

    res.redirect(303, session.url);
});




async function fulfillCheckout(sessionId) {
    // Set your secret key. Remember to switch to your live secret key in production.
    // See your keys here: https://dashboard.stripe.com/apikeys
    const stripe = require('stripe')(config.stripe.secretKey);

    console.log('Fulfilling Checkout Session ' + sessionId);

    // TODO: Make this function safe to run multiple times,
    // even concurrently, with the same session ID

    // TODO: Make sure fulfillment hasn't already been
    // peformed for this Checkout Session

    // Retrieve the Checkout Session from the API with line_items expanded
    const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['line_items'],
    });

    // Check the Checkout Session's payment_status property
    // to determine if fulfillment should be peformed
    if (checkoutSession.payment_status !== 'unpaid') {
        // TODO: Perform fulfillment of the line items
        console.log("TODO BIEN TOKENS PAGADOS Y RELLENO TODO!");

        // TODO: Record/save fulfillment status for this
        // Checkout Session
    }

    console.log(checkoutSession);
}



// Route to fetch creations belonging to the current user
app.get('/createSlideShow', (req, res) => {

    var sortField = req.query.sortField || 'creationTime';
    const sortOrder = req.query.sortOrder === 'asc' ? 'asc' : 'desc';


    // Validate the sortField to prevent SQL injection
    const validSortFields = ['creationTime', 'likes']; // Add all valid sort fields
    if (!validSortFields.includes(sortField)) {
        sortField = 'creationTime';
    }

    var query = '';
    var param = '';
    const isAuthenticated = req.isAuthenticated();

    if (isAuthenticated) {
        param = req.user.id;
        query = `SELECT *, (select count(*) > 0 from votes where creationId = c.id and voterId = ?) as isLiked FROM creations c WHERE public = 1 ORDER BY ${sortField} ${sortOrder}`;
    } else {
        param = 0;
        query = `SELECT *, ? as isLiked FROM creations c WHERE public = 1 ORDER BY ${sortField} ${sortOrder}`;
    }
    console.info(query);

    db.all(query, [param], (err, rows) => {
        if (err) {
            console.error('Error fetching creations:', err);
            res.status(500).json({ error: 'An error occurred while fetching creations.' });
        } else {
            res.render('creationsGalleryContent', {
                isAuthenticated: isAuthenticated, //req.isAuthenticated,
                mainPartial: 'main-content-generateSlideShow',
                activePage: 'createSlideShow',
                creations: rows,
                sortField: sortField,
                sortOrder: sortOrder,
                isMyCreation: false
            });
            //res.json(rows); // Send the array of creations as JSON response
        }
    });
});



// Define a route for generating an image
app.post('/generate_slideshow', isAuthenticated, hasEnoughCredits, async (req, res) => {
    try {

        const { videoName, duration, fps, images } = req.body;

        const callback_url = "http://localhost:3000/task-complete"


        const baseURL = process.env.BASE_URL;
        const updatedImages = images.map(image => `${baseURL}${image}`);

        const data = {
            videoName,
            duration: parseInt(duration, 10),
            fps: parseInt(fps, 10),
            callback_url,
            images: updatedImages
        };

        const headers = {
            'Content-Type': 'application/json', // Specify the content type as JSON
            'Accept': '*/*'
        };


        // Make a POST request to the external API
        const response = await axios.post('http://localhost:5000/generateSlideshow/', JSON.stringify(data), { headers });
        //const response = await axios.post('https://api.getimg.ai/v1/stable-diffusion-xl/text-to-image', data, { headers });
        // get the image as a base64 string
        const jsonData = response.data;

        // Send the image tag content as a response
        res.send(jsonData);
    } catch (error) {
        // Handle errors
        console.error('Error fetching data:', error);
        res.status(500).json({ error: 'An error occurred while fetching data.' });
    }

});



// Route to render the chat page
app.get('/chat/:id', isAuthenticated, (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const chatId = userId + "-" + id;

        const isAuthenticated = req.isAuthenticated();

        const query = 'SELECT * FROM creations WHERE id = ? AND (userId = ? OR public = 1)';

        db.all(query, [id, userId], (err, rows) => {
            if (err) {
                console.error('Error fetching creations:', err);
                res.status(500).json({ error: 'An error occurred while fetching creations.' });
            } else {
                if (rows.length > 0) {
                    //retrieve chat history
                    // Fetch the newly created user
                    db.all(`SELECT * FROM chatContent WHERE chatId = ?`, [chatId], (err, chat) => {
                        if (err) {
                            return res.status(500).send('Error retrieving chat content');
                        }

                        const isMyCreation = userId == rows[0].userId;
                        res.render('creationChatContent', {
                            isAuthenticated: isAuthenticated,
                            mainPartial: 'main-content-chat',
                            activePage: 'chat',
                            creations: rows,
                            sortField: '',
                            sortOrder: '',
                            isMyCreation: isMyCreation,
                            chat: chat
                        });


                    });

                } else {
                    res.status(404).json({ error: 'The resource was not found. The requested creation does not exist or it does not belong to you and it is not made public.' });
                }

                //res.json(rows); // Send the array of creations as JSON response
            }
        });

    } catch (error) {
        console.error('Error fetching creation information:', error);
        res.status(500).send('Error fetching creation information');
    }
});

// Sleep function
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Chat route
app.post('/chat/:id', isAuthenticated, async (req, res) => {
    const message = req.body.message;
    const { id } = req.params;
    const userId = req.user.id;
    const chatId = userId + "-" + id;
    var sender = 'user'
    // Here you can process the message, save it to a database, etc.    
    //Save user message into database
    db.run('INSERT INTO chatContent (chatId, messageContent, sender) VALUES (?, ?, ?)'
        , [chatId, message, sender]
        , async (err) => {
            if (err) {
                return res.status(500).send('Error storing chat content');
            }
            //Get answer
            answer = await obtainMessageFromAgent(message);
            sender = 'ai'
            //save ai message into database
            db.run('INSERT INTO chatContent (chatId, messageContent, sender) VALUES (?, ?, ?)'
                , [chatId, answer, sender]
                , (err) => {
                    if (err) {
                        return res.status(500).send('Error storing chat answer');
                    }
                    res.json({ answer });

                });
        });


});



async function obtainMessageFromAgent(message) {
    await sleep(5000);
    return "i agree with u";
}

app.post('/creation_description_complete', (req, res) => {
    const creationId = req.body.creationId
    const answer = req.body.answer

    //Add the description to the creation
    //UPDATE users SET remainingCreations = ? WHERE id = ?
    db.run('UPDATE creations SET description = ? where id = ?'
                , [answer, creationId]
                , (err) => {
                    if (err) {
                        return res.status(500).send('Error storing description');
                    }
                    res.json({ answer });

                });

});

module.exports = app;





// // Start the server
// const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => {
//     console.log(`Server is running on http://localhost:${PORT}`);
// });
