
import app from './app.js';


const PORT = 8081;


app.listen(PORT, '127.0.0.1', () => {
  console.log(`Gateway đang chạy tại http://127.0.0.1:${PORT}`);
});