const { app } = require('./app');
const { PORT } = require('./config');

app.listen(PORT, () => {
  console.log(`BetLab backend listening on http://localhost:${PORT}`);
});
