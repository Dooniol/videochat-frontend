import { useEffect, useState, useRef } from "react";

const SIGNALING_SERVER_URL = "wss://videochat-signaling-server.onrender.com";

export default function useWebRTCHandlers(roomId, refsAndSetters) {
  const {
    wsRef,
    pcRef,
    localVideoRef,
    remoteVideoRef,
    remoteSmallRef,
    screenVideoRef,
    setIsConnected,
    setLocalStream,
    setInCall,
    setIsScreenSharing,
    setAudioEnabled,
    setVideoEnabled,
    setMaximizedVideo,
    setIsFullScreen,
    pendingCandidatesRef,
    localStream,
    audioEnabled,
    videoEnabled,
    setMainStreamType,
    containerRef,
    remotePos,
    setRemotePos,
    draggingRef,
    dragOffset,
  } = {
    wsRef: useRef(null),
    pcRef: useRef(null),
    ...refsAndSetters,
  };

  // Stati locali interni
  const [inCall, setInCallLocal] = useState(false);
  const [isConnected, setIsConnectedLocal] = useState(false);
  const [isScreenSharingLocal, setIsScreenSharingLocal] = useState(false);
  const [audioEnabledLocal, setAudioEnabledLocal] = useState(true);
  const [videoEnabledLocal, setVideoEnabledLocal] = useState(true);
  const [mainStreamType, setMainStreamTypeLocal] = useState("camera"); // "camera" | "screen"
  const [isFullScreenLocal, setIsFullScreenLocal] = useState(false);
  const [pipPosition, setPipPosition] = useState({ top: 10, left: 10 });

  // Pending ICE candidates buffer
  if (!pendingCandidatesRef.current) pendingCandidatesRef.current = [];

  // Sincronizza setState esterni se forniti
  useEffect(() => {
    if (setInCall) setInCall(inCall);
    if (setIsConnected) setIsConnected(isConnected);
    if (setIsScreenSharing) setIsScreenSharing(isScreenSharingLocal);
    if (setAudioEnabled) setAudioEnabled(audioEnabledLocal);
    if (setVideoEnabled) setVideoEnabled(videoEnabledLocal);
    if (setMainStreamType) setMainStreamType(mainStreamType);
    if (setIsFullScreen) setIsFullScreen(isFullScreenLocal);
  }, [
    inCall,
    isConnected,
    isScreenSharingLocal,
    audioEnabledLocal,
    videoEnabledLocal,
    mainStreamType,
    isFullScreenLocal,
    setInCall,
    setIsConnected,
    setIsScreenSharing,
    setAudioEnabled,
    setVideoEnabled,
    setMainStreamType,
    setIsFullScreen,
  ]);

  // FUNZIONE: crea e configura RTCPeerConnection
  function createPeerConnection() {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    // ICE candidate locale
    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({ type: "candidate", candidate: event.candidate, roomId })
        );
      }
    };

    // Ricezione stream remoto
    pc.ontrack = (event) => {
      console.log("Remote track received", event.streams);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
      if (remoteSmallRef.current) {
        remoteSmallRef.current.srcObject = event.streams[0];
      }
    };

    pcRef.current = pc;
    return pc;
  }

  // FUNZIONE: start call (ottieni stream locale e crea offer)
  async function startCall() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      const pc = createPeerConnection();

      // Aggiungi stream locale a peer connection
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Invia offer via websocket
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "offer", offer, roomId }));
      }

      setInCallLocal(true);
      setAudioEnabledLocal(true);
      setVideoEnabledLocal(true);
      setMainStreamTypeLocal("camera");
      setIsScreenSharingLocal(false);
    } catch (err) {
      console.error("Errore startCall:", err);
    }
  }

  // FUNZIONE: handle offerta (ricevuta)
  async function handleOffer(offer) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      const pc = createPeerConnection();

      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      // Aggiungi pending candidates
      for (const candidate of pendingCandidatesRef.current) {
        await pc.addIceCandidate(candidate);
      }
      pendingCandidatesRef.current = [];

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "answer", answer, roomId }));
      }

      setInCallLocal(true);
      setAudioEnabledLocal(true);
      setVideoEnabledLocal(true);
      setMainStreamTypeLocal("camera");
      setIsScreenSharingLocal(false);
    } catch (err) {
      console.error("Errore handleOffer:", err);
    }
  }

  // FUNZIONE: handle answer (ricevuta)
  async function handleAnswer(answer) {
    try {
      if (!pcRef.current) return;
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));

      // Aggiungi pending ICE candidate ora che remote description è settata
      for (const candidate of pendingCandidatesRef.current) {
        await pcRef.current.addIceCandidate(candidate);
      }
      pendingCandidatesRef.current = [];
    } catch (err) {
      console.error("Errore handleAnswer:", err);
    }
  }

  // FUNZIONE: termina chiamata, chiudi peer connection e stream
  function endCall() {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    if (localVideoRef.current?.srcObject) {
      localVideoRef.current.srcObject.getTracks().forEach((t) => t.stop());
      localVideoRef.current.srcObject = null;
    }

    if (remoteVideoRef.current?.srcObject) {
      remoteVideoRef.current.srcObject.getTracks().forEach((t) => t.stop());
      remoteVideoRef.current.srcObject = null;
    }

    setLocalStream(null);
    setInCallLocal(false);
    setIsScreenSharingLocal(false);
    setAudioEnabledLocal(false);
    setVideoEnabledLocal(false);
    setMainStreamTypeLocal("camera");
  }

  // Toggle audio e video
  function toggleAudio() {
    if (!localStream) return;
    localStream.getAudioTracks().forEach((t) => (t.enabled = !audioEnabledLocal));
    setAudioEnabledLocal(!audioEnabledLocal);
  }

  function toggleVideo() {
    if (!localStream) return;
    localStream.getVideoTracks().forEach((t) => (t.enabled = !videoEnabledLocal));
    setVideoEnabledLocal(!videoEnabledLocal);
  }

  // Toggle fullscreen
  function toggleFullScreen() {
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullScreenLocal(true));
    } else {
      document.exitFullscreen().then(() => setIsFullScreenLocal(false));
    }
  }

  // Toggle screen sharing (solo se in call)
  async function toggleScreenShare() {
    if (!inCall) return;

    if (isScreenSharingLocal) {
      // Stop screen share, torna a camera
      if (screenVideoRef.current?.srcObject) {
        screenVideoRef.current.srcObject.getTracks().forEach((t) => t.stop());
        screenVideoRef.current.srcObject = null;
      }

      if (localVideoRef.current?.srcObject) {
        // Riattiva videocamera normale
        localVideoRef.current.srcObject = localStream;
      }

      setIsScreenSharingLocal(false);
      setMainStreamTypeLocal("camera");
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
        });

        if (screenVideoRef.current) {
          screenVideoRef.current.srcObject = screenStream;
        }

        // Aggiungi tracce screen share alla peer connection
        screenStream.getTracks().forEach((track) => {
          if (pcRef.current) {
            pcRef.current.addTrack(track, screenStream);
          }
        });

        setIsScreenSharingLocal(true);
        setMainStreamTypeLocal("screen");
      } catch (err) {
        console.error("Errore toggleScreenShare:", err);
      }
    }
  }

  // Gestione drag del video small (remoto)
  function onMouseDown(e) {
    draggingRef.current = true;
    dragOffset.current = {
      x: e.clientX - remotePos.left,
      y: e.clientY - remotePos.top,
    };
  }

  function onMouseMove(e) {
    if (!draggingRef.current) return;
    let left = e.clientX - dragOffset.current.x;
    let top = e.clientY - dragOffset.current.y;

    // Limita la posizione nel container (evita di uscire)
    const containerRect = containerRef.current.getBoundingClientRect();
    const maxLeft = containerRect.width - 150; // supponendo video piccolo 150x100
    const maxTop = containerRect.height - 100;

    if (left < 0) left = 0;
    if (top < 0) top = 0;
    if (left > maxLeft) left = maxLeft;
    if (top > maxTop) top = maxTop;

    setRemotePos({ left, top });
  }

  function onMouseUp() {
    draggingRef.current = false;
  }

  // gestione eventi websocket e messaggi
  useEffect(() => {
    wsRef.current = new WebSocket(SIGNALING_SERVER_URL);

    wsRef.current.onopen = () => {
      console.log("WebSocket connected");
      wsRef.current.send(JSON.stringify({ type: "join", roomId }));
    };

    wsRef.current.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      //console.log("Message from signaling server:", data);

      switch (data.type) {
        case "offer":
          await handleOffer(data.offer);
          break;

        case "answer":
          await handleAnswer(data.answer);
          break;

        case "candidate":
          try {
            const candidate = new RTCIceCandidate(data.candidate);
            if (pcRef.current?.remoteDescription) {
              await pcRef.current.addIceCandidate(candidate);
            } else {
              // se la remote description non c'è ancora, metto in pending
              pendingCandidatesRef.current.push(candidate);
            }
          } catch (err) {
            console.error("Errore aggiunta candidate:", err);
          }
          break;

        case "hangup":
          endCall();
          break;

        default:
          break;
      }
    };

    wsRef.current.onclose = () => {
      console.log("WebSocket closed");
      setIsConnectedLocal(false);
      endCall();
    };

    wsRef.current.onerror = (err) => {
      console.error("WebSocket error", err);
    };

    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [roomId]);

  // Ritorna tutte le funzioni e stati necessari a VideoCall
  return {
    startCall,
    endCall,
    handleOffer,
    handleAnswer,
    toggleAudio,
    toggleVideo,
    toggleScreenShare,
    toggleFullScreen,

    inCall,
    isConnected,
    isScreenSharing: isScreenSharingLocal,
    audioEnabled: audioEnabledLocal,
    videoEnabled: videoEnabledLocal,
    mainStreamType,
    isFullScreen: isFullScreenLocal,
    pipPosition: remotePos,
    setPipPosition: setRemotePos,

    onMouseDown,
    onMouseMove,
    onMouseUp,
  };
}
