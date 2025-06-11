import React, { useEffect, useRef, useState } from 'react';

const SIGNALING_SERVER_URL = 'wss://videochat-signaling-server.onrender.com';

export default function App() {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const containerRef = useRef(null);

  const pcRef = useRef(null);
  const wsRef = useRef(null);

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
    if (localVideoRef.current && localVideoRef.current.srcObject) {
      localVideoRef.current.srcObject.getTracks().forEach((track) => track.stop());
      localVideoRef.current.srcObject = null;
    }
  }

  // --- Crea Peer Connection e gestisce eventi ---
  async function createPeerConnection() {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
      ],
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        wsRef.current.send(
          JSON.stringify({ type: 'candidate', candidate: event.candidate })
        );
      }
    };

    pc.ontrack = (event) => {
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

      // Aggiungo tracce locali al peer connection
      localStream.getTracks().forEach((track) => {
        pcRef.current.addTrack(track, localStream);
      });

      const offer = await pcRef.current.createOffer();
      await pcRef.current.setLocalDescription(offer);

      wsRef.current.send(JSON.stringify({ type: 'offer', offer }));

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
    await createPeerConnection();

    try {
      const localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream;
      }
      localStream.getTracks().forEach((track) => {
        pcRef.current.addTrack(track, localStream);
      });

      await pcRef.current.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);

      wsRef.current.send(JSON.stringify({ type: 'answer', answer }));

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
    await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
  }

  // --- Termina chiamata ---
  function endCall() {
    wsRef.current.send(JSON.stringify({ type: 'hangup' }));

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
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });

      const screenTrack = screenStream.getVideoTracks()[0];

      // Sostituisco la traccia video locale con quella dello schermo
      const sender = pcRef.current.getSenders().find((s) => s.track.kind === 'video');
      sender.replaceTrack(screenTrack);

      // Quando termina condivisione schermo (utente chiude la condivisione)
      screenTrack.onended = () => {
        stopScreenShare();
      };

      // Aggiorno video locale a mostrare condivisione schermo
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = screenStream;
      }

      setIsScreenSharing(true);
      setVideoEnabled(true);
    } catch (err) {
      alert('Errore nella condivisione schermo: ' + err.message);
    }
  }

  function stopScreenShare() {
    if (!isScreenSharing) return;

    // Torna al video della webcam
    navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((stream) => {
      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];

      // Sostituisco la traccia video nel peer connection
      const sender = pcRef.current.getSenders().find((s) => s.track.kind === 'video');
      sender.replaceTrack(videoTrack);

      // Aggiorno video locale
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      setIsScreenSharing(false);
    });
  }

  // --- Fullscreen container ---
  function toggleFullScreen() {
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch((err) => {
        alert(`Errore nel fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
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
      document.exitFullscreen();
    }
  }

  // --- Ingrandisci solo un video (clic singolo) ---
  function maximizeVideo(which) {
    if (maximizedVideo === which) {
      setMaximizedVideo(null);
    } else {
      setMaximizedVideo(which);
    }
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
          ...styles.videosContainer,
          flexDirection: maximizedVideo ? 'column' : 'row',
        }}
      >
        {(maximizedVideo === null || maximizedVideo === 'local') && (
          <div
            style={{
              ...styles.videoWrapper,
              flex: maximizedVideo === 'local' ? 1 : '1 1 45%',
            }}
          >
            <h3>Video Locale</h3>
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              style={{
                ...styles.video,
                cursor: 'pointer',
                width: '100%',
                height: maximizedVideo === 'local' ? '80vh' : 'auto',
              }}
              onClick={() => maximizeVideo('local')}
              onDoubleClick={() => toggleFullScreenVideo(localVideoRef)}
            />
          </div>
        )}

        {(maximizedVideo === null || maximizedVideo === 'remote') && (
          <div
            style={{
              ...styles.videoWrapper,
              flex: maximizedVideo === 'remote' ? 1 : '1 1 45%',
            }}
          >
            <h3>Video Remoto</h3>
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              style={{
                ...styles.video,
                cursor: 'pointer',
                width: '100%',
                height: maximizedVideo === 'remote' ? '80vh' : 'auto',
              }}
              onClick={() => maximizeVideo('remote')}
              onDoubleClick={() => toggleFullScreenVideo(remoteVideoRef)}
            />
          </div>
        )}
      </div>

      <div style={styles.buttonsContainer}>
        {!inCall && (
          <button onClick={startCall} disabled={!isConnected} style={styles.button}>
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

            <button onClick={toggleScreenShare} style={styles.button}>
              {isScreenSharing ? 'Ferma Condivisione Schermo' : 'Condividi Schermo'}
            </button>

            <button onClick={toggleFullScreen} style={styles.button}>
              {document.fullscreenElement ? 'Esci Fullscreen' : 'Fullscreen'}
            </button>

            {maximizedVideo && (
              <button onClick={() => setMaximizedVideo(null)} style={styles.button}>
                Esci Ingrandimento
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    fontFamily: 'Arial, sans-serif',
    maxWidth: 900,
    margin: 'auto',
    padding: 20,
    textAlign: 'center',
  },
  videosContainer: {
    display: 'flex',
    justifyContent: 'space-around',
    marginBottom: 20,
    flexWrap: 'nowrap',
    alignItems: 'center',
  },
  videoWrapper: {
    marginBottom: 10,
  },
  video: {
    maxHeight: 480,
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
