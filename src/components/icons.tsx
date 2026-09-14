// Tiny inline SVG icon set — stroke icons, currentColor, no dependency.

interface P {
  size?: number;
}

function I({ size = 18, children }: P & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconLedger = (p: P) => (
  <I {...p}><path d="M4 5h16M4 10h16M4 15h10M4 20h7" /></I>
);

export const IconInvoice = (p: P) => (
  <I {...p}><path d="M6 3h9l4 4v14l-2.5-1.5L14 21l-2-1.3L10 21l-2.5-1.5L5 21V3z" /><path d="M9 8h6M9 12h6M9 16h4" /></I>
);

export const IconPlus = (p: P) => (
  <I {...p}><path d="M12 5v14M5 12h14" /></I>
);

export const IconBox = (p: P) => (
  <I {...p}><path d="M21 8l-9-5-9 5v8l9 5 9-5V8z" /><path d="M3.3 8.3L12 13l8.7-4.7M12 13v9" /></I>
);

export const IconEye = (p: P) => (
  <I {...p}><path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></I>
);

export const IconHistory = (p: P) => (
  <I {...p}><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5" /><path d="M3.5 3.5v5h5" /><path d="M12 7.5V12l3 2" /></I>
);

export const IconUndo = (p: P) => (
  <I {...p}><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 010 11H11" /></I>
);

export const IconTruck = (p: P) => (
  <I {...p}><path d="M1 5h13v11H1zM14 9h4l4 4v3h-8" /><circle cx="6" cy="18.5" r="1.8" /><circle cx="17.5" cy="18.5" r="1.8" /></I>
);

export const IconReport = (p: P) => (
  <I {...p}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></I>
);

export const IconUpload = (p: P) => (
  <I {...p}><path d="M12 16V4m0 0l-4 4m4-4l4 4" /><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" /></I>
);

export const IconDownload = (p: P) => (
  <I {...p}><path d="M12 4v12m0 0l-4-4m4 4l4-4" /><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" /></I>
);

export const IconUsers = (p: P) => (
  <I {...p}><circle cx="9" cy="8" r="3.2" /><path d="M2.8 19.2c.7-3 3.2-4.7 6.2-4.7s5.5 1.7 6.2 4.7" /><path d="M16 5.4a3 3 0 010 5.6M18.5 15c1.6.6 2.6 1.9 3 3.6" /></I>
);

export const IconSettings = (p: P) => (
  <I {...p}><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1 1.55V21a2 2 0 11-4 0v-.09a1.7 1.7 0 00-1-1.55 1.7 1.7 0 00-1.87.34l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.7 1.7 0 00.34-1.87 1.7 1.7 0 00-1.55-1H3a2 2 0 110-4h.09a1.7 1.7 0 001.55-1 1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 112.83-2.83l.06.06a1.7 1.7 0 001.87.34h0a1.7 1.7 0 001-1.55V3a2 2 0 114 0v.09a1.7 1.7 0 001 1.55h0a1.7 1.7 0 001.87-.34l.06-.06a2 2 0 112.83 2.83l-.06.06a1.7 1.7 0 00-.34 1.87v0a1.7 1.7 0 001.55 1H21a2 2 0 110 4h-.09a1.7 1.7 0 00-1.55 1z" /></I>
);

export const IconSearch = (p: P) => (
  <I {...p}><circle cx="10.5" cy="10.5" r="6.2" /><path d="M15.3 15.3L20 20" /></I>
);

export const IconX = (p: P) => (
  <I {...p}><path d="M6 6l12 12M18 6L6 18" /></I>
);

export const IconLogout = (p: P) => (
  <I {...p}><path d="M9 4H5.5A1.5 1.5 0 004 5.5v13A1.5 1.5 0 005.5 20H9" /><path d="M15 8l4 4-4 4M19 12H9" /></I>
);

export const IconBell = (p: P) => (
  <I {...p}><path d="M18 8a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8" /><path d="M10.3 20a2 2 0 003.4 0" /></I>
);

export const IconChevronDown = (p: P) => (
  <I {...p}><path d="M6 9l6 6 6-6" /></I>
);

export const IconMenu = (p: P) => (
  <I {...p}><path d="M4 6h16M4 12h16M4 18h16" /></I>
);

export const IconSun = (p: P) => (
  <I {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></I>
);

export const IconMoon = (p: P) => (
  <I {...p}><path d="M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z" /></I>
);

export const IconChevronsLeft = (p: P) => (
  <I {...p}><path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" /></I>
);

export const IconChevronsRight = (p: P) => (
  <I {...p}><path d="M13 7l5 5-5 5M6 7l5 5-5 5" /></I>
);

export const IconArrowRight = (p: P) => (
  <I {...p}><path d="M5 12h14M13 6l6 6-6 6" /></I>
);

export const IconPencil = (p: P) => (
  <I {...p}><path d="M17 3a2.4 2.4 0 013.4 3.4L7.5 19.3 3 21l1.7-4.5L17 3z" /></I>
);

export const IconTrash = (p: P) => (
  <I {...p}><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6" /></I>
);

export const IconBolt = (p: P) => (
  <I {...p}><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" /></I>
);

export const IconClock = (p: P) => (
  <I {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></I>
);

export const IconTag = (p: P) => (
  <I {...p}><path d="M20 12l-8.5 8.5a2 2 0 01-2.8 0L3 14.8V3h11.8L20 8.2a2.7 2.7 0 010 3.8z" /><circle cx="7.5" cy="7.5" r="1" /></I>
);

export const IconCalculator = (p: P) => (
  <I {...p}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8.5 7h7M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01" /></I>
);

export const IconCheckCircle = (p: P) => (
  <I {...p}><circle cx="12" cy="12" r="8.5" /><path d="M8.5 12.2l2.4 2.4 4.6-5" /></I>
);

export const IconInfo = (p: P) => (
  <I {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 7.8h.01" /></I>
);

export const IconEnter = (p: P) => (
  <I {...p}><path d="M20 5v6a3 3 0 01-3 3H5m0 0l4-4m-4 4l4 4" /></I>
);

export const IconCheck = (p: P) => (
  <I {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></I>
);

export const IconCalendar = (p: P) => (
  <I {...p}><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /></I>
);

export const IconPanelRight = (p: P) => (
  <I {...p}><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M15 4v16" /><path d="M7 9.5h4M7 13h4" /></I>
);

export const IconCoins = (p: P) => (
  <I {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v9M14.8 9.2c-.6-.8-1.6-1.2-2.8-1.2-1.7 0-2.9.9-2.9 2.1 0 2.9 5.8 1.4 5.8 4.2 0 1.2-1.2 2.1-2.9 2.1-1.2 0-2.3-.5-2.9-1.3" /></I>
);

/** Brand mark for the sidebar / login (the user's hexagon-box logo). */
export const BrandMark = ({ size = 34 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 6.5L12 3l8 3.5v7L12 21l-8-4.5v-7z" fill="rgba(255,255,255,.16)" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M12 21v-8M4 6.5L12 13l8-6.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
