import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initMedia } from "./lib/api";
import "./styles.css";

initMedia()
  .catch((e) => console.error("動画サーバーに接続できません", e))
  .finally(() => {
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  });
