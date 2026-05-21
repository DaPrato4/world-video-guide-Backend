const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

// Inizializza Firebase
const serviceAccount = require('./firebase-key.json');
const { Query } = require('firebase-admin/firestore');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Riferimento a Firestore
const db = admin.firestore();

const app = express();
app.use(cors());
app.use(express.json());

// Sentinella: ascolta i cambiamenti nella collection 'videos'
console.log('Avvio listener Firestore sulla collection "videos"...');

db.collection('videos').onSnapshot((snapshot) => {
  snapshot.docChanges().forEach(async (change) => {
    const video = change.doc.data();
    const videoId = change.doc.id;

    if (change.type === 'modified' || change.type === 'added') {
      // Skip se il video non è approvato o manca il paese
      if (video.status !== 'approved') return;
      if (!video.countryCode) {
        console.log(`Salto il video ${videoId}: manca 'countryCode'.`);
        return;
      }

      // Se non è stata ancora inviata la notifica, costruisci e invia i messaggi
      if (!video.notifitaion_sent) {
        // Recupera titolo YouTube
        const resYoutube = await fetch(`https://www.youtube.com/oembed?url=${video.url}&format=json`);
        const titoloVideo = (await resYoutube.json()).title || 'Nuovo video';
        console.log(`Nuovo video approvato: ${titoloVideo} (${video.countryCode})`);

        const countryCode = (video.countryCode > 99)
          ? video.countryCode.toString()
          : video.countryCode.toString().padStart(3, '0');
        const countryName = await fetch(`https://restcountries.com/v3.1/alpha/${countryCode}`)
          .then(res => res.json())
          .then(data => data[0]?.name?.common);
        const topic = `country_${countryName.toLowerCase().replace(/\s+/g, '_')}`;

        const messageVideo = {
          topic,
          data: {
            title: 'Nuovo video disponibile!',
            body: `È stato appena approvato un nuovo video in ${countryName}`,
            url: `https://www.youtube.com/watch?v=${videoId}`,
            videoTitle: titoloVideo,
            countryCode
          }
        };

        const messagePersonal = {
          topic: `user_${video.submittedBy}`,
          data: {
            title: 'Video approvato!',
            body: `Il tuo video ${titoloVideo ? `"${titoloVideo}"` : ''} è stato approvato.`,
            url: `https://www.youtube.com/watch?v=${videoId}`,
            videoTitle: titoloVideo,
            countryCode
          }
        };

        try {
          await admin.messaging().send(messageVideo);
          console.log(`Notifica inviata al topic ${topic}`);
          await admin.messaging().send(messagePersonal);
          console.log(`Notifica inviata all'utente ${video.submittedBy}`);

          // Segna il video come notificato
          await db.collection('videos').doc(videoId).update({
            notifitaion_sent: true
          });
        } catch (error) {
          console.error(`Errore invio notifiche per ${videoId}:`, error);
        }
      }
    }
  });
});

// Route: iscrizione a un topic paese
app.post('/api/subscribe', async (req, res) => {
  const { token, country, uid } = req.body;
  const topic = `country_${country.toLowerCase().replace(/\s+/g, '_')}`;

  try {
    await admin.messaging().subscribeToTopic(token, topic);

    const userRef = admin.firestore().collection('users').doc(uid);
    await userRef.update({
      subscriptions: admin.firestore.FieldValue.arrayUnion(country)
    });

    console.log(`Token iscritto al topic: ${topic}`);
    res.status(200).json({ success: true, message: `Iscritto a ${topic}` });
  } catch (error) {
    console.error('Errore iscrizione al topic:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Route: rimozione iscrizione da un topic paese
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
    console.error('Errore disiscrizione:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Route: rimuove un token da tutti i topic dell'utente (es. logout)
app.post('/api/unsubscribeAll', async (req, res) => {
  const { token, uid } = req.body;

  try {
    const personalTopic = `user_${uid}`;
    await admin.messaging().unsubscribeFromTopic(token, personalTopic);
    console.log(`Token disiscritto dal topic personale: ${personalTopic}`);

    const userRef = admin.firestore().collection('users').doc(uid);
    const userData = await userRef.get();
    const subscriptions = userData.data()?.subscriptions || [];

    const unsubscribePromises = subscriptions.map(async (country) => {
      const topic = `country_${country.toLowerCase().replace(/\s+/g, '_')}`;
      await admin.messaging().unsubscribeFromTopic(token, topic);
    });

    await Promise.all(unsubscribePromises);

    console.log('Token disiscritto da tutti i topic');
    res.status(200).json({ success: true, message: 'Disiscritto da tutti i topic' });
  } catch (error) {
    console.error('Errore durante unsubscribeAll:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Route: iscrive un token a tutti i topic preferiti dell'utente (es. login)
app.post('/api/subscribeAll', async (req, res) => {
  const { token, uid } = req.body;

  try {
    const personalTopic = `user_${uid}`;
    await admin.messaging().subscribeToTopic(token, personalTopic);
    console.log(`Token iscritto al topic personale: ${personalTopic}`);

    const userRef = admin.firestore().collection('users').doc(uid);
    const userData = await userRef.get();
    const subscriptions = userData.data()?.subscriptions || [];

    const subscribePromises = subscriptions.map(async (country) => {
      const topic = `country_${country.toLowerCase().replace(/\s+/g, '_')}`;
      await admin.messaging().subscribeToTopic(token, topic);
      console.log(`Token iscritto al topic: ${topic}`);
    });

    await Promise.all(subscribePromises);

    console.log('Token iscritto a tutti i topic');
    res.status(200).json({ success: true, message: 'Iscritto a tutti i topic' });
  } catch (error) {
    console.error('Errore durante subscribeAll:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check
app.get('/', (req, res) => {
  res.send('Server in ascolto. La sentinella è attiva sui video!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server acceso sulla porta ${PORT}`);
});