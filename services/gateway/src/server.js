import express from 'express';

const app = express();

const PORT = 8081;

app.use(express.json({limit:'21kb'})); // limit body

app.use((req, res, next) => {

  console.log(`[Gateway] ${req.method} ${req.path}`) // log method and path
  next(); // transfer request to other middleware or route 

});

// check gateway
app.get('/health', (req, res) => {
  // Gửi HTTP 200 và một JSON response về cho Postman.
  res.status(200).json({
    service: 'gateway',
    status: 'healthy',
  });
});


app.use((req, res) => {
  res.status(404).json({
    error: 'ROUTE_NOT_FOUND',
    message: 'Đường dẫn API không tồn tại.',
  });
});

// listen port
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Gateway đang chạy tại http://127.0.0.1:${PORT}`);
});