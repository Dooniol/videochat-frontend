import React, { useEffect, useRef, useState } from 'react';

const SIGNALING_SERVER_URL = 'ws://localhost:8080';

export default function App() {
  // Riferimenti ai video locali e remoti
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  // Riferimento alla connessione WebRTC
  const pcRef = useRef(null);

  // Riferimento alla connessione WebSocket
  const wsRef = useRef(null);

  // Stato generale chiamata
  const [isConnected, setIsConnected] = useState(false);  // WebSocket connesso
  const [inCall, setInCall] = useState(false);            // Siamo in chiamata
  const [isScreenSharing, setIsScreenSharing] = useState(false); // Schermo condiviso
  const [audioEnabled, setAudioEnabled] = useState(true);  // Microfono attivo
  const [videoEnabled, setVideoEnabled] = useState(true);  // Video attivo

  // Stream locale per manipolare tracce audio/video
  const localStreamRef = useRef(null);

  // useEffect di inizializzazione: connessione WebSocket signaling
  useEffect(() => {
    wsRef.current = new WebSocket(SIGNALING_SERVER_URL);

    wsRef.current.onopen = () => {
      console.log('WebSocket connected');
      setIsConnected(true);
    };

    wsRef.current.onmessage = async (message) => {
      try {
        const data = JSON.parse(message.data);
        console.log('Received:', data);

        switch (data.type) {
          case 'offer':
            await handleOffer(data.offer);
            break;
          case 'answer':
            await handleAnswer(data.answer);
            break;
          case 'candidate':
            if (data.candidate) {
              await pcRef.current?.addIceCandidate(data.candidate);
            }
            break;
          case 'hangup':
            // L'altro peer ha terminato la chiamata
            endCall();
            break;
          default:
            console.warn('Unknown message type:', data.type);
        }
      } catch (e) {
        console.error('Error handling message', e);
      }
    };

    wsRef.current.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    wsRef.current.onclose = () => {
      console.log('WebSocket closed');
      setIsConnected(false);
      // Se siamo in chiamata, termina tutto
      if (inCall) endCall();
    };

    // Cleanup al dismount
    return () => {
      wsRef.current?.close();
      pcRef.current?.close();
      stopLocalStream();
    };
  }, []);

  // Funzione per creare e configurare la connessione WebRTC
  async function createPeerConnection() {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendMessage({ type: 'candidate', candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      console.log('Remote track received');
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('PeerConnection state:', pc.connectionState);
      // Se la connessione si chiude o fallisce, termina la chiamata
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        endCall();
      }
    };

    pcRef.current = pc;
  }

  // Funzione di invio messaggi al signaling server
  function sendMessage(message) {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }

  // Ottiene lo stream locale (audio/video)
  async function getLocalStream() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      return stream;
    } catch (e) {
      console.error('Error accessing local media', e);
      alert('Impossibile accedere a microfono o webcam.');
      throw e;
    }
  }

  // Avvia chiamata: crea connessione, stream e invia offerta
  async function startCall() {
    if (!isConnected) {
      alert('Non sei connesso al signaling server.');
      return;
    }
    await createPeerConnection();

    const stream = await getLocalStream();

    // Aggiunge tracce locali alla PeerConnection
    stream.getTracks().forEach(track => pcRef.current.addTrack(track, stream));

    // Crea offerta SDP
    const offer = await pcRef.current.createOffer();
    await pcRef.current.setLocalDescription(offer);

    sendMessage({ type: 'offer', offer });
    setInCall(true);
  }

  // Gestisce offerta ricevuta: risponde con answer
  async function handleOffer(offer) {
    if (!isConnected) return;
    await createPeerConnection();

    const stream = await getLocalStream();

    stream.getTracks().forEach(track => pcRef.current.addTrack(track, stream));

    await pcRef.current.setRemoteDescription(new RTCSessionDescription(offer));

    const answer = await pcRef.current.createAnswer();
    await pcRef.current.setLocalDescription(answer);

    sendMessage({ type: 'answer', answer });
    setInCall(true);
  }

  // Gestisce risposta answer ricevuta
  async function handleAnswer(answer) {
    if (!pcRef.current) return;
    await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
  }

  // Gestione ICE candidate ricevuti
  // (già fatto dentro onmessage)

  // Funzione per terminare chiamata
  function endCall() {
    console.log('Call ended');
    setInCall(false);
    setIsScreenSharing(false);
    setAudioEnabled(true);
    setVideoEnabled(true);

    // Chiudo connessione WebRTC
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    // Pulisco video remoto
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    // Ferma stream locale
    stopLocalStream();

    // Invia messaggio hangup all'altro peer (se connesso)
    sendMessage({ type: 'hangup' });
  }

  // Funzione che ferma lo stream locale (microfono e webcam)
  function stopLocalStream() {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
  }

  // Muta o attiva microfono
  function toggleAudio() {
    if (!localStreamRef.current) return;
    const enabled = !audioEnabled;
    localStreamRef.current.getAudioTracks().forEach(track => {
      track.enabled = enabled;
    });
    setAudioEnabled(enabled);
  }

  // Disabilita o abilita video
  function toggleVideo() {
    if (!localStreamRef.current) return;
    const enabled = !videoEnabled;
    localStreamRef.current.getVideoTracks().forEach(track => {
      track.enabled = enabled;
    });
    setVideoEnabled(enabled);
  }

  // Avvia o ferma la condivisione dello schermo
  async function toggleScreenShare() {
    if (!pcRef.current) return;

    if (isScreenSharing) {
      // Torna alla webcam
      await stopScreenShare();
    } else {
      // Avvia condivisione schermo
      await startScreenShare();
    }
  }

  // Inizio condivisione schermo sostituendo track video
  async function startScreenShare() {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });

      const sender = pcRef.current.getSenders().find(s => s.track.kind === 'video');
      if (sender) {
        sender.replaceTrack(screenStream.getVideoTracks()[0]);
      }

      // Quando l'utente smette di condividere lo schermo
      screenStream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
      };

      // Mostra nel video locale lo schermo condiviso
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = screenStream;
      }

      setIsScreenSharing(true);
      setVideoEnabled(true);
    } catch (e) {
      console.error('Errore condivisione schermo:', e);
      alert('Impossibile condividere lo schermo.');
    }
  }

  // Ferma condivisione schermo e torna webcam
  async function stopScreenShare() {
    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
      const sender = pcRef.current.getSenders().find(s => s.track.kind === 'video');
      if (sender) {
        sender.replaceTrack(videoStream.getVideoTracks()[0]);
      }
      localStreamRef.current = videoStream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = videoStream;
      }
      setIsScreenSharing(false);
      setVideoEnabled(true);
    } catch (e) {
      console.error('Errore stop condivisione schermo:', e);
    }
  }

  return (
    <div style={styles.container}>
      <h1>App Videochiamata 1:1 con Screen Sharing</h1>

      {/* Stato della connessione */}
      <div style={{ marginBottom: 10 }}>
        <strong>Status:</strong>{' '}
        {!isConnected && 'Non connesso al signaling server'}
        {isConnected && !inCall && 'Connesso, pronto per chiamare'}
        {inCall && 'In chiamata'}
      </div>

      <div style={styles.videosContainer}>
        {/* Video locale */}
        <div>
          <h3>Video Locale</h3>
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            style={styles.video}
          />
        </div>

        {/* Video remoto */}
        <div>
          <h3>Video Remoto</h3>
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            style={styles.video}
          />
        </div>
      </div>

      {/* Pulsanti chiamata e controllo */}
      <div style={styles.buttonsContainer}>
        {!inCall && (
          <button
            onClick={startCall}
            disabled={!isConnected}
            style={styles.button}
          >
            Avvia Chiamata
          </button>
        )}

        {inCall && (
          <>
            <button onClick={endCall} style={styles.buttonRed}>
              Termina Chiamata
            </button>

            <button onClick={toggleAudio} style={styles.button}>
              {audioEnabled ? 'Disattiva Microfono' : 'Attiva Microfono'}
            </button>

            <button onClick={toggleVideo} style={styles.button}>
              {videoEnabled ? 'Disattiva Video' : 'Attiva Video'}
            </button>

            <button
              onClick={toggleScreenShare}
              style={styles.button}
            >
              {isScreenSharing ? 'Ferma Condivisione Schermo' : 'Condividi Schermo'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// Stili semplici in JS
const styles = {
  container: {
    fontFamily: 'Arial, sans-serif',
    maxWidth: 800,
    margin: 'auto',
    padding: 20,
    textAlign: 'center',
  },
  videosContainer: {
    display: 'flex',
    justifyContent: 'space-around',
    marginBottom: 20,
    flexWrap: 'wrap',
  },
  video: {
    width: 320,
    height: 240,
    backgroundColor: '#000',
    borderRadius: 8,
  },
  buttonsContainer: {
    display: 'flex',
    justifyContent: 'center',
    gap: 15,
    flexWrap: 'wrap',
  },
  button: {
    padding: '10px 15px',
    fontSize: 14,
    cursor: 'pointer',
    borderRadius: 4,
    border: '1px solid #333',
    backgroundColor: '#eee',
  },
  buttonRed: {
    padding: '10px 15px',
    fontSize: 14,
    cursor: 'pointer',
    borderRadius: 4,
    border: '1px solid #900',
    backgroundColor: '#fdd',
    color: '#900',
  },
};
