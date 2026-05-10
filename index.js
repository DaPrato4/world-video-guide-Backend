const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

// 1. Inizializza Firebase
const serviceAccount = require('./firebase-key.json');
const { Query } = require('firebase-admin/firestore');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Otteniamo il riferimento al database
const db = admin.firestore();

const app = express();
app.use(cors());
app.use(express.json());

// --- LA SENTINELLA (Event Listener) ---
console.log("Accensione sentinella Firestore in corso...");

db.collection('videos').onSnapshot((snapshot) => {
  snapshot.docChanges().forEach(async (change) => {
    
    const video = change.doc.data();
    const videoId = change.doc.id;

    if (change.type === 'modified' || change.type === 'added') {
      
      // 1. IL SALVAVITA: Se il video non è approvato, o se mancano dei dati fondamentali, fermati e passa oltre.
      if (video.status !== 'approved') return;
      if (!video.countryCode) {
        console.log(`Salto il video ${videoId}: è approvato ma gli manca il campo 'countryCode'.`);
        return; 
      }

      // 2. Se arriviamo qui, il video ha il paese ed è approvato. Controlliamo se abbiamo già inviato la notifica.
      if (!video.notifica_inviata) {
        
        // Mettiamo un fallback per il titolo nel caso manchi
        const titoloVideo = video.title || 'Nuovo video';
        console.log(`Trovato nuovo video approvato: ${titoloVideo} in ${video.countryCode}`);

        const countryCode = (video.countryCode > 99) ? video.countryCode.toString() : video.countryCode.toString().padStart(3, '0');
        const countryName = await fetch(`https://restcountries.com/v3.1/alpha/${countryCode}`).then(res => res.json()).then(data => data[0]?.name?.common);
        const topic = `country_${countryName.toLowerCase().replace(/\s+/g, '_')}`;

        const message = {
          topic: topic,
          data: {
            title: "Nuovo video disponibile!",
            body: `È stato appena approvato un nuovo video in ${countryName}`,
            url: `https://www.youtube.com/watch?v=${videoId}`,
            videoTitle: titoloVideo,
            countryCode: countryCode
          }
        };

        try {
          await admin.messaging().send(message);
          console.log(`Notifica inviata a tutti gli iscritti di ${topic}`);

          // Segniamo il video come notificato per non spammarlo di nuovo al prossimo riavvio
          await db.collection('videos').doc(videoId).update({
            notifica_inviata: true
          });

        } catch (error) {
          console.error(`Errore nell'invio della notifica per ${videoId}:`, error);
        }
      }
    }
  });
});

// Rotta per iscrivere un utente a un Topic
app.post('/api/subscribe', async (req, res) => {
  const { token, country, uid } = req.body;

  // Formattiamo il topic esattamente come fa la sentinella
  const topic = `country_${country.toLowerCase().replace(/\s+/g, '_')}`;

  try {
    // Il server usa firebase-admin per iscrivere il token al topic
    await admin.messaging().subscribeToTopic(token, topic);

    const userRef = admin.firestore().collection('users').doc(uid);
    await userRef.update({
      subscriptions: admin.firestore.FieldValue.arrayUnion(country)
    });

    console.log(`Token iscritto con successo al topic: ${topic}`);
    res.status(200).json({ success: true, message: `Iscritto a ${topic}` });
  } catch (error) {
    console.error('Errore di iscrizione al topic:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Rotta per DISISCRIVERE un utente da un Topic
app.post('/api/unsubscribe', async (req, res) => {
  const { token, country, uid } = req.body;
  const topic = `country_${country.toLowerCase().replace(/\s+/g, '_')}`;

  try {
    await admin.messaging().unsubscribeFromTopic(token, topic);

    const userRef = admin.firestore().collection('users').doc(uid);
    await userRef.update({
      subscriptions: admin.firestore.FieldValue.arrayRemove(country)
    });

    console.log(`Token disiscritto dal topic: ${topic}`);
    res.status(200).json({ success: true, message: `Disiscritto da ${topic}` });
  } catch (error) {
    console.error(' Errore disiscrizione al topic:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// rotta pewr disiscrivere un token da tutti i topic (es. quando l'utente si disconnette o elimina l'account)
app.post('/api/unsubscribeAll', async (req, res) => {
  const { token, uid } = req.body;

  try {
    const userRef = admin.firestore().collection('users').doc(uid);
    const userData = await userRef.get();
    const subscriptions = userData.data()?.subscriptions || [];

    const unsubscribePromises = subscriptions.map(async (country) => {
      const topic = `country_${country.toLowerCase().replace(/\s+/g, '_')}`;
      await admin.messaging().unsubscribeFromTopic(token, topic);
    });

    await Promise.all(unsubscribePromises);

    console.log(`Token disiscritto da tutti i topic`);
    res.status(200).json({ success: true, message: `Disiscritto da tutti i topic` });
  } catch (error) {
    console.error(' Errore disiscrizione da tutti i topic:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// rotta per iscrivere un token a tutti i topic (es. quando l'utente si connette)
app.post('/api/subscribeAll', async (req, res) => {
  const { token, uid } = req.body;

  try {
    const userRef = admin.firestore().collection('users').doc(uid);
    const userData = await userRef.get();
    const subscriptions = userData.data()?.subscriptions || [];

    const subscribePromises = subscriptions.map(async (country) => {
      const topic = `country_${country.toLowerCase().replace(/\s+/g, '_')}`;
      await admin.messaging().subscribeToTopic(token, topic);
      console.log(`Token iscritto al topic: ${topic}`);
    });

    await Promise.all(subscribePromises);

    console.log(`Token iscritto a tutti i topic`);
    res.status(200).json({ success: true, message: `Iscritto a tutti i topic` });
  } catch (error) {
    console.error(' Errore iscrizione a tutti i topic:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/', (req, res) => {
  res.send('Server in ascolto. La sentinella è attiva sui video!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server acceso sulla porta ${PORT}`);
});