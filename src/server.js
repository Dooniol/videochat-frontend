const WebSocket = require('ws');

// In App.js o dove apri WS:
const signalingServerUrl = 'wss://your-signaling-server.onrender.com';
const wss = new WebSocket(signalingServerUrl);


/*
  Manteniamo una lista semplice di client collegati.
  Poiché vogliamo chiamate solo 1:1, ogni messaggio da un client
  viene mandato direttamente all'altro client.
*/

let clients = [];

wss.on('connection', (ws) => {
  if (clients.length >= 2) {
    // Limitiamo a 2 utenti connessi per ora
    ws.send(JSON.stringify({ type: 'error', message: 'Server pieno, solo 2 utenti permessi' }));
    ws.close();
    return;
  }

  clients.push(ws);
  console.log('Client connesso, totale:', clients.length);

  ws.on('message', (message) => {
    // Inoltra il messaggio all'altro client (se presente)
    const otherClient = clients.find(client => client !== ws);
    if (otherClient && otherClient.readyState === WebSocket.OPEN) {
      otherClient.send(message);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnesso');
    clients = clients.filter(client => client !== ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket errore:', err);
  });
});

console.log('Signaling server WebSocket avviato sulla porta 8080');
