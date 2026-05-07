const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors()); // Permette a React di connettersi
app.use(express.json()); // Permette di leggere i dati che React invierà

// Creiamo una prima "rotta" di prova
app.get('/', (req, res) => {
  res.send('Ciao! Il server Express sta funzionando alla grande!');
});

// Accendiamo il server sulla porta 3000
app.listen(3000, () => {
  console.log('Server acceso: vai su http://localhost:3000');
});