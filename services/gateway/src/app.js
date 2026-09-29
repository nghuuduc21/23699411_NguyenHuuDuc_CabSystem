import express from 'express';


const app = express();


app.use(express.json({ limit: '21kb' }));


app.use((req, res, next) => {
  console.log(`[Gateway] ${req.method} ${req.path}`);


  next();
});


app.get('/health', (req, res) => {
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


export default app;