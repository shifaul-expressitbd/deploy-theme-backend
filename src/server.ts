import app from './app';
const HOST = process.env.HOST || 'localhost';
const PORT = process.env.PORT || 4444;

app.listen(Number(PORT), HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
}); 