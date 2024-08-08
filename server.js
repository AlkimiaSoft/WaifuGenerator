const app = require('./backend/app');
const http = require('http');

// Create the server instance
const server = http.createServer(app);

// Start listening on the specified port
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});