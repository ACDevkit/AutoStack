import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Copy } from "lucide-react";

export default function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();

    win.isMaximized().then(setIsMaximized).catch(() => {});

    let unlisten: (() => void) | undefined;
    win
      .onResized(async () => {
        try {
          setIsMaximized(await win.isMaximized());
        } catch {
          // ignore
        }
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      unlisten?.();
    };
  }, []);

  function handleMinimize() {
    getCurrentWindow().minimize().catch(() => {});
  }

  function handleToggleMaximize() {
    getCurrentWindow().toggleMaximize().catch(() => {});
  }

  function handleClose() {
    getCurrentWindow().close().catch(() => {});
  }

  return (
    <div className="flex items-stretch shrink-0 -mr-4">
      {/* Minimize */}
      <button
        onClick={handleMinimize}
        className="w-11 h-12 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
        title="Minimize"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>

      {/* Maximize / Restore */}
      <button
        onClick={handleToggleMaximize}
        className="w-11 h-12 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
        title={isMaximized ? "Restore" : "Maximize"}
      >
        {isMaximized ? (
          <Copy className="w-3 h-3" />
        ) : (
          <Square className="w-3 h-3" />
        )}
      </button>

      {/* Close */}
      <button
        onClick={handleClose}
        className="w-11 h-12 flex items-center justify-center text-muted-foreground hover:text-white hover:bg-red-600 transition-colors"
        title="Close"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
