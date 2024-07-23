const app = require('./backend/app');
const http = require('http');

http.createServer(app).listen(process.env.PORT);