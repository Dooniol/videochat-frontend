import React, { useEffect, useRef, useState } from 'react';

const SIGNALING_SERVER_URL = 'wss://videochat-signaling-server.onrender.com';

export default function App() {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const containerRef = useRef(null);

  const pcRef = useRef(null);
  const wsRef = useRef(null);

  // Per accodare candidati ICE ricevuti prima di setRemoteDescription
  const pendingCandidatesRef = useRef([]);

  const [isConnected, setIsConnected] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [maximizedVideo, setMaximizedVideo] = useState(null); // 'local' | 'remote' | null

  // --- WebSocket e gestione signaling ---
  useEffect(() => {
    wsRef.current = new WebSocket(SIGNALING_SERVER_URL);

    wsRef.current.onopen = () => {
      console.log('WebSocket connected');
      setIsConnected(true);
    };

    wsRef.current.onmessage = async (message) => {
      try {
        let data;

        if (typeof message.data === 'string') {
          data = JSON.parse(message.data);
        } else if (message.data instanceof Blob) {
          console.warn('Ricevuto Blob via WebSocket, non è JSON:', message.data);
          return;
        } else {
          console.warn('Tipo di dato non previsto:', typeof message.data);
          return;
        }

        console.log('Messaggio WebSocket ricevuto:', data);

        switch (data.type) {
          case 'offer':
            await handleOffer(data.offer);
            break;
          case 'answer':
            await handleAnswer(data.answer);
            break;
          case 'candidate':
            if (data.candidate && pcRef.current) {
              if (pcRef.current.remoteDescription && pcRef.current.remoteDescription.type) {
                await pcRef.current.addIceCandidate(data.candidate);
                console.log('Ice candidate aggiunto:', data.candidate);
              } else {
                // Accoda candidato finché non c'è remote description
                console.log('Accodato candidato ICE in attesa di remote description:', data.candidate);
                pendingCandidatesRef.current.push(data.candidate);
              }
            }
            break;
          case 'hangup':
            endCall();
            break;
          case 'error':
            alert(`Errore server: ${data.message}`);
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
      if (inCall) endCall();
    };

    return () => {
      wsRef.current?.close();
      pcRef.current?.close();
      stopLocalStream();
    };
  }, []);

  // --- Helper: stop local media tracks ---
  function stopLocalStream() {
    if (localVideoRef.current?.srcObject) {
      localVideoRef.current.srcObject.getTracks().forEach((track) => track.stop());
      localVideoRef.current.srcObject = null;
    }
  }

  // --- Crea Peer Connection e gestisce eventi ---
  async function createPeerConnection() {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({ type: 'candidate', candidate: event.candidate })
        );
      }
    };

    pc.ontrack = (event) => {
      console.log('Evento ontrack ricevuto:', event);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    pcRef.current = pc;
  }

  // --- Start chiamata ---
  async function startCall() {
    await createPeerConnection();

    try {
      const localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream;
      }

      localStream.getTracks().forEach((track) => {
        pcRef.current.addTrack(track, localStream);
      });

      const offer = await pcRef.current.createOffer();
      await pcRef.current.setLocalDescription(offer);

      wsRef.current?.send(JSON.stringify({ type: 'offer', offer }));

      setInCall(true);
      setIsScreenSharing(false);
      setAudioEnabled(true);
      setVideoEnabled(true);
      setMaximizedVideo(null);
    } catch (err) {
      alert('Errore nell\'ottenere media locale: ' + err.message);
    }
  }

  // --- Handle offer (chiamata in ingresso) ---
  async function handleOffer(offer) {
    console.log('Ricevuto offer, setto remote description:', offer);

    await createPeerConnection();

    try {
      const localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream;
      }
      localStream.getTracks().forEach((track) => {
        pcRef.current.addTrack(track, localStream);
      });

      await pcRef.current.setRemoteDescription(offer);

      // Dopo setRemoteDescription aggiungiamo candidati pendenti
      for (const candidate of pendingCandidatesRef.current) {
        await pcRef.current.addIceCandidate(candidate);
        console.log('Ice candidate pendente aggiunto:', candidate);
      }
      pendingCandidatesRef.current = [];

      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);

      wsRef.current?.send(JSON.stringify({ type: 'answer', answer }));

      setInCall(true);
      setIsScreenSharing(false);
      setAudioEnabled(true);
      setVideoEnabled(true);
      setMaximizedVideo(null);
    } catch (err) {
      alert('Errore nell\'ottenere media locale per risposta: ' + err.message);
    }
  }

  // --- Handle answer ---
  async function handleAnswer(answer) {
    console.log('Ricevuto answer, setto remote description:', answer);
    if (pcRef.current) {
      await pcRef.current.setRemoteDescription(answer);

      // Anche qui aggiungiamo eventuali candidati pendenti (nel caso raro)
      for (const candidate of pendingCandidatesRef.current) {
        await pcRef.current.addIceCandidate(candidate);
        console.log('Ice candidate pendente aggiunto dopo answer:', candidate);
      }
      pendingCandidatesRef.current = [];
    }
  }

  // --- Termina chiamata ---
  function endCall() {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'hangup' }));
    }

    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    stopLocalStream();

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    setInCall(false);
    setIsScreenSharing(false);
    setMaximizedVideo(null);
    pendingCandidatesRef.current = [];
  }

  // --- Toggle Microfono ---
  function toggleAudio() {
    if (!localVideoRef.current?.srcObject) return;

    const audioTracks = localVideoRef.current.srcObject.getAudioTracks();
    if (audioTracks.length === 0) return;

    audioTracks[0].enabled = !audioTracks[0].enabled;
    setAudioEnabled(audioTracks[0].enabled);
  }

  // --- Toggle Video ---
  function toggleVideo() {
    if (!localVideoRef.current?.srcObject) return;

    const videoTracks = localVideoRef.current.srcObject.getVideoTracks();
    if (videoTracks.length === 0) return;

    videoTracks[0].enabled = !videoTracks[0].enabled;
    setVideoEnabled(videoTracks[0].enabled);
  }

  // --- Toggle Condivisione Schermo ---
async function toggleScreenShare() {
  if (isScreenSharing) {
    stopScreenShare();
    return;
  }

  try {
    // Acquisizione schermo con *eventuale* audio del sistema
    const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true  // ← importante!
    });

    // Acquisizione microfono
    const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Combina audio del sistema (se disponibile) + microfono
    const combinedStream = new MediaStream();

    // Aggiungi video dallo schermo
    screenStream.getVideoTracks().forEach((track) => {
      combinedStream.addTrack(track);
    });

    // Aggiungi tracce audio: prima microfono, poi (opzionale) audio di sistema
    micStream.getAudioTracks().forEach((track) => {
      combinedStream.addTrack(track);
    });

    screenStream.getAudioTracks().forEach((track) => {
      combinedStream.addTrack(track);
    });

    // Sostituisci tracce nel peer connection
    const videoSender = pcRef.current.getSenders().find((s) => s.track?.kind === 'video');
    const audioSender = pcRef.current.getSenders().find((s) => s.track?.kind === 'audio');

    if (videoSender) {
      await videoSender.replaceTrack(combinedStream.getVideoTracks()[0]);
    }

    if (audioSender && combinedStream.getAudioTracks().length > 0) {
      await audioSender.replaceTrack(combinedStream.getAudioTracks()[0]);
    }

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = combinedStream;
    }

    // Ferma la condivisione se l’utente chiude manualmente
    screenStream.getVideoTracks()[0].onended = () => {
      stopScreenShare();
    };

    setIsScreenSharing(true);
    setVideoEnabled(true);
  } catch (err) {
    alert('Errore nella condivisione schermo: ' + err.message);
  }
}


  function stopScreenShare() {
    if (!isScreenSharing) return;

    navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(async (stream) => {
      const videoTrack = stream.getVideoTracks()[0];

      const sender = pcRef.current.getSenders().find((s) => s.track.kind === 'video');
      if (sender) {
        await sender.replaceTrack(videoTrack);
      }

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      setIsScreenSharing(false);
    }).catch((err) => {
      alert('Errore nel ripristino webcam: ' + err.message);
    });
  }

  // --- Fullscreen container ---
  function toggleFullScreen() {
    if (!document.fullscreenElement && containerRef.current) {
      containerRef.current.requestFullscreen().catch((err) => {
        alert(`Errore nel fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  // --- Fullscreen singolo video su doppio click ---
  function toggleFullScreenVideo(videoRef) {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    if (!document.fullscreenElement) {
      videoElement.requestFullscreen().catch((err) => {
        alert(`Errore nel fullscreen video: ${err.message}`);
      });
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  // --- Ingrandisci solo un video (clic singolo) ---
  function maximizeVideo(which) {
    setMaximizedVideo(maximizedVideo === which ? null : which);
  }

  // --- UI ---
  return (
    <div style={styles.container} ref={containerRef}>
      <h1>Videochiamata 1:1 con Screen Sharing e Fullscreen</h1>

      <div style={{ marginBottom: 10 }}>
        <strong>Status:</strong>{' '}
        {!isConnected && 'Non connesso al signaling server'}
        {isConnected && !inCall && 'Connesso, pronto per chiamare'}
        {inCall && 'In chiamata'}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <video
          ref={localVideoRef}
          autoPlay
          muted
          playsInline
          style={{
            ...styles.video,
            border: maximizedVideo === 'local' ? '4px solid #4caf50' : '2px solid #ccc',
            flexGrow: maximizedVideo === 'local' ? 1 : 0,
            width: maximizedVideo === 'local' ? '80vw' : 160,
            height: maximizedVideo === 'local' ? '60vh' : 120,
            cursor: 'pointer',
          }}
          onClick={() => maximizeVideo('local')}
          onDoubleClick={() => toggleFullScreenVideo(localVideoRef)}
          title="Tuo video (clic singolo per ingrandire, doppio per fullscreen)"
        />

        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          style={{
            ...styles.video,
            border: maximizedVideo === 'remote' ? '4px solid #2196f3' : '2px solid #ccc',
            flexGrow: maximizedVideo === 'remote' ? 1 : 0,
            width: maximizedVideo === 'remote' ? '80vw' : 160,
            height: maximizedVideo === 'remote' ? '60vh' : 120,
            cursor: 'pointer',
          }}
          onClick={() => maximizeVideo('remote')}
          onDoubleClick={() => toggleFullScreenVideo(remoteVideoRef)}
          title="Video interlocutore (clic singolo per ingrandire, doppio per fullscreen)"
        />
      </div>

      <div style={{ marginTop: 15, display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        {!inCall && (
          <button onClick={startCall} disabled={!isConnected}>
            Avvia Chiamata
          </button>
        )}
        {inCall && (
          <>
            <button onClick={endCall}>Termina Chiamata</button>
            <button onClick={toggleAudio}>
              {audioEnabled ? 'Disattiva Microfono' : 'Attiva Microfono'}
            </button>
            <button onClick={toggleVideo}>
              {videoEnabled ? 'Disattiva Video' : 'Attiva Video'}
            </button>
            <button onClick={toggleScreenShare}>
              {isScreenSharing ? 'Interrompi Condivisione Schermo' : 'Condividi Schermo'}
            </button>
            <button onClick={toggleFullScreen}>Fullscreen Container</button>
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    textAlign: 'center',
    padding: 10,
  },
  video: {
    backgroundColor: '#000',
    borderRadius: 8,
    objectFit: 'cover',
  },
};