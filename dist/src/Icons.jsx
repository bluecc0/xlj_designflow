// Minimal stroke icon set
const Icon = ({ d, size = 14, stroke = 1.5, fill = 'none', children, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor"
       strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={style}>
    {d ? <path d={d} /> : children}
  </svg>
);

const I = {
  search: (p) => <Icon {...p}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></Icon>,
  plus: (p) => <Icon d="M12 5v14M5 12h14" {...p}/>,
  arrowRight: (p) => <Icon d="M5 12h14m-6-6 6 6-6 6" {...p}/>,
  arrowUp: (p) => <Icon d="M12 19V5m-7 7 7-7 7 7" {...p}/>,
  paperclip: (p) => <Icon d="M21 11.5 12.5 20a5.5 5.5 0 0 1-7.8-7.8l9.2-9.2a3.7 3.7 0 0 1 5.2 5.2L9.9 17.4a1.8 1.8 0 0 1-2.6-2.6L15 7" {...p}/>,
  image: (p) => <Icon {...p}><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m3 17 5-5 5 5 3-3 5 5"/></Icon>,
  sparkles: (p) => <Icon {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></Icon>,
  wand: (p) => <Icon d="M15 4V2m0 14v-2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M3 21l9-9m-1.8-3.8L12 7" {...p}/>,
  close: (p) => <Icon d="M6 6l12 12M18 6 6 18" {...p}/>,
  more: (p) => <Icon {...p}><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></Icon>,
  grid: (p) => <Icon {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></Icon>,
  layers: (p) => <Icon d="m12 2 10 6-10 6L2 8l10-6Zm-10 10 10 6 10-6M2 16l10 6 10-6" {...p}/>,
  heart: (p) => <Icon d="M19.5 12.6 12 20l-7.5-7.4a5 5 0 0 1 7-7.2l.5.5.5-.5a5 5 0 0 1 7 7.2Z" {...p}/>,
  download: (p) => <Icon d="M12 3v12m-5-5 5 5 5-5M4 21h16" {...p}/>,
  check: (p) => <Icon d="m5 12 5 5L20 7" {...p}/>,
  refresh: (p) => <Icon d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" {...p}/>,
  zap: (p) => <Icon d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" {...p}/>,
  folder: (p) => <Icon d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" {...p}/>,
  user: (p) => <Icon {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></Icon>,
  settings: (p) => <Icon {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></Icon>,
  bookmark: (p) => <Icon d="M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z" {...p}/>,
  film: (p) => <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></Icon>,
  type: (p) => <Icon d="M4 7V5h16v2M9 20h6M12 5v15" {...p}/>,
  palette: (p) => <Icon d="M12 3a9 9 0 1 0 9 9c0-1-1-2-2-2h-2a2 2 0 0 1-2-2v-1a2 2 0 0 1 2-2h1a2 2 0 0 0 2-2 9 9 0 0 0-8-2Z" {...p}><circle cx="7.5" cy="10.5" r="1"/><circle cx="8.5" cy="14.5" r="1"/><circle cx="12" cy="7.5" r="1"/></Icon>,
  dims: (p) => <Icon d="M3 3v18h18M7 17V9m-4 4h4m10 0h4m-4 4V9" {...p}/>,
  play: (p) => <Icon d="M6 4v16l14-8L6 4Z" fill="currentColor" {...p}/>,
  stop: (p) => <Icon {...p}><rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/></Icon>,
  bolt: (p) => <Icon d="M11 3 3 14h7l-1 7 9-11h-7l1-7Z" {...p}/>,
  attach: (p) => <Icon d="M21 12.8 13 21a5 5 0 0 1-7-7l8.5-8.5a3 3 0 1 1 4.2 4.2L10 18a1 1 0 1 1-1.4-1.4L15 10" {...p}/>,
  eye: (p) => <Icon {...p}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></Icon>,
  copy: (p) => <Icon {...p}><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></Icon>,
  share: (p) => <Icon {...p}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></Icon>,
  filter: (p) => <Icon d="M3 5h18M6 12h12M10 19h4" {...p}/>,
  chevronDown: (p) => <Icon d="m6 9 6 6 6-6" {...p}/>,
  chevronRight: (p) => <Icon d="m9 6 6 6-6 6" {...p}/>,
  file: (p) => <Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6" {...p}/>,
  dot: (p) => <Icon {...p}><circle cx="12" cy="12" r="3" fill="currentColor"/></Icon>,
};

window.I = I;
window.Icon = Icon;
