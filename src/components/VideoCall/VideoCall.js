import React, { useRef, useState } from "react";
import useWebRTCHandlers from "../../hooks/useWebRTCHandlers";
import styles from "./VideoCall.module.css"; // opzionale

export default function VideoCall({ roomId }) {
  // Ref ai vari video element e container
  const containerRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteSmallRef = useRef(null);
  const screenVideoRef = useRef(null);

  // Stato posizione finestrella remota (drag & drop)
  const [remotePos, setRemotePos] = useState({ x: 20, y: 20 });

  // Stato per video massimizzato (local o remote)
  const [maximizedVideo, setMaximizedVideo] = useState(null);

  // Dragging refs
  const draggingRef = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  // Hook custom con funzioni e stati
  const {
    startCall,
    endCall,
    toggleScreenShare,
    toggleFullScreen,
    toggleAudio,
    toggleVideo,
    isScreenSharing,
    inCall,
    isFullScreen,
    isConnected,
    audioEnabled,
    videoEnabled,
    mainStreamType,
    pipPosition,
    setPipPosition,
  } = useWebRTCHandlers(roomId, {
    localVideoRef,
    remoteVideoRef,
    remoteSmallRef,
    screenVideoRef,
    containerRef,
    setRemotePos,
  });

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

    // Limiti finestra
    if (newX < 0) newX = 0;
    if (newY < 0) newY = 0;
    if (newX > window.innerWidth - 200) newX = window.innerWidth - 200;
    if (newY > window.innerHeight - 150) newY = window.innerHeight - 150;

    setRemotePos({ x: newX, y: newY });
  }

  function onMouseUp() {
    draggingRef.current = false;
  }

  // Toggle massimizzazione video locale/remoto
  function onVideoClick(type) {
    setMaximizedVideo((prev) => (prev === type ? null : type));
  }

  // Classi condizionali per video massimizzato
  const localVideoClass = maximizedVideo === "local" ? styles.maximized : "";
  const remoteVideoClass = maximizedVideo === "remote" ? styles.maximized : "";

  // Gestione drag & drop per picture-in-picture (pipPosition)
  function handleDragPip(e) {
    e.stopPropagation();
    draggingRef.current = true;
    dragOffset.current = {
      x: e.clientX - pipPosition.left,
      y: e.clientY - pipPosition.top,
    };
  }
  function handleMovePip(e) {
    if (!draggingRef.current) return;
    let newLeft = e.clientX - dragOffset.current.x;
    let newTop = e.clientY - dragOffset.current.y;

    if (newLeft < 0) newLeft = 0;
    if (newTop < 0) newTop = 0;
    if (newLeft > window.innerWidth - 200) newLeft = window.innerWidth - 200;
    if (newTop > window.innerHeight - 150) newTop = window.innerHeight - 150;

    setPipPosition({ top: newTop, left: newLeft });
  }
  function handleUpPip() {
    draggingRef.current = false;
  }

  // Toggle tra main stream camera / screen share
  function toggleMainStream() {
    if (mainStreamType === "camera") {
      if (isScreenSharing) {
        // passiamo a screen share già attivo
        // nel nostro hook, se vogliamo, si può migliorare questo toggle
      }
    } else {
      // passa a camera
    }
  }

  return (
    <div
      className="app-container"
      ref={containerRef}
      onMouseMove={(e) => {
        onMouseMove(e);
        handleMovePip(e);
      }}
      onMouseUp={() => {
        onMouseUp();
        handleUpPip();
      }}
      onMouseLeave={() => {
        onMouseUp();
        handleUpPip();
      }}
    >
      <header className="app-header">Video Chat React - Fullscreen & Sharing</header>

      <div className="status-bar">
        Stato WebSocket: <strong>{isConnected ? "Connesso" : "Disconnesso"}</strong> —{" "}
        Chiamata: <strong>{inCall ? "Attiva" : "Nessuna"}</strong>
      </div>

      <div className="videos-container">
        {mainStreamType === "camera" ? (
          <>
            {/* Video locale principale */}
            <div className={`video-main ${localVideoClass}`} onClick={() => onVideoClick("local")}>
              <video ref={localVideoRef} autoPlay muted playsInline />
            </div>

            {/* Picture-in-Picture screen share */}
            {isScreenSharing && (
              <div
                className="video-pip"
                style={{ top: pipPosition.top, left: pipPosition.left, position: "fixed", cursor: "move" }}
                onMouseDown={handleDragPip}
                onClick={toggleMainStream}
                role="button"
                tabIndex={0}
                aria-label="Sposta o ingrandisci condivisione schermo"
              >
                <video ref={screenVideoRef} autoPlay muted playsInline />
              </div>
            )}
          </>
        ) : (
          <>
            {/* Video screen share principale */}
            <div className="video-main" onClick={() => onVideoClick("screen")}>
              <video ref={screenVideoRef} autoPlay muted playsInline />
            </div>

            {/* Picture-in-Picture camera */}
            <div
              className="video-pip"
              style={{ top: pipPosition.top, left: pipPosition.left, position: "fixed", cursor: "move" }}
              onMouseDown={handleDragPip}
              onClick={toggleMainStream}
              role="button"
              tabIndex={0}
              aria-label="Sposta o ingrandisci webcam"
            >
              <video ref={localVideoRef} autoPlay muted playsInline />
            </div>
          </>
        )}
      </div>

      {/* Finestrella remota mobile se fullscreen, sharing e in call */}
      {isFullScreen && isScreenSharing && inCall && (
        <div
          className="remote-small-window"
          style={{ top: remotePos.y, left: remotePos.x, position: "fixed", cursor: "move" }}
          onMouseDown={onMouseDown}
          role="button"
          tabIndex={0}
          aria-label="Sposta video remoto"
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

      <div className="controls">
        {!inCall ? (
          <button onClick={startCall} title="Avvia chiamata" className="btn btn-start">
            ▶️ Avvia
          </button>
        ) : (
          <>
            <button
              onClick={toggleAudio}
              title={audioEnabled ? "Disattiva microfono" : "Attiva microfono"}
              className="btn"
            >
              {audioEnabled ? "🎤" : "🔇"}
            </button>

            <button
              onClick={toggleVideo}
              title={videoEnabled ? "Disattiva videocamera" : "Attiva videocamera"}
              className="btn"
            >
              {videoEnabled ? "📷" : "🚫"}
            </button>

            <button
              onClick={toggleScreenShare}
              title={isScreenSharing ? "Ferma condivisione schermo" : "Condividi schermo"}
              className="btn"
            >
              {isScreenSharing ? "🛑" : "🖥️"}
            </button>

            <button
              onClick={toggleFullScreen}
              title={isFullScreen ? "Esci da fullscreen" : "Fullscreen"}
              className="btn"
            >
              {isFullScreen ? "🡼" : "🡾"}
            </button>

            <button
              onClick={endCall}
              title="Termina chiamata"
              className="btn btn-end-call"
              style={{ background: "#c0392b", color: "#fff" }}
            >
              ❌
            </button>
          </>
        )}
      </div>

      <footer className="app-footer">Realizzato con React & WebRTC — </footer>
    </div>
  );
}
