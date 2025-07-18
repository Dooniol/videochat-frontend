import React, { useEffect, useRef, useState } from "react";

const SIGNALING_SERVER_URL = "wss://videochat-signaling-server.onrender.com";

export default function App() {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const containerRef = useRef(null);
  const remoteSmallRef = useRef(null);
  const screenVideoRef = useRef(null); // AGGIUNTO

  const pcRef = useRef(null);
  const wsRef = useRef(null);
  const pendingCandidatesRef = useRef([]);

  const [isConnected, setIsConnected] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [maximizedVideo, setMaximizedVideo] = useState(null); // 'local' | 'remote' | null
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [mainStreamType, setMainStreamType] = useState("camera");
  const [roomId, setRoomId] = useState("default-room");

  const [pipPosition, setPipPosition] = useState({ top: 20, left: 20 });

  // Posizione finestrella remota draggable
  const [remotePos, setRemotePos] = useState({ x: 20, y: 20 });
  const draggingRef = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  // ─── Conserva lo stream locale per poterlo poi silenziare/masterizzare ───
  const [localStream, setLocalStream] = useState(null);

  // ─── Funzione per trascinare il PIP ───
  const handleDrag = (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;

    const handleMouseMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      setPipPosition((prev) => ({
        top: Math.max(0, prev.top + dy),
        left: Math.max(0, prev.left + dx),
      }));
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  // ─── Funzione per attivare/disattivare il microfono ───
  const toggleAudio = () => {
    if (!localStream) return;
    localStream.getAudioTracks().forEach((track) => {
      track.enabled = !audioEnabled;
    });
    setAudioEnabled((prev) => !prev);
  };

  // ─── Funzione per attivare/disattivare la webcam ───
  const toggleVideo = () => {
    if (!localStream) return;
    localStream.getVideoTracks().forEach((track) => {
      track.enabled = !videoEnabled;
    });
    setVideoEnabled((prev) => !prev);
  };

  // ─── Switcha tra camera in grande e PIP (screen share) ───
  const toggleMainStream = () => {
    setMainStreamType((prev) => (prev === "camera" ? "screen" : "camera"));
  };

  useEffect(() => {
    wsRef.current = new WebSocket(SIGNALING_SERVER_URL);

    wsRef.current.onopen = () => {
      console.log("WebSocket connected");
      setIsConnected(true);
    };

    wsRef.current.onmessage = async (message) => {
      try {
        let data;

        if (typeof message.data === "string") {
          data = JSON.parse(message.data);
        } else {
          return;
        }

        switch (data.type) {
          case "offer":
            await handleOffer(data.offer);
            break;
          case "answer":
            await handleAnswer(data.answer);
            break;
          case "candidate":
            if (data.candidate && pcRef.current) {
              if (
                pcRef.current.remoteDescription &&
                pcRef.current.remoteDescription.type
              ) {
                await pcRef.current.addIceCandidate(data.candidate);
              } else {
                pendingCandidatesRef.current.push(data.candidate);
              }
            }
            break;
          case "hangup":
            endCall();
            break;
          case "error":
            alert(`Errore server: ${data.message}`);
            break;
        }
      } catch (e) {
        console.error("Error handling message", e);
      }
    };

    wsRef.current.onerror = (err) => {
      console.error("WebSocket error:", err);
    };

    wsRef.current.onclose = () => {
      setIsConnected(false);
      if (inCall) endCall();
    };

    return () => {
      wsRef.current?.close();
      pcRef.current?.close();
      stopLocalStream();
    };
  }, []);

  function stopLocalStream() {
    if (localVideoRef.current?.srcObject) {
      localVideoRef.current.srcObject
        .getTracks()
        .forEach((track) => track.stop());
      localVideoRef.current.srcObject = null;
    }
    setLocalStream(null);
  }

  async function createPeerConnection() {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({ type: "candidate", candidate: event.candidate })
        );
      }
    };

    pc.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
      if (remoteSmallRef.current) {
        // stessa sorgente per finestrella remota (utile in fullscreen)
        remoteSmallRef.current.srcObject = event.streams[0];
      }
    };

    pcRef.current = pc;
  }

  async function startCall() {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error("WebSocket non connesso.");
      return;
    }

    if (!roomId) {
      console.error("roomId non definito.");
      return;
    }

    try {
      await createPeerConnection();

      const localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      setLocalStream(localStream);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream;
      }

      const peerConnection = pcRef.current;
      if (!peerConnection) {
        console.error("Peer connection non inizializzata.");
        return;
      }

      // Aggiunge le tracce dello stream locale alla peer connection
      localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
      });

      // Crea l'offerta SDP
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      // Invia l'offerta tramite WebSocket
      wsRef.current.send(
        JSON.stringify({
          type: "offer",
          offer: offer,
          roomId: roomId,
        })
      );

      console.log("✅ Offerta inviata. Chiamata avviata.");
    } catch (error) {
      console.error("❌ Errore durante l'avvio della chiamata:", error);
      alert("Impossibile accedere a webcam o microfono. Controlla i permessi.");
    }
  }

  async function handleOffer(offer) {
    await createPeerConnection();

    try {
      const localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      if (localVideoRef.current) localVideoRef.current.srcObject = localStream;

      localStream.getTracks().forEach((track) => {
        pcRef.current.addTrack(track, localStream);
      });

      await pcRef.current.setRemoteDescription(offer);

      for (const candidate of pendingCandidatesRef.current) {
        await pcRef.current.addIceCandidate(candidate);
      }
      pendingCandidatesRef.current = [];

      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);

      wsRef.current?.send(JSON.stringify({ type: "answer", answer }));

      setInCall(true);
      setIsScreenSharing(false);
      setAudioEnabled(true);
      setVideoEnabled(true);
      setMaximizedVideo(null);
    } catch (err) {
      alert("Errore nell'ottenere media locale per risposta: " + err.message);
    }
  }

  async function handleAnswer(answer) {
    if (pcRef.current) {
      await pcRef.current.setRemoteDescription(answer);

      for (const candidate of pendingCandidatesRef.current) {
        await pcRef.current.addIceCandidate(candidate);
      }
      pendingCandidatesRef.current = [];
    }
  }

  function endCall() {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "hangup" }));
    }

    pcRef.current?.close();
    pcRef.current = null;
    stopLocalStream();

    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (remoteSmallRef.current) remoteSmallRef.current.srcObject = null;

    setInCall(false);
    setIsScreenSharing(false);
    setMaximizedVideo(null);
    setIsFullScreen(false);
    pendingCandidatesRef.current = [];
  }

  async function toggleScreenShare() {
    if (isScreenSharing) {
      // Se la condivisione dello schermo è attiva, interrompila
      stopScreenShare();
      return;
    }

    try {
      // ✅ Richiede l'accesso al contenuto dello schermo (può includere l'audio di sistema su alcuni browser)
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true, // L'audio potrebbe non essere disponibile su tutti i browser o sistemi
      });

      // ✅ Richiede il microfono separatamente per poterlo combinare con lo screen share
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      // ✅ Crea un nuovo MediaStream che combinerà audio e video da sorgenti diverse
      const combinedStream = new MediaStream();

      // ✅ Aggiunge la traccia video dello schermo
      screenStream.getVideoTracks().forEach((track) => {
        combinedStream.addTrack(track);
      });

      // ✅ Aggiunge la traccia audio dal microfono
      micStream.getAudioTracks().forEach((track) => {
        combinedStream.addTrack(track);
      });

      // ❌ Non aggiungiamo anche l'audio dello schermo per evitare duplicati o echo
      // Se necessario (es. per registrare anche l'audio di un video YouTube condiviso), puoi scommentare:
      /*
    screenStream.getAudioTracks().forEach((track) => {
      combinedStream.addTrack(track);
    });
    */

      // ✅ Trova i sender WebRTC attivi per video e audio
      const videoSender = pcRef.current
        .getSenders()
        .find((s) => s.track?.kind === "video");

      const audioSender = pcRef.current
        .getSenders()
        .find((s) => s.track?.kind === "audio");

      // ✅ Sostituisce la traccia video con quella del nuovo stream (schermo)
      if (videoSender && combinedStream.getVideoTracks().length > 0) {
        await videoSender.replaceTrack(combinedStream.getVideoTracks()[0]);
      }

      // ✅ Sostituisce la traccia audio con quella combinata (microfono)
      if (audioSender && combinedStream.getAudioTracks().length > 0) {
        await audioSender.replaceTrack(combinedStream.getAudioTracks()[0]);
      }

      // ✅ Aggiorna il video locale per mostrare lo stream combinato (utile per feedback visivo all'utente)
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = combinedStream;
      }

      // ✅ (Opzionale) Mostra anche lo stream dello schermo in un secondo player, se presente
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = screenStream;
      }

      // ✅ Se l'utente interrompe la condivisione dallo strumento di sistema, la fermiamo anche noi
      screenStream.getVideoTracks()[0].onended = () => stopScreenShare();

      // ✅ Aggiorniamo lo stato dell'applicazione
      setIsScreenSharing(true); // Indica che lo screen share è attivo
      setVideoEnabled(true); // Riattiva il flag per il video (se era disabilitato)
    } catch (err) {
      // ❌ Gestione degli errori (permessi negati, problemi con il dispositivo)
      alert("Errore nella condivisione schermo: " + err.message);
      console.error("Errore durante screen share:", err);
    }
  }

  function stopScreenShare() {
    // Se non stiamo condividendo lo schermo, esci subito
    if (!isScreenSharing) return;

    // Richiedi di nuovo webcam e microfono
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then(async (stream) => {
        // Prendi la traccia video dalla webcam (prima traccia video disponibile)
        const videoTrack = stream.getVideoTracks()[0];

        // Trova il sender WebRTC che invia il video attualmente
        const sender = pcRef.current
          .getSenders()
          .find((s) => s.track?.kind === "video");

        // Se trovato, sostituisci la traccia video attiva con quella della webcam
        if (sender) await sender.replaceTrack(videoTrack);

        // Aggiorna il video locale per mostrare il feed webcam
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;

        // Rimuovi il feed dello schermo dall'elemento video dedicato (se presente)
        if (screenVideoRef.current) screenVideoRef.current.srcObject = null;

        // Aggiorna lo stato per indicare che la condivisione schermo è terminata
        setIsScreenSharing(false);
      })
      .catch((err) => {
        // Gestione errori (ad esempio, permessi negati o problemi hardware)
        alert("Errore nel ripristino webcam: " + err.message);
        console.error("Errore stopScreenShare:", err);
      });
  }

  // Fullscreen a tutto schermo container o video local/remote
  // Fullscreen a tutto schermo container o video local/remote
  async function toggleFullScreen() {
    try {
      if (!document.fullscreenElement) {
        if (containerRef.current?.requestFullscreen) {
          await containerRef.current.requestFullscreen();
          setIsFullScreen(true);
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
          setIsFullScreen(false);
        }
      }
    } catch (err) {
      console.error("Errore durante il toggle fullscreen:", err);
    }
  }

  // Drag & drop finestrella remota
  function onMouseDown(e) {
    draggingRef.current = true;
    dragOffset.current = {
      x: e.clientX - remotePos.x,
      y: e.clientY - remotePos.y,
    };
  }

  function onMouseMove(e) {
    if (!draggingRef.current) return;
    let newX = e.clientX - dragOffset.current.x;
    let newY = e.clientY - dragOffset.current.y;

    // Limiti base (non uscire dallo schermo)
    if (newX < 0) newX = 0;
    if (newY < 0) newY = 0;
    if (newX > window.innerWidth - 200) newX = window.innerWidth - 200;
    if (newY > window.innerHeight - 150) newY = window.innerHeight - 150;

    setRemotePos({ x: newX, y: newY });
  }

  function onMouseUp() {
    draggingRef.current = false;
  }

  /**
   * Gestisce il “fullscreen” in-page (massimizza il container video selezionato).
   * @param {'local'|'remote'} type
   */
  function onVideoClick(type) {
    setMaximizedVideo((prev) => (prev === type ? null : type));
  }

  return (
    <>
      <style>{`
  * {
  box-sizing: border-box;
}

body, html, #root {
  margin: 0;
  padding: 0;
  height: 100%;
  background: #1c1c2e;
  color: #ddd;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  user-select: none;
  overflow: hidden;
}

.app-container {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: linear-gradient(135deg, #2a2450, #1c1c2e);
  padding: 12px;
  position: relative;
}
.app-container::before {
  content: "";
  height: 6px;
  width: 100%;
  background: linear-gradient(90deg, #7a0bc0, #b54fe1);
  position: absolute;
  top: 0;
  left: 0;
}

header {
  font-size: 1.5rem;
  font-weight: 700;
  text-align: center;
  margin-bottom: 8px;
  letter-spacing: 0.1em;
  color: #b54fe1;
  text-shadow: 0 0 8px #a057d5;
}

.status {
  text-align: center;
  margin-bottom: 10px;
  font-weight: 600;
  color: #8e7cc3;
}

.videos-container {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  gap: 10px;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
}

.video-wrapper {
  position: relative;
  flex: 1 1 auto;
  max-width: 48%;
  max-height: 48%;
  overflow: hidden;
  border-radius: 12px;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.3);
  transition: all 0.3s ease;
  cursor: zoom-in;
}

video {
  border-radius: 12px;
  background: black;
  cursor: pointer;
  object-fit: cover;
  transition: box-shadow 0.3s ease;
  box-shadow: 0 0 4px #5533aa;
  max-height: 300px;
  max-width: 45vw;
  user-select: none;
}

video:hover {
  box-shadow: 0 0 16px #b54fe1;
}

.video-maximized {
  position: absolute !important;
  top: 0;
  left: 0;
  width: 100% !important;
  height: 100% !important;
  z-index: 10;
  max-width: 100% !important;
  max-height: 100% !important;
  border: 3px solid #9c4dcc;
  background-color: black;
  cursor: zoom-out;
}

.local-video {
  border: 2px solid #5e3aae;
}

.remote-video {
  border: 2px solid #b54fe1;
}

.remote-small-window {
  position: fixed;
  width: 180px;
  height: 135px;
  border: 2px solid #b54fe1;
  border-radius: 12px;
  overflow: hidden;
  background: #2a2450;
  box-shadow: 0 0 12px #b54fe1;
  cursor: grab;
  z-index: 9999;
  user-select: none;
  /* Imposta top/left inline da React */
}

.controls {
  display: flex;
  justify-content: center;
  margin-top: 12px;
  gap: 12px;
}

button {
  border: none;
  background: #5e3aae;
  color: white;
  padding: 12px;
  border-radius: 50%;
  font-size: 1.2rem;
  width: 56px;
  height: 56px;
  box-shadow: 0 0 12px #7a0bc0;
  cursor: pointer;
  transition: background-color 0.3s ease, transform 0.2s ease;
  display: flex;
  justify-content: center;
  align-items: center;
}

button:hover {
  background: #b54fe1;
  transform: scale(1.1);
  box-shadow: 0 0 20px #d48eff;
}

button:active {
  transform: scale(0.95);
}

button:focus {
  outline: 2px solid #b54fe1;
  outline-offset: 2px;
}

button.disabled {
  background: #44415a;
  cursor: not-allowed;
  box-shadow: none;
}

footer {
  margin-top: 14px;
  text-align: center;
  font-size: 0.9rem;
  color: #7b70a7;
}

        `}</style>

      <div
        className="app-container"
        ref={containerRef}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <header>Video Chat React - Fullscreen & Sharing</header>

        <div className="status">
          Stato WebSocket: {isConnected ? "Connesso" : "Disconnesso"} —
          Chiamata: {inCall ? "Attiva" : "Nessuna"}
        </div>

        <div className="videos-container">
          {mainStreamType === "camera" ? (
            <>
              {/* CAMERA IN GRANDE */}
              <div className="video-main">
                <video ref={localVideoRef} autoPlay muted playsInline />
              </div>

              {/* SCREEN SHARE IN PIP */}
              {isScreenSharing && (
                <div
                  className="video-pip"
                  style={{ top: pipPosition.top, left: pipPosition.left }}
                  onMouseDown={handleDrag}
                  onClick={toggleMainStream}
                >
                  <video ref={screenVideoRef} autoPlay muted playsInline />
                </div>
              )}
            </>
          ) : (
            <>
              {/* SCREEN SHARE IN GRANDE */}
              <div className="video-main">
                <video ref={screenVideoRef} autoPlay muted playsInline />
              </div>

              {/* CAMERA IN PIP */}
              <div
                className="video-pip"
                style={{ top: pipPosition.top, left: pipPosition.left }}
                onMouseDown={handleDrag}
                onClick={toggleMainStream}
              >
                <video ref={localVideoRef} autoPlay muted playsInline />
              </div>
            </>
          )}
        </div>

        {/* Finestrella remota mobile solo se fullscreen e condivisione schermo */}
        {isFullScreen && isScreenSharing && inCall && (
          <div
            className="remote-small-window"
            style={{ top: remotePos.y, left: remotePos.x }}
            onMouseDown={onMouseDown}
          >
            <video
              ref={remoteSmallRef}
              autoPlay
              muted
              playsInline
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </div>
        )}
      </div>

      <div className="controls">
        {!inCall ? (
          <button onClick={startCall} title="Avvia chiamata">
            ▶️ Avvia
          </button>
        ) : (
          <>
            {/* Microfono */}
            <button
              onClick={toggleAudio}
              title={audioEnabled ? "Disattiva microfono" : "Attiva microfono"}
            >
              {audioEnabled ? "🎤" : "🔇"}
            </button>

            {/* Videocamera */}
            <button
              onClick={toggleVideo}
              title={
                videoEnabled ? "Disattiva videocamera" : "Attiva videocamera"
              }
            >
              {videoEnabled ? "📷" : "🚫"}
            </button>

            {/* Condivisione schermo */}
            <button
              onClick={toggleScreenShare}
              title={
                isScreenSharing
                  ? "Ferma condivisione schermo"
                  : "Condividi schermo"
              }
            >
              {isScreenSharing ? "🛑" : "🖥️"}
            </button>

            {/* Fullscreen */}
            <button
              onClick={toggleFullScreen}
              title={isFullScreen ? "Esci da fullscreen" : "Fullscreen"}
            >
              {isFullScreen ? "🡼" : "🡾"}
            </button>

            {/* Termina chiamata */}
            <button
              onClick={endCall}
              title="Termina chiamata"
              style={{ background: "#c0392b", color: "#fff" }}
            >
              ❌
            </button>
          </>
        )}
      </div>

      <footer>
        Realizzato con React & WebRTC —{" "}
        <small>Trascina la finestra della webcam remota in fullscreen</small>
      </footer>
    </>
  );
}
