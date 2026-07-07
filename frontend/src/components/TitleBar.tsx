import { Minus, Square, X, Github } from "lucide-react";
import {
  WindowMinimise,
  WindowToggleMaximise,
  Quit,
} from "../../wailsjs/runtime/runtime";
import type { GlobalStats } from "@/lib/api";

// Solid frameless title bar. The whole bar drags the window; interactive
// controls opt out with .app-no-drag. pl-20 reserves space for the macOS
// traffic-light buttons. The count readout is the instrument's signature,
// in monospace.
export function TitleBar({
  stats,
  onOpenRepo,
}: {
  stats: GlobalStats | null;
  onOpenRepo: () => void;
}) {
  return (
    <header className="app-draggable flex h-11 shrink-0 items-center justify-between border-b border-border bg-head-bg pl-20 pr-2">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
          <span className="text-sm font-semibold tracking-[0.18em]">CARCASS</span>
        </div>
        <span className="hairline h-4 w-px self-center border-l" />
        <span className="eyebrow hidden sm:inline">
          acquisition · verifiable pairing · pavic/ufpi
        </span>
      </div>

      <div className="flex items-center gap-3">
        <div className="telemetry hidden items-center gap-4 text-[11px] text-muted-foreground lg:flex">
          <span>
            CARCASSES <span className="text-foreground">{stats?.carcasses ?? 0}</span>
          </span>
          <span>
            IMAGES <span className="text-foreground">{stats?.images ?? 0}</span>
          </span>
          <span>
            GRADED <span className="text-primary">{stats?.graded ?? 0}</span>
          </span>
        </div>

        <div className="app-no-drag flex items-center gap-1">
          <WindowButton onClick={onOpenRepo} title="Repository">
            <Github className="h-3.5 w-3.5" />
          </WindowButton>
          <span className="hairline mx-1 h-4 w-px self-center border-l" />
          <WindowButton onClick={WindowMinimise} title="Minimize">
            <Minus className="h-3.5 w-3.5" />
          </WindowButton>
          <WindowButton onClick={WindowToggleMaximise} title="Maximize">
            <Square className="h-3 w-3" />
          </WindowButton>
          <WindowButton onClick={Quit} danger title="Close">
            <X className="h-3.5 w-3.5" />
          </WindowButton>
        </div>
      </div>
    </header>
  );
}

function WindowButton({
  children,
  onClick,
  danger,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground ${
        danger ? "hover:bg-destructive hover:text-white" : "hover:bg-secondary"
      }`}
    >
      {children}
    </button>
  );
}
