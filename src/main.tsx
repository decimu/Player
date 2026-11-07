import React from "react";
import ReactDOM from "react-dom/client";
// フォントはアプリに同梱する（DESIGN.md: オフラインでも同じ見た目にするため）
import "@fontsource/m-plus-rounded-1c/500.css";
import "@fontsource/m-plus-rounded-1c/800.css";
// 時刻表示は数字だけなので英数字の分だけ
import "@fontsource/m-plus-1-code/latin-700.css";
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
