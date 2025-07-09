import React from "react";
import VideoCall from "./components/VideoCall";

export default function App() {
  return (
    <div className="app-root">
      {/* Puoi aggiungere qui eventuali header globali o navbar */}

      {/* Componente principale della videochiamata */}
      <VideoCall />

      {/* Eventuali footer o altre sezioni globali */}
    </div>
  );
}
