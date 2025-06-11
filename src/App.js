import React, { useEffect, useRef, useState } from 'react';

const SIGNALING_SERVER_URL = 'wss://videochat-signaling-server.onrender.com';

export default function App() {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const containerRef = useRef(null);

  const pcRef = useRef(null);
  const wsRef = useRef(null);
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
                console.log('Remote description non ancora settata, candidato salvato in pending');
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

      // Aggiungi i candidati pendenti
      for (const candidate of pendingCandidatesRef.current) {
        try {
          await pcRef.current.addIceCandidate(candidate);
        } catch (e) {
          console.error('Errore aggiungendo candidato pendente:', e);
        }
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

      // Aggiungi i candidati pendenti
      for (const candidate of pendingCandidatesRef.current) {
        try {
          await pcRef.current.addIceCandidate(candidate);
        } catch (e) {
          console.error('Errore aggiungendo candidato pendente:', e);
        }
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

      const sender = pcRef.current.getSenders().find((s) => s.track.kind === 'video');
      if (sender) {
        await sender.replaceTrack(screenTrack);
      }

      screenTrack.onended = () => {
        stopScreenShare();
      };

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
    setMaximizedVideo(maximizedVideo === which ? null : which);
  }

  // --- UI ---
  return (
    <div
      ref={containerRef}
      className={`container ${maximizedVideo === 'local' ? 'max-local' : ''} ${maximizedVideo === 'remote' ? 'max-remote' : ''}`}
      style={{ width: '100vw', height: '100vh', backgroundColor: 'black', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
    >
      <h1 style={{ color: 'white' }}>Video Chat</h1>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginBottom: 10 }}>
        {!inCall && (
          <button onClick={startCall} disabled={!isConnected}>
            Avvia chiamata
          </button>
        )}
        {inCall && (
          <>
            <button onClick={endCall}>Termina chiamata</button>
            <button onClick={toggleAudio}>{audioEnabled ? 'Disattiva microfono' : 'Attiva microfono'}</button>
            <button onClick={toggleVideo}>{videoEnabled ? 'Disattiva video' : 'Attiva video'}</button>
            <button onClick={toggleScreenShare}>{isScreenSharing ? 'Ferma condivisione schermo' : 'Condividi schermo'}</button>
          </>
        )}
        <button onClick={toggleFullScreen}>Fullscreen finestra</button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
        <video
          ref={localVideoRef}
          autoPlay
          muted
          playsInline
          onClick={() => maximizeVideo('local')}
          onDoubleClick={() => toggleFullScreenVideo(localVideoRef)}
          style={{
            width: maximizedVideo === 'local' ? '80vw' : '300px',
            height: maximizedVideo === 'local' ? '80vh' : '225px',
            backgroundColor: 'black',
            cursor: 'pointer',
            border: '2px solid white',
          }}
        />

        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          onClick={() => maximizeVideo('remote')}
          onDoubleClick={() => toggleFullScreenVideo(remoteVideoRef)}
          style={{
            width: maximizedVideo === 'remote' ? '80vw' : '300px',
            height: maximizedVideo === 'remote' ? '80vh' : '225px',
            backgroundColor: 'black',
            cursor: 'pointer',
            border: '2px solid white',
          }}
        />
      </div>
    </div>
  );
}
