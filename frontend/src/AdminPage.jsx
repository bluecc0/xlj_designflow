// Admin operations console. This page is only rendered for admin users.

const ADMIN_ACTIONS = {
  login: ['登录', '#16a36a'],
  compose: ['模板合成', '#4f5ee8'],
  special_compose: ['特殊品合成', '#4f5ee8'],
  ai_image: ['AI 生图', '#db7b20'],
  agent_chat: ['Agent 对话', '#2878d0'],
  inspiration_publish: ['发布灵感', '#0f8b78'],
  inspiration_unpublish: ['下架灵感', '#d64545'],
  inspiration_describe: ['灵感反推', '#0891b2'],
  ai_image_layer_extract: ['智能分层', '#7c4fd4'],
  ai_image_vectorize: ['图片矢量化', '#2563bd'],
  ai_image_upscale: ['高清放大', '#c45b21'],
  grid_promotional: ['智能铺货', '#4f46c8'],
  admin_alert_acknowledge: ['确认异常', '#bd741d'],
};

const ADMIN_TASK_TYPES = {
  ai_image: 'AI 生图',
  agent_image: 'Agent 生图',
  compose: '模板合成',
  special: '特殊品',
};

const ADMIN_PROVIDERS = {
  auto: '智能路由',
  apimart: '默认线路 (APIMart)',
  sub2api: '订阅线路 (Sub2API)',
  adobe2api: 'Adobe 线路 (Firefly)',
  penpot: 'Penpot',
  local: '本地处理',
};

const ADMIN_STATUS = {
  pending: ['等待中', 'neutral'],
  queued: ['排队中', 'neutral'],
  processing: ['处理中', 'active'],
  running: ['运行中', 'active'],
  done: ['已完成', 'success'],
  failed: ['失败', 'danger'],
  active: ['进行中', 'active'],
};

const ADMIN_CSS = `
  .df-admin, .df-admin * { box-sizing: border-box; }
  .df-admin {
    --admin-bg: #f5f5f2;
    --admin-surface: #ffffff;
    --admin-ink: #171916;
    --admin-muted: #73786f;
    --admin-faint: #a7aba4;
    --admin-line: #e3e5df;
    --admin-line-strong: #d4d7cf;
    --admin-green: #1ca66a;
    --admin-green-soft: #eaf7f0;
    --admin-red: #d44747;
    --admin-red-soft: #fff0ef;
    --admin-amber: #bd741d;
    --admin-amber-soft: #fff6e8;
    height: 100vh;
    display: grid;
    grid-template-columns: 218px minmax(0, 1fr);
    overflow: hidden;
    color: var(--admin-ink);
    background: var(--admin-bg);
    font-family: Inter, "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  .df-admin button, .df-admin input, .df-admin select { font: inherit; }
  .df-admin-sidebar {
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 18px 12px 14px;
    background: #1a1c19;
    color: #f8f8f5;
  }
  .df-admin-brand { padding: 4px 10px 22px; }
  .df-admin-brandmark {
    width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center;
    color: #111; background: #d7ff60; margin-bottom: 12px;
  }
  .df-admin-brandname { font-size: 16px; font-weight: 700; letter-spacing: -.025em; }
  .df-admin-brandmeta { margin-top: 3px; font-size: 10px; color: #8e938a; letter-spacing: .14em; text-transform: uppercase; }
  .df-admin-navlabel { padding: 0 10px 7px; color: #777c73; font-size: 9px; letter-spacing: .16em; text-transform: uppercase; }
  .df-admin-nav { display: flex; flex-direction: column; gap: 3px; }
  .df-admin-navbutton {
    width: 100%; height: 38px; display: flex; align-items: center; gap: 10px;
    padding: 0 10px; border: 0; border-radius: 7px; color: #aeb3aa;
    background: transparent; cursor: pointer; text-align: left; font-size: 12px;
    transition: color 120ms, background 120ms;
  }
  .df-admin-navbutton:hover { color: #fff; background: #242723; }
  .df-admin-navbutton.is-active { color: #fff; background: #2b2e2a; }
  .df-admin-navbutton.is-active::after {
    content: ""; width: 5px; height: 5px; margin-left: auto; border-radius: 50%; background: #d7ff60;
  }
  .df-admin-navbutton svg { flex: 0 0 auto; }
  .df-admin-sidebarfoot { margin-top: auto; padding: 12px 8px 0; border-top: 1px solid #2d302c; }
  .df-admin-userline { display: flex; align-items: center; gap: 9px; margin-bottom: 10px; }
  .df-admin-avatar {
    width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center;
    color: #151714; background: #d7ff60; font-size: 11px; font-weight: 700;
  }
  .df-admin-username { min-width: 0; font-size: 11.5px; color: #f5f5f2; overflow: hidden; text-overflow: ellipsis; }
  .df-admin-role { margin-top: 1px; color: #7f847b; font-size: 9px; text-transform: uppercase; letter-spacing: .08em; }
  .df-admin-back {
    width: 100%; height: 32px; border: 1px solid #343733; border-radius: 7px;
    color: #aeb3aa; background: transparent; cursor: pointer; font-size: 10.5px;
  }
  .df-admin-back:hover { color: #fff; border-color: #555a52; }
  .df-admin-main { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
  .df-admin-header {
    height: 66px; flex: 0 0 auto; display: flex; align-items: center; gap: 16px;
    padding: 0 26px; background: rgba(255,255,255,.88); border-bottom: 1px solid var(--admin-line);
    backdrop-filter: blur(12px);
  }
  .df-admin-title { font-size: 18px; font-weight: 680; letter-spacing: -.03em; }
  .df-admin-subtitle { margin-top: 2px; color: var(--admin-muted); font-size: 10.5px; }
  .df-admin-headtools { margin-left: auto; display: flex; align-items: center; gap: 8px; }
  .df-admin-control {
    height: 32px; padding: 0 10px; border: 1px solid var(--admin-line);
    border-radius: 7px; background: #fff; color: var(--admin-ink); outline: none; font-size: 11px;
  }
  button.df-admin-control { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  button.df-admin-control:hover { border-color: var(--admin-line-strong); background: #fafaf8; }
  .df-admin-updated { color: var(--admin-faint); font-size: 9.5px; }
  .df-admin-scroll { flex: 1; min-height: 0; overflow: auto; padding: 22px 26px 42px; }
  .df-admin-content { width: min(1460px, 100%); margin: 0 auto; }
  .df-admin-alert {
    display: flex; align-items: center; gap: 10px; min-height: 42px; margin-bottom: 14px;
    padding: 8px 12px; border-radius: 8px; color: #814515;
    background: var(--admin-amber-soft); border: 1px solid #f0d7b4; font-size: 11.5px;
  }
  .df-admin-alertdot { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: #dc8529; }
  .df-admin-alertclose {
    width: 26px; height: 26px; flex: 0 0 auto; display: grid; place-items: center;
    padding: 0; border: 0; border-radius: 6px; color: #9a6b3d; background: transparent; cursor: pointer;
  }
  .df-admin-alertclose:hover { color: #69431f; background: rgba(189,116,29,.09); }
  .df-admin-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
  .df-admin-metric {
    min-height: 126px; padding: 17px 18px; border: 1px solid var(--admin-line);
    border-radius: 10px; background: var(--admin-surface);
  }
  .df-admin-metrichead { display: flex; align-items: center; justify-content: space-between; color: var(--admin-muted); font-size: 10.5px; }
  .df-admin-metricdot { width: 7px; height: 7px; border-radius: 50%; background: var(--metric-color, #9b9f98); }
  .df-admin-metricvalue { margin-top: 18px; font-size: 33px; font-weight: 680; line-height: 1; letter-spacing: -.055em; font-variant-numeric: tabular-nums; }
  .df-admin-metricfoot { margin-top: 10px; color: var(--admin-faint); font-size: 9.5px; }
  .df-admin-metricfoot strong { color: var(--admin-muted); font-weight: 550; }
  .df-admin-health {
    margin-top: 10px; padding: 16px 18px 17px; border: 1px solid var(--admin-line);
    border-radius: 10px; background: var(--admin-surface);
  }
  .df-admin-healthtop { display: flex; align-items: center; gap: 10px; }
  .df-admin-healthmark {
    width: 8px; height: 8px; flex: 0 0 auto;
    border-radius: 50%; background: var(--admin-green);
    box-shadow: 0 0 0 3px var(--admin-green-soft);
  }
  .df-admin-healthmark.is-warning { background: var(--admin-amber); box-shadow: 0 0 0 3px var(--admin-amber-soft); }
  .df-admin-healthmark.is-degraded { background: var(--admin-red); box-shadow: 0 0 0 3px var(--admin-red-soft); }
  .df-admin-healthmark.is-unknown { background: #b9bdb6; box-shadow: 0 0 0 3px #f0f1ed; }
  .df-admin-healthname { font-size: 12px; font-weight: 650; }
  .df-admin-healthmeta { color: var(--admin-faint); font-size: 9.5px; }
  .df-admin-healthrate { margin-left: auto; color: var(--admin-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
  .df-admin-healthrail {
    display: grid; grid-template-columns: repeat(72, minmax(2px, 1fr)); gap: 3px;
    height: 27px; margin-top: 14px;
  }
  .df-admin-healthbar { min-width: 2px; border-radius: 2px; background: #dfe2dc; }
  .df-admin-healthbar.is-healthy { background: #55bc91; }
  .df-admin-healthbar.is-warning { background: #e7ad42; }
  .df-admin-healthbar.is-degraded { background: #df6b59; }
  .df-admin-healthfoot { display: flex; align-items: center; gap: 12px; margin-top: 9px; color: var(--admin-faint); font-size: 8.5px; }
  .df-admin-healthfoot span { display: inline-flex; align-items: center; gap: 4px; }
  .df-admin-healthfoot i { width: 5px; height: 5px; border-radius: 50%; background: #dfe2dc; }
  .df-admin-healthfoot .is-healthy i { background: #55bc91; }
  .df-admin-healthfoot .is-warning i { background: #e7ad42; }
  .df-admin-healthfoot .is-degraded i { background: #df6b59; }
  .df-admin-grid { display: grid; grid-template-columns: minmax(0, 1.8fr) minmax(270px, .8fr); gap: 10px; margin-top: 10px; }
  .df-admin-card {
    min-width: 0; border: 1px solid var(--admin-line); border-radius: 10px;
    background: var(--admin-surface); overflow: hidden;
  }
  .df-admin-cardhead { min-height: 48px; display: flex; align-items: center; gap: 10px; padding: 0 16px; border-bottom: 1px solid var(--admin-line); }
  .df-admin-cardtitle { font-size: 12px; font-weight: 630; }
  .df-admin-cardmeta { color: var(--admin-faint); font-size: 9.5px; }
  .df-admin-cardaction { margin-left: auto; color: var(--admin-muted); border: 0; background: none; cursor: pointer; font-size: 10px; }
  .df-admin-chart { height: 218px; display: flex; align-items: stretch; gap: 8px; padding: 22px 18px 12px; }
  .df-admin-baritem { min-width: 0; flex: 1; display: flex; flex-direction: column; justify-content: flex-end; align-items: stretch; gap: 6px; }
  .df-admin-bartrack { height: 158px; display: flex; flex-direction: column; justify-content: flex-end; overflow: hidden; border-radius: 4px 4px 2px 2px; background: #f0f1ed; }
  .df-admin-bar { background: #20231f; transition: height 180ms; }
  .df-admin-bar.is-agent { background: #5f6fe8; }
  .df-admin-bar.is-compose { background: #55bc91; }
  .df-admin-bar.is-special { background: #e7ad42; }
  .df-admin-barlabel { color: var(--admin-faint); text-align: center; font-size: 8.5px; white-space: nowrap; }
  .df-admin-legend { display: inline-flex; align-items: center; gap: 9px; }
  .df-admin-legend span { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
  .df-admin-legend i { width: 5px; height: 5px; border-radius: 50%; background: #20231f; }
  .df-admin-legend .is-agent i { background: #5f6fe8; }
  .df-admin-legend .is-compose i { background: #55bc91; }
  .df-admin-legend .is-special i { background: #e7ad42; }
  .df-admin-breakdown { padding: 7px 16px 13px; }
  .df-admin-breakrow { padding: 11px 0; border-bottom: 1px solid #eff0ec; }
  .df-admin-breakrow:last-child { border-bottom: 0; }
  .df-admin-breaktop { display: flex; align-items: center; justify-content: space-between; font-size: 11px; }
  .df-admin-breakvalue { font-weight: 650; font-variant-numeric: tabular-nums; }
  .df-admin-progress { height: 3px; margin-top: 8px; border-radius: 9px; overflow: hidden; background: #eeefeb; }
  .df-admin-progress > span { display: block; height: 100%; background: #292c28; }
  .df-admin-section { margin-top: 10px; }
  .df-admin-split { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
  .df-admin-overviewtriple { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-top: 10px; }
  .df-admin-ranking { padding: 7px 16px 12px; }
  .df-admin-rankrow { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; align-items: center; gap: 9px; min-height: 45px; border-bottom: 1px solid #eff0ec; }
  .df-admin-rankrow:last-child { border-bottom: 0; }
  .df-admin-rankno { color: var(--admin-faint); font: 9.5px "JetBrains Mono", monospace; }
  .df-admin-rankname { overflow: hidden; font-size: 10.5px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .df-admin-rankmeta { margin-top: 2px; color: var(--admin-faint); font-size: 8.5px; }
  .df-admin-rankvalue { font-size: 15px; font-weight: 680; font-variant-numeric: tabular-nums; }
  .df-admin-rankunit { margin-left: 3px; color: var(--admin-faint); font-size: 8px; font-weight: 400; }
  .df-admin-tablewrap { overflow: auto; }
  .df-admin-table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  .df-admin-table th {
    height: 38px; padding: 0 12px; color: var(--admin-muted); background: #fafaf8;
    border-bottom: 1px solid var(--admin-line); text-align: left; font-size: 9.5px; font-weight: 550; white-space: nowrap;
  }
  .df-admin-table td { height: 45px; padding: 7px 12px; border-bottom: 1px solid #eff0ec; vertical-align: middle; }
  .df-admin-table tbody tr:last-child td { border-bottom: 0; }
  .df-admin-table tbody tr.is-clickable { cursor: pointer; }
  .df-admin-table tbody tr.is-clickable:hover { background: #fafaf8; }
  .df-admin-status {
    display: inline-flex; align-items: center; gap: 5px; height: 21px; padding: 0 7px;
    border-radius: 99px; color: #666c63; background: #f1f2ef; white-space: nowrap; font-size: 9.5px;
  }
  .df-admin-status::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: #9ba097; }
  .df-admin-status.is-success { color: #157a4e; background: var(--admin-green-soft); }
  .df-admin-status.is-success::before { background: var(--admin-green); }
  .df-admin-status.is-danger { color: #a73535; background: var(--admin-red-soft); }
  .df-admin-status.is-danger::before { background: var(--admin-red); }
  .df-admin-status.is-active { color: #976018; background: var(--admin-amber-soft); }
  .df-admin-status.is-active::before { background: var(--admin-amber); animation: adminPulse 1.4s infinite; }
  @keyframes adminPulse { 50% { opacity: .35; } }
  .df-admin-mono { font-family: "JetBrains Mono", "SFMono-Regular", Consolas, monospace; font-size: 9.5px; }
  .df-admin-muted { color: var(--admin-muted); }
  .df-admin-faint { color: var(--admin-faint); }
  .df-admin-ellipsis { max-width: 330px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .df-admin-empty { min-height: 150px; display: grid; place-items: center; color: var(--admin-faint); font-size: 11px; }
  .df-admin-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; }
  .df-admin-search { position: relative; min-width: 220px; flex: 1; max-width: 400px; }
  .df-admin-search svg { position: absolute; left: 10px; top: 9px; color: var(--admin-faint); pointer-events: none; }
  .df-admin-search input { width: 100%; padding-left: 31px; }
  .df-admin-pageinfo { margin-left: auto; color: var(--admin-faint); font-size: 9.5px; }
  .df-admin-pagebutton { width: 32px; padding: 0; justify-content: center; }
  .df-admin-servicegrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
  .df-admin-service { min-height: 146px; padding: 16px; border: 1px solid var(--admin-line); border-radius: 10px; background: #fff; }
  .df-admin-servicetop { display: flex; align-items: flex-start; gap: 10px; }
  .df-admin-serviceicon { width: 31px; height: 31px; display: grid; place-items: center; border-radius: 8px; color: #555b53; background: #f1f2ee; }
  .df-admin-servicename { font-size: 11.5px; font-weight: 620; }
  .df-admin-servicedesc { margin-top: 3px; color: var(--admin-faint); font-size: 9px; }
  .df-admin-servicestate { margin-left: auto; width: 8px; height: 8px; border-radius: 50%; background: #a7aba4; }
  .df-admin-servicestate.is-up { background: var(--admin-green); box-shadow: 0 0 0 4px var(--admin-green-soft); }
  .df-admin-servicestate.is-down { background: var(--admin-red); box-shadow: 0 0 0 4px var(--admin-red-soft); }
  .df-admin-servicebody { margin-top: 18px; color: var(--admin-muted); font-size: 9.5px; line-height: 1.65; word-break: break-all; }
  .df-admin-probelist { max-height: 410px; overflow: auto; padding: 0 16px; }
  .df-admin-probe {
    min-height: 54px; display: grid; grid-template-columns: 10px minmax(120px, 1fr) 110px 82px 38px;
    align-items: center; gap: 10px; border-bottom: 1px solid #eff0ec;
  }
  .df-admin-probe:last-child { border-bottom: 0; }
  .df-admin-probedot { width: 7px; height: 7px; border-radius: 50%; background: #a7aba4; }
  .df-admin-probedot.is-done { background: var(--admin-green); box-shadow: 0 0 0 3px var(--admin-green-soft); }
  .df-admin-probedot.is-failed { background: var(--admin-red); box-shadow: 0 0 0 3px var(--admin-red-soft); }
  .df-admin-probedot.is-running { background: var(--admin-amber); box-shadow: 0 0 0 3px var(--admin-amber-soft); }
  .df-admin-probetime { font-size: 10.5px; font-weight: 610; font-variant-numeric: tabular-nums; }
  .df-admin-probemeta { color: var(--admin-faint); font-size: 9px; font-variant-numeric: tabular-nums; }
  .df-admin-probethumb {
    width: 36px; height: 36px; display: block; overflow: hidden;
    border: 1px solid var(--admin-line); border-radius: 6px; background: #eff0ec;
  }
  .df-admin-probethumb img { width: 100%; height: 100%; display: block; object-fit: cover; }
  .df-admin-probenoimage { width: 36px; height: 36px; border-radius: 6px; background: #f1f2ee; }
  .df-admin-probeerror {
    margin-top: 3px; overflow: hidden; color: #a73535; font-size: 8.5px;
    text-overflow: ellipsis; white-space: nowrap;
  }
  .df-admin-form {
    display: grid; grid-template-columns: 1fr 1fr 1fr 110px auto auto; gap: 8px; align-items: center;
    padding: 14px; border-bottom: 1px solid var(--admin-line); background: #fafaf8;
  }
  .df-admin-useridentity strong { display: block; font-size: 10.5px; }
  .df-admin-useridentity span { display: block; margin-top: 3px; color: var(--admin-faint); font: 8.5px "JetBrains Mono", monospace; }
  .df-admin-primary { color: #fff; background: #1c1e1b; border-color: #1c1e1b; cursor: pointer; }
  .df-admin-primary:hover { color: #fff; background: #2a2d29; }
  .df-admin-linkbutton { border: 0; background: none; color: #4f5ee8; cursor: pointer; font-size: 9.5px; }
  .df-admin-dangerbutton { color: var(--admin-red); }
  .df-admin-error { padding: 10px 12px; margin-bottom: 10px; border-radius: 7px; color: #a73535; background: var(--admin-red-soft); font-size: 10.5px; }
  .df-admin-drawerbackdrop { position: fixed; inset: 0; z-index: 90; background: rgba(18,20,17,.16); }
  .df-admin-drawer {
    position: fixed; z-index: 91; top: 0; right: 0; bottom: 0; width: min(620px, 94vw);
    padding: 22px; overflow: auto; background: #fff; box-shadow: -18px 0 50px rgba(20,22,19,.12);
  }
  .df-admin-drawerhead { display: flex; align-items: center; gap: 10px; padding-bottom: 17px; border-bottom: 1px solid var(--admin-line); }
  .df-admin-drawertitle { font-size: 15px; font-weight: 680; }
  .df-admin-drawerclose { margin-left: auto; width: 30px; padding: 0; justify-content: center; }
  .df-admin-detailgrid { display: grid; grid-template-columns: 110px 1fr; gap: 12px; padding: 17px 0; font-size: 10.5px; border-bottom: 1px solid var(--admin-line); }
  .df-admin-detailgrid dt { color: var(--admin-faint); }
  .df-admin-detailgrid dd { margin: 0; color: var(--admin-ink); word-break: break-word; }
  .df-admin-detailsection { padding: 17px 0; border-bottom: 1px solid var(--admin-line); }
  .df-admin-detailsection:last-child { border-bottom: 0; }
  .df-admin-detailtitle { margin-bottom: 10px; color: var(--admin-muted); font-size: 9px; font-weight: 650; letter-spacing: .12em; text-transform: uppercase; }
  .df-admin-detailcards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; }
  .df-admin-detailcard { min-width: 0; padding: 10px; border: 1px solid var(--admin-line); border-radius: 8px; background: #fafaf8; }
  .df-admin-detailcard span { display: block; color: var(--admin-faint); font-size: 8.5px; }
  .df-admin-detailcard strong { display: block; margin-top: 5px; overflow: hidden; color: var(--admin-ink); font-size: 10.5px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .df-admin-prompt { margin-top: 8px; padding: 11px 12px; border: 1px solid var(--admin-line); border-radius: 8px; background: #fafaf8; }
  .df-admin-prompt:first-of-type { margin-top: 0; }
  .df-admin-promptlabel { margin-bottom: 6px; color: var(--admin-faint); font-size: 8.5px; }
  .df-admin-prompttext { color: var(--admin-ink); font-size: 11px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
  .df-admin-resultimage { display: block; width: 100%; max-height: 320px; object-fit: contain; border: 1px solid var(--admin-line); border-radius: 8px; background: #f5f5f2; }
  .df-admin-detailactions { display: flex; gap: 7px; margin-top: 9px; }
  .df-admin-raw summary { margin-top: 12px; color: var(--admin-muted); cursor: pointer; font-size: 10px; }
  .df-admin-code { margin-top: 14px; padding: 12px; border-radius: 8px; color: #d8ddd4; background: #20231f; font: 9.5px/1.6 "JetBrains Mono", monospace; white-space: pre-wrap; word-break: break-all; }
  @media (max-width: 1050px) {
    .df-admin { grid-template-columns: 74px minmax(0, 1fr); }
    .df-admin-brandname, .df-admin-brandmeta, .df-admin-navlabel, .df-admin-navbutton span, .df-admin-userline > div:last-child, .df-admin-back span { display: none; }
    .df-admin-brand { padding-left: 10px; }
    .df-admin-navbutton { justify-content: center; }
    .df-admin-navbutton.is-active::after { display: none; }
    .df-admin-back { display: grid; place-items: center; }
    .df-admin-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .df-admin-servicegrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 760px) {
    .df-admin { grid-template-columns: 1fr; grid-template-rows: 52px minmax(0, 1fr); }
    .df-admin-sidebar {
      min-width: 0; flex-direction: row; align-items: center; gap: 6px;
      padding: 6px 8px; overflow: hidden; border-bottom: 1px solid #2d302c;
    }
    .df-admin-brand, .df-admin-navlabel, .df-admin-userline { display: none; }
    .df-admin-nav { min-width: 0; flex: 1; flex-direction: row; overflow-x: auto; scrollbar-width: none; }
    .df-admin-nav::-webkit-scrollbar { display: none; }
    .df-admin-navbutton { width: auto; min-width: max-content; height: 38px; padding: 0 10px; }
    .df-admin-navbutton span { display: inline; }
    .df-admin-sidebarfoot { margin: 0; padding: 0; border: 0; }
    .df-admin-back { width: auto; min-width: max-content; padding: 0 10px; }
    .df-admin-back span { display: inline; }
    .df-admin-header { height: auto; min-height: 66px; flex-wrap: wrap; padding: 10px 14px; }
    .df-admin-headtools { gap: 5px; }
    .df-admin-updated { display: none; }
    .df-admin-scroll { padding: 14px; }
    .df-admin-grid, .df-admin-split, .df-admin-overviewtriple { grid-template-columns: 1fr; }
    .df-admin-servicegrid { grid-template-columns: 1fr; }
    .df-admin-probe { grid-template-columns: 10px minmax(100px, 1fr) 74px 38px; }
    .df-admin-probecompleted { display: none; }
    .df-admin-form { grid-template-columns: 1fr; }
    .df-admin-toolbar { flex-wrap: wrap; }
    .df-admin-search { min-width: 100%; max-width: none; }
    .df-admin-detailcards { grid-template-columns: 1fr 1fr; }
  }
  @media (max-width: 520px) {
    .df-admin-metrics { grid-template-columns: 1fr; }
    .df-admin-title { font-size: 16px; }
    .df-admin-subtitle { display: none; }
    .df-admin-headtools { margin-left: 0; }
    .df-admin-healthtop {
      display: grid; grid-template-columns: 24px minmax(0, 1fr) auto;
      column-gap: 9px; row-gap: 3px;
    }
    .df-admin-healthmark { grid-row: 1 / 3; }
    .df-admin-healthname, .df-admin-healthrate { white-space: nowrap; }
    .df-admin-healthrate { margin-left: 0; }
    .df-admin-healthmeta { grid-column: 2 / 4; }
    .df-admin-healthrail { gap: 2px; }
    .df-admin-healthfoot > span:last-child { display: none; }
  }
`;

function adminFormatTime(ts, includeSeconds) {
  if (!ts) return '-';
  var d = new Date(Number(ts) * 1000);
  var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
  var date = pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  var time = pad(d.getHours()) + ':' + pad(d.getMinutes());
  if (includeSeconds) time += ':' + pad(d.getSeconds());
  return date + ' ' + time;
}

function adminFormatAge(seconds) {
  var value = Math.max(0, Number(seconds || 0));
  if (value < 60) return Math.round(value) + ' 秒';
  if (value < 3600) return Math.floor(value / 60) + ' 分钟';
  if (value < 86400) return (value / 3600).toFixed(value < 7200 ? 1 : 0) + ' 小时';
  return Math.floor(value / 86400) + ' 天';
}

function adminActionMeta(action) {
  return ADMIN_ACTIONS[action] || [action || '未知操作', '#777d74'];
}

function adminProviderLabel(provider) {
  return ADMIN_PROVIDERS[provider] || provider || '历史数据未记录';
}

function adminUserLabel(item) {
  return item && (item.display_name || item.username || item.user_id || item.id) || '未知用户';
}

function adminRangeLabel(hours) {
  if (Number(hours) === 0) return '所有时间';
  if (Number(hours) <= 24) return '1 天内';
  if (Number(hours) <= 168) return '近 7 天';
  return '近 30 天';
}

function adminJsonText(value) {
  if (value == null || value === '') return '-';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch (e) { return String(value); }
}

function adminPromptText(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') return value;
  return adminJsonText(value);
}

function adminHasContent(value) {
  if (value == null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function adminCanPreviewImage(url) {
  if (!url) return false;
  var clean = String(url).split('?')[0].split('#')[0].toLowerCase();
  return /\.(png|jpe?g|webp|gif|svg|avif)$/.test(clean);
}

function AdminStatusBadge({ status }) {
  var meta = ADMIN_STATUS[status] || [status || '未知', 'neutral'];
  return <span className={'df-admin-status is-' + meta[1]}>{meta[0]}</span>;
}

function adminStatusText(status) {
  return (ADMIN_STATUS[status] || [status || '未知'])[0];
}

function AdminMetric({ label, value, foot, color }) {
  return (
    <div className="df-admin-metric" style={{ '--metric-color': color || '#92978e' }}>
      <div className="df-admin-metrichead"><span>{label}</span><span className="df-admin-metricdot" /></div>
      <div className="df-admin-metricvalue">{value}</div>
      <div className="df-admin-metricfoot">{foot}</div>
    </div>
  );
}

function AdminEmpty({ text }) {
  return <div className="df-admin-empty">{text || '暂无数据'}</div>;
}

function AdminTrendChart({ series, hours }) {
  var list = series || [];
  var max = Math.max.apply(null, [1].concat(list.map(function(item) { return item.total || 0; })));
  return (
    <div className="df-admin-chart">
      {list.map(function(item, index) {
        var imageHeight = Math.max(item.ai_image ? 3 : 0, Math.round((item.ai_image || 0) * 142 / max));
        var agentHeight = Math.max(item.agent_image ? 3 : 0, Math.round((item.agent_image || 0) * 142 / max));
        var composeHeight = Math.max(item.compose ? 3 : 0, Math.round((item.compose || 0) * 142 / max));
        var specialHeight = Math.max(item.special ? 3 : 0, Math.round((item.special || 0) * 142 / max));
        var d = new Date(item.timestamp * 1000);
        var label = hours !== 0 && hours <= 48
          ? String(d.getHours()).padStart(2, '0') + ':00'
          : (d.getMonth() + 1) + '/' + d.getDate();
        return (
          <div className="df-admin-baritem" key={index} title={'共 ' + item.total + ' · AI 生图 ' + item.ai_image + ' · Agent 生图 ' + item.agent_image + ' · 模板合成 ' + item.compose + ' · 特殊品 ' + item.special}>
            <div className="df-admin-bartrack">
              <span className="df-admin-bar is-special" style={{ height: specialHeight }} />
              <span className="df-admin-bar is-compose" style={{ height: composeHeight }} />
              <span className="df-admin-bar is-agent" style={{ height: agentHeight }} />
              <span className="df-admin-bar" style={{ height: imageHeight }} />
            </div>
            <div className="df-admin-barlabel">{label}</div>
          </div>
        );
      })}
    </div>
  );
}

function AdminHealthTimeline({ timeline, summary, breakdown, hours }) {
  var list = timeline || [];
  var rate = summary && summary.success_rate;
  var activeTypes = (breakdown || []).filter(function(item) { return item.total > 0; }).length;
  var overallState = 'unknown';
  if (summary && summary.total) {
    if (summary.failed > 0 && Number(rate || 0) < 90) overallState = 'degraded';
    else if (summary.failed > 0 || summary.active > 0) overallState = 'warning';
    else overallState = 'healthy';
  }
  var allTime = Number(hours) === 0;
  var start = list.length
    ? new Date(Number(list[0].timestamp) * 1000)
    : new Date(Date.now() - Number(hours || 24) * 3600 * 1000);
  var end = new Date();
  var dateLabel = (allTime ? '全部历史 · ' : '')
    + (start.getMonth() + 1) + '月' + start.getDate() + '日 - '
    + (end.getMonth() + 1) + '月' + end.getDate() + '日';
  return (
    <section className="df-admin-health">
      <div className="df-admin-healthtop">
        <span className={'df-admin-healthmark is-' + overallState} aria-label={'健康状态：' + overallState} />
        <span className="df-admin-healthname">任务健康轨迹</span>
        <span className="df-admin-healthmeta">{activeTypes} 类业务 · {dateLabel}</span>
        <span className="df-admin-healthrate">{rate == null ? '暂无已结束任务' : rate + '% 健康率'}</span>
      </div>
      <div className="df-admin-healthrail">
        {list.map(function(item, index) {
          var d = new Date(item.timestamp * 1000);
          var title = (d.getMonth() + 1) + '-' + d.getDate() + ' '
            + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
            + ' · 共 ' + item.total + ' · 成功 ' + item.done + ' · 失败 ' + item.failed + ' · 处理中 ' + item.active;
          return <span className={'df-admin-healthbar is-' + item.state} key={index} title={title} />;
        })}
      </div>
      <div className="df-admin-healthfoot">
        <span className="is-healthy"><i />正常</span>
        <span className="is-warning"><i />波动</span>
        <span className="is-degraded"><i />异常</span>
        <span><i />无任务</span>
        <span style={{ marginLeft: 'auto' }}>基于持久化任务结果，不代表服务商 SLA</span>
      </div>
    </section>
  );
}

function AdminUserRanking({ items, hours }) {
  var ranking = items || [];
  return (
    <section className="df-admin-card">
      <div className="df-admin-cardhead">
        <span className="df-admin-cardtitle">用户生图排行</span>
        <span className="df-admin-cardmeta">{adminRangeLabel(hours)} · Top 5</span>
      </div>
      {ranking.length ? (
        <div className="df-admin-ranking">
          {ranking.map(function(item, index) {
            return (
              <div className="df-admin-rankrow" key={item.user_id}>
                <span className="df-admin-rankno">{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <div className="df-admin-rankname">{adminUserLabel(item)}</div>
                  <div className="df-admin-rankmeta">{item.username || item.user_id} · 合成 {item.compose_count || 0}</div>
                </div>
                <strong className="df-admin-rankvalue">{item.image_count || 0}<span className="df-admin-rankunit">次</span></strong>
              </div>
            );
          })}
        </div>
      ) : <AdminEmpty text="当前周期暂无生图任务" />}
    </section>
  );
}

function AdminServiceCard({ name, desc, connected, configured, probing, detail, icon }) {
  var stateClass = connected ? 'is-up' : (probing || configured === false ? '' : 'is-down');
  return (
    <div className="df-admin-service">
      <div className="df-admin-servicetop">
        <span className="df-admin-serviceicon">{icon || <I.settings size={15} />}</span>
        <div>
          <div className="df-admin-servicename">{name}</div>
          <div className="df-admin-servicedesc">{desc}</div>
        </div>
        <span className={'df-admin-servicestate ' + stateClass} />
      </div>
      <div className="df-admin-servicebody">
        {configured === false ? '未配置' : (probing ? '正在探测' : (connected ? '运行正常' : '连接异常'))}
        {detail ? <><br />{detail}</> : null}
      </div>
    </div>
  );
}

function AdminUserManagement({ currentUser, users, onReload, showTestUsers, onToggleShowTest }) {
  var [form, setForm] = React.useState({ username: '', displayName: '', role: 'user', password: '', isTest: false });
  var [busy, setBusy] = React.useState(false);
  var [error, setError] = React.useState('');

  var createUser = function() {
    if (!form.username.trim() || !form.password.trim() || busy) return;
    setBusy(true); setError('');
    window.API.createAdminUser(form.username.trim(), form.role, form.password.trim(), form.displayName.trim(), form.isTest)
      .then(function() {
        setForm({ username: '', displayName: '', role: 'user', password: '', isTest: false });
        return onReload();
      })
      .catch(function(err) { setError(err.message || '创建失败'); })
      .finally(function() { setBusy(false); });
  };

  var updateRole = function(item) {
    if (busy || item.id === currentUser.id) return;
    var role = item.role === 'admin' ? 'user' : 'admin';
    if (!window.confirm('将「' + adminUserLabel(item) + '」调整为' + (role === 'admin' ? '管理员' : '普通用户') + '？')) return;
    setBusy(true); setError('');
    window.API.updateAdminUser(item.id, { role: role })
      .then(onReload)
      .catch(function(err) { setError(err.message || '更新失败'); })
      .finally(function() { setBusy(false); });
  };

  var toggleTestStatus = function(item) {
    if (busy) return;
    var nextState = !item.is_test;
    if (!window.confirm('将「' + adminUserLabel(item) + '」' + (nextState ? '标记为测试账号（将不计入后台统计与任务列表）' : '恢复为正常账号（将计入后台统计与任务列表）') + '？')) return;
    setBusy(true); setError('');
    window.API.updateAdminUser(item.id, { is_test: nextState })
      .then(onReload)
      .catch(function(err) { setError(err.message || '测试标记更新失败'); })
      .finally(function() { setBusy(false); });
  };

  var resetPassword = function(item) {
    if (busy || !window.confirm('重置「' + adminUserLabel(item) + '」的密码？')) return;
    setBusy(true); setError('');
    window.API.resetAdminUserPassword(item.id)
      .then(function() { window.alert('密码已重置。该用户下次登录时会设置新密码。'); })
      .catch(function(err) { setError(err.message || '重置失败'); })
      .finally(function() { setBusy(false); });
  };

  var updateDisplayName = function(item) {
    if (busy) return;
    var nextName = window.prompt('设置后台展示的真实姓名或昵称。留空则恢复显示登录用户名。', item.display_name || '');
    if (nextName == null) return;
    setBusy(true); setError('');
    window.API.updateAdminUser(item.id, { display_name: nextName.trim() })
      .then(onReload)
      .catch(function(err) { setError(err.message || '展示名称更新失败'); })
      .finally(function() { setBusy(false); });
  };

  var deleteUser = function(item) {
    if (busy || item.id === currentUser.id) return;
    if (!window.confirm('删除用户「' + adminUserLabel(item) + '」？该操作不会删除其历史任务。')) return;
    setBusy(true); setError('');
    window.API.deleteAdminUser(item.id)
      .then(onReload)
      .catch(function(err) { setError(err.message || '删除失败'); })
      .finally(function() { setBusy(false); });
  };

  return (
    <div>
      {error ? <div className="df-admin-error">{error}</div> : null}
      <div className="df-admin-card">
        <div className="df-admin-cardhead">
          <span className="df-admin-cardtitle">账号与权限</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--admin-muted)', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!showTestUsers} onChange={function(e) { if (onToggleShowTest) onToggleShowTest(e.target.checked); }} />
              显示测试账号
            </label>
            <span className="df-admin-cardmeta">{users.length} 个账号</span>
          </div>
        </div>
        <div className="df-admin-form">
          <input className="df-admin-control" value={form.username} placeholder="登录用户名"
            onChange={function(e) { setForm(Object.assign({}, form, { username: e.target.value })); }} />
          <input className="df-admin-control" value={form.displayName} placeholder="真实姓名 / 昵称（可选）"
            onChange={function(e) { setForm(Object.assign({}, form, { displayName: e.target.value })); }} />
          <input className="df-admin-control" type="password" value={form.password} placeholder="初始密码"
            onChange={function(e) { setForm(Object.assign({}, form, { password: e.target.value })); }} />
          <select className="df-admin-control" value={form.role}
            onChange={function(e) { setForm(Object.assign({}, form, { role: e.target.value })); }}>
            <option value="user">普通用户</option>
            <option value="admin">管理员</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--admin-muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={form.isTest} onChange={function(e) { setForm(Object.assign({}, form, { isTest: e.target.checked })); }} />
            测试账号（不入统计）
          </label>
          <button className="df-admin-control df-admin-primary" disabled={busy} onClick={createUser}>新增账号</button>
        </div>
        <div className="df-admin-tablewrap">
          <table className="df-admin-table">
            <thead><tr><th>展示名称</th><th>角色 / 标记</th><th>任务</th><th>AI 生图</th><th>最近活动</th><th>加入时间</th><th>操作</th></tr></thead>
            <tbody>
              {users.map(function(item) {
                var isSelf = item.id === currentUser.id;
                return (
                  <tr key={item.id}>
                    <td className="df-admin-useridentity">
                      <strong>{adminUserLabel(item)}{isSelf ? ' · 当前' : ''}</strong>
                      <span>{item.username} · {item.id}</span>
                    </td>
                    <td>
                      {item.role === 'admin' ? '管理员' : '普通用户'}
                      {item.is_test ? (
                        <span style={{ marginLeft: '6px', color: '#d97706', background: '#fef3c7', padding: '1px 5px', borderRadius: '3px', fontSize: '10px', fontWeight: 600 }}>测试</span>
                      ) : null}
                    </td>
                    <td>{item.total_jobs || 0}</td>
                    <td>{item.total_ai_images || 0}</td>
                    <td className="df-admin-muted">{item.last_action ? adminActionMeta(item.last_action.action)[0] + ' · ' + adminFormatTime(item.last_action.created_at) : '-'}</td>
                    <td className="df-admin-muted">{adminFormatTime(item.created_at)}</td>
                    <td>
                      <button className="df-admin-linkbutton" disabled={busy} onClick={function() { updateDisplayName(item); }}>编辑名称</button>
                      <button className="df-admin-linkbutton" disabled={isSelf || busy} onClick={function() { toggleTestStatus(item); }}>{item.is_test ? '设为正常' : '设为测试'}</button>
                      <button className="df-admin-linkbutton" disabled={isSelf || busy} onClick={function() { updateRole(item); }}>切角色</button>
                      <button className="df-admin-linkbutton" disabled={busy} onClick={function() { resetPassword(item); }}>重置密码</button>
                      <button className="df-admin-linkbutton df-admin-dangerbutton" disabled={isSelf || busy} onClick={function() { deleteUser(item); }}>删除</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AdminTaskDrawer({ task, detail, loading, error, onClose }) {
  if (!task) return null;
  var data = detail || task;
  var request = data.request || {};
  var prompts = data.prompts || {};
  var result = data.result || {};
  var referenceCount = data.reference_count;
  if (referenceCount == null && data.has_reference) referenceCount = '已使用，历史数量未记录';
  if (referenceCount == null) referenceCount = 0;
  var duration = Number(data.updated_at || data.created_at || 0) - Number(data.created_at || 0);
  var promptEntries = [
    ['用户原始 Prompt', prompts.original],
    ['模型最终 Prompt', prompts.resolved],
    ['实际提交 Prompt', prompts.submitted],
  ].filter(function(entry) {
    return adminHasContent(entry[1]);
  });
  var referenceNames = Array.isArray(request.reference_names) ? request.reference_names : [];
  var referencePreviews = Array.isArray(request.reference_previews) ? request.reference_previews : [];
  var resultUrl = result.image_url || data.image_url || '';
  var canPreviewResult = adminCanPreviewImage(resultUrl);
  var penpotUrl = data.penpot_edit_url || result.penpot_edit_url || '';
  var hasResultActions = (!!resultUrl && !canPreviewResult) || !!penpotUrl;
  return (
    <>
      <div className="df-admin-drawerbackdrop" onClick={onClose} />
      <aside className="df-admin-drawer">
        <div className="df-admin-drawerhead">
          <div>
            <div className="df-admin-drawertitle">任务详情</div>
            <div className="df-admin-cardmeta">{ADMIN_TASK_TYPES[task.task_type] || task.task_type}</div>
          </div>
          <button className="df-admin-control df-admin-drawerclose" aria-label="关闭任务详情" title="关闭" onClick={onClose}><I.close size={14} /></button>
        </div>
        <dl className="df-admin-detailgrid">
          <dt>任务 ID</dt><dd className="df-admin-mono">{data.id}</dd>
          <dt>状态</dt><dd><AdminStatusBadge status={data.status} /></dd>
          <dt>用户</dt><dd>{adminUserLabel(data)} <span className="df-admin-faint">· {data.user_id || '-'}</span></dd>
          <dt>创建时间</dt><dd>{adminFormatTime(data.created_at, true)}</dd>
          <dt>最后更新</dt><dd>{adminFormatTime(data.updated_at || data.created_at, true)}</dd>
          <dt>运行耗时</dt><dd>{duration > 0 ? adminFormatAge(duration) : '-'}</dd>
        </dl>
        {loading ? <AdminEmpty text="正在读取完整任务快照…" /> : null}
        {error ? <div className="df-admin-error">{error}</div> : null}
        {!loading && !error ? (
          <>
            <section className="df-admin-detailsection">
              <div className="df-admin-detailtitle">执行配置</div>
              <div className="df-admin-detailcards">
                <div className="df-admin-detailcard"><span>渠道</span><strong>{adminProviderLabel(data.provider || request.provider)}</strong></div>
                <div className="df-admin-detailcard"><span>模型</span><strong>{data.model || request.model || '-'}</strong></div>
                <div className="df-admin-detailcard"><span>尺寸 / 清晰度</span><strong>{[data.size || request.size, data.resolution || request.resolution].filter(Boolean).join(' · ') || '-'}</strong></div>
                <div className="df-admin-detailcard"><span>参考图</span><strong>{referenceCount ? referenceCount + (typeof referenceCount === 'number' ? ' 张' : '') : '未使用'}</strong></div>
                <div className="df-admin-detailcard"><span>批次</span><strong>{request.batch_count ? (Number(request.batch_index || 0) + 1) + ' / ' + request.batch_count : '-'}</strong></div>
                <div className="df-admin-detailcard"><span>Skill</span><strong>{request.skill || '-'}</strong></div>
              </div>
            </section>
            {promptEntries.length ? (
              <section className="df-admin-detailsection">
                <div className="df-admin-detailtitle">Prompt 链路</div>
                {promptEntries.map(function(entry) {
                  return <div className="df-admin-prompt" key={entry[0]}><div className="df-admin-promptlabel">{entry[0]}</div><div className="df-admin-prompttext">{adminPromptText(entry[1])}</div></div>;
                })}
                {adminHasContent(prompts.trace) ? (
                  <details className="df-admin-raw"><summary>查看 Prompt 规划过程</summary><div className="df-admin-code">{adminJsonText(prompts.trace)}</div></details>
                ) : null}
              </section>
            ) : null}
            {(data.has_reference || referenceNames.length || referencePreviews.length) ? (
              <section className="df-admin-detailsection">
                <div className="df-admin-detailtitle">参考图信息</div>
                <dl className="df-admin-detailgrid" style={{ paddingTop: 0 }}>
                  <dt>手动附加</dt><dd>{request.manual_reference_count == null ? '历史数据未记录' : request.manual_reference_count + ' 张'}</dd>
                  <dt>上下文继承</dt><dd>{request.context_reference_count == null ? '历史数据未记录' : request.context_reference_count + ' 张'}</dd>
                  <dt>文件</dt><dd>{referenceNames.length ? referenceNames.join('、') : '历史数据未记录'}</dd>
                </dl>
                {referencePreviews.map(function(url, index) { return <img className="df-admin-resultimage" src={url} alt={'参考图 ' + (index + 1)} key={url + index} />; })}
              </section>
            ) : null}
            <section className="df-admin-detailsection">
              <div className="df-admin-detailtitle">结果与诊断</div>
              {canPreviewResult ? <img className="df-admin-resultimage" src={resultUrl} alt="任务结果" /> : null}
              {hasResultActions ? (
                <div className="df-admin-detailactions">
                  {resultUrl && !canPreviewResult ? <a className="df-admin-control" href={resultUrl} target="_blank" rel="noreferrer">打开结果</a> : null}
                  {penpotUrl ? <a className="df-admin-control" href={penpotUrl} target="_blank" rel="noreferrer">打开 Penpot</a> : null}
                </div>
              ) : null}
              {data.error ? <div className="df-admin-code">{data.error}</div> : null}
              {data.progress_log && data.progress_log.length ? <div className="df-admin-code">{adminJsonText(data.progress_log)}</div> : null}
              <details className="df-admin-raw"><summary>查看完整请求与落库快照</summary><div className="df-admin-code">{adminJsonText(data)}</div></details>
            </section>
          </>
        ) : null}
      </aside>
    </>
  );
}

function AdminPage({ user, onBack }) {
  var [view, setView] = React.useState('overview');
  var [rangeHours, setRangeHours] = React.useState(720);
  var [overview, setOverview] = React.useState(null);
  var [health, setHealth] = React.useState(null);
  var [serviceProbes, setServiceProbes] = React.useState([]);
  var [users, setUsers] = React.useState([]);
  var [tasks, setTasks] = React.useState([]);
  var [taskTotal, setTaskTotal] = React.useState(0);
  var [taskOffset, setTaskOffset] = React.useState(0);
  var [taskFilters, setTaskFilters] = React.useState({ search: '', taskType: '', status: '', userId: '', provider: '', reference: '' });
  var [selectedTask, setSelectedTask] = React.useState(null);
  var [taskDetail, setTaskDetail] = React.useState(null);
  var [taskDetailLoading, setTaskDetailLoading] = React.useState(false);
  var [taskDetailError, setTaskDetailError] = React.useState('');
  var [operations, setOperations] = React.useState([]);
  var [operationTotal, setOperationTotal] = React.useState(0);
  var [operationOffset, setOperationOffset] = React.useState(0);
  var [operationFilters, setOperationFilters] = React.useState({ action: '', userId: '' });
  var [expandedOperations, setExpandedOperations] = React.useState({});
  var [loading, setLoading] = React.useState(false);
  var [error, setError] = React.useState('');
  var [updatedAt, setUpdatedAt] = React.useState(null);

  var [showTestUsers, setShowTestUsers] = React.useState(false);

  var loadUsers = React.useCallback(function(includeTest) {
    var queryInclude = includeTest !== undefined ? includeTest : showTestUsers;
    return window.API.getAdminUsers(queryInclude).then(function(data) {
      setUsers(data.users || []);
      return data.users || [];
    });
  }, [showTestUsers]);

  var handleToggleShowTestUsers = function(nextVal) {
    setShowTestUsers(nextVal);
    loadUsers(nextVal);
  };

  var loadOverview = React.useCallback(function(silent) {
    if (!silent) setLoading(true);
    setError('');
    return Promise.all([
      window.API.getAdminOverview(rangeHours),
      silent
        ? Promise.resolve(null)
        : window.API.fetchDeepHealth().catch(function() { return null; }),
    ]).then(function(result) {
      setOverview(result[0]);
      if (result[1]) setHealth(result[1]);
      setUpdatedAt(Date.now());
    }).catch(function(err) {
      setError(err.message || '运营数据加载失败');
    }).finally(function() {
      if (!silent) setLoading(false);
    });
  }, [rangeHours]);

  var loadServiceProbes = React.useCallback(function() {
    return window.API.getAdminServiceProbes('sub2api', 48)
      .then(function(data) { setServiceProbes(data.probes || []); })
      .catch(function(err) { setError(err.message || '服务探测记录加载失败'); });
  }, []);

  var loadTasks = React.useCallback(function() {
    setLoading(true); setError('');
    return window.API.getAdminTasks({
      limit: 50, offset: taskOffset, search: taskFilters.search,
      taskType: taskFilters.taskType, status: taskFilters.status, userId: taskFilters.userId,
      provider: taskFilters.provider, reference: taskFilters.reference,
    }).then(function(data) {
      setTasks(data.tasks || []); setTaskTotal(data.total || 0); setUpdatedAt(Date.now());
    }).catch(function(err) {
      setError(err.message || '任务加载失败');
    }).finally(function() { setLoading(false); });
  }, [taskOffset, taskFilters]);

  var loadOperations = React.useCallback(function() {
    setLoading(true); setError('');
    return window.API.getAdminOperations(100, operationOffset, operationFilters.action, operationFilters.userId)
      .then(function(data) {
        setOperations(data.operations || []); setOperationTotal(data.total || 0); setUpdatedAt(Date.now());
      }).catch(function(err) {
        setError(err.message || '审计日志加载失败');
      }).finally(function() { setLoading(false); });
  }, [operationOffset, operationFilters]);

  React.useEffect(function() {
    loadUsers().catch(function() {});
  }, [loadUsers]);

  React.useEffect(function() {
    if (view === 'overview' || view === 'services') loadOverview(false);
  }, [view, loadOverview]);

  React.useEffect(function() {
    if (view === 'services') loadServiceProbes();
  }, [view, loadServiceProbes]);

  React.useEffect(function() {
    if (view !== 'tasks') return;
    var timer = window.setTimeout(loadTasks, 220);
    return function() { window.clearTimeout(timer); };
  }, [view, loadTasks]);

  React.useEffect(function() {
    if (view === 'audit') loadOperations();
  }, [view, loadOperations]);

  React.useEffect(function() {
    if (!selectedTask) {
      setTaskDetail(null);
      setTaskDetailError('');
      setTaskDetailLoading(false);
      return;
    }
    var cancelled = false;
    setTaskDetail(null);
    setTaskDetailError('');
    setTaskDetailLoading(true);
    window.API.getAdminTaskDetail(selectedTask.task_type, selectedTask.id)
      .then(function(data) {
        if (!cancelled) setTaskDetail(data.task || null);
      })
      .catch(function(err) {
        if (!cancelled) setTaskDetailError(err.message || '任务详情加载失败');
      })
      .finally(function() {
        if (!cancelled) setTaskDetailLoading(false);
      });
    return function() { cancelled = true; };
  }, [selectedTask]);

  React.useEffect(function() {
    if (view !== 'overview') return;
    var timer = window.setInterval(function() { loadOverview(true); }, 30000);
    return function() { window.clearInterval(timer); };
  }, [view, loadOverview]);

  var setTaskFilter = function(key, value) {
    setTaskOffset(0);
    setTaskFilters(function(prev) { return Object.assign({}, prev, { [key]: value }); });
  };

  var navItems = [
    ['overview', '运营总览', I.grid],
    ['tasks', '任务中心', I.layers],
    ['services', '服务状态', I.zap],
    ['users', '用户权限', I.user],
    ['audit', '审计日志', I.file],
  ];
  var viewTitles = {
    overview: ['运营总览', '任务健康、异常和使用趋势'],
    tasks: ['任务中心', '跨业务查询所有持久化任务'],
    services: ['服务状态', '本机资源与外部依赖连通性'],
    users: ['用户权限', '账号、角色和使用情况'],
    audit: ['审计日志', '关键操作与请求上下文'],
  };

  var doRefresh = function() {
    if (view === 'tasks') return loadTasks();
    if (view === 'audit') return loadOperations();
    if (view === 'users') return loadUsers();
    if (view === 'services') return Promise.all([loadOverview(false), loadServiceProbes()]);
    return loadOverview(false);
  };

  var summary = overview && overview.summary || {};
  var previous = overview && overview.previous_summary || {};
  var currentAdminUser = users.find(function(item) { return item.id === (user && user.id); }) || user || {};
  var successRate = summary.success_rate == null ? '-' : summary.success_rate + '%';
  var volumeFoot = summary.volume_change == null
    ? '上一周期暂无可比数据'
    : <><strong>{summary.volume_change >= 0 ? '+' : ''}{summary.volume_change}%</strong> 较上一周期</>;
  var successFoot = summary.success_rate_change == null
    ? '仅统计已结束任务'
    : <><strong>{summary.success_rate_change >= 0 ? '+' : ''}{summary.success_rate_change}pp</strong> 较上一周期</>;

  var aiProvider = health && health.ai_provider || {};
  var apimartProvider = aiProvider.apimart || aiProvider;
  var services = [
    { name: 'DesignFlow 后端', desc: 'FastAPI 应用', connected: !!(health && health.status === 'ok'), detail: health && health.version, icon: <I.logo size={13} style={{ width: 20, height: 20 }} /> },
    { name: 'Penpot', desc: '模板与合成引擎', connected: !!(health && health.penpot && health.penpot.connected), detail: health && health.penpot && health.penpot.url, icon: <I.layers size={15} /> },
    { name: '产品素材库', desc: '本地产品图资源', connected: !!(health && health.library && health.library.connected), detail: health && health.library && ((health.library.folders || []).length + ' 个目录 · ' + health.library.path), icon: <I.folder size={15} /> },
    { name: '默认生图线路', desc: 'APIMart', connected: !!apimartProvider.connected, configured: !!apimartProvider.configured, detail: apimartProvider.message || apimartProvider.url, icon: <I.image size={15} /> },
    { name: '订阅生图线路', desc: 'CLIProxyAPI · 每小时生图探测', connected: !!(aiProvider.sub2api && aiProvider.sub2api.connected), configured: !!(aiProvider.sub2api && aiProvider.sub2api.configured), probing: !!(aiProvider.sub2api && aiProvider.sub2api.last_probe && aiProvider.sub2api.last_probe.status === 'running'), detail: aiProvider.sub2api && (aiProvider.sub2api.message || aiProvider.sub2api.url), icon: <I.zap size={15} /> },
    { name: 'Adobe 生图线路', desc: 'adobe2api · Firefly', connected: !!(aiProvider.adobe2api && aiProvider.adobe2api.connected), configured: !!(aiProvider.adobe2api && aiProvider.adobe2api.configured), detail: aiProvider.adobe2api && (aiProvider.adobe2api.message || aiProvider.adobe2api.url), icon: <I.image size={15} /> },
  ];

  var renderOverview = function() {
    if (!overview) return <AdminEmpty text={loading ? '正在加载运营数据…' : '运营数据暂不可用'} />;
    var stale = overview && overview.stale_tasks || [];
    var staleAlertKey = overview && overview.stale_alert_key || '';
    var showStaleAlert = stale.length > 0 && !overview.stale_alert_acknowledged;
    var maxBreakdown = Math.max.apply(null, [1].concat((overview && overview.breakdown || []).map(function(item) { return item.total || 0; })));
    return (
      <>
        {showStaleAlert ? (
          <div className="df-admin-alert">
            <span className="df-admin-alertdot" />
            检测到 {stale.length} 个任务超过 10 分钟仍未结束，建议先进入任务中心核对。
            <button className="df-admin-cardaction" onClick={function() { setTaskFilter('status', 'active'); setView('tasks'); }}>查看任务 →</button>
            <button className="df-admin-alertclose" aria-label="关闭异常提示" title="关闭"
              onClick={function() {
                window.API.acknowledgeAdminStaleAlert(staleAlertKey)
                  .then(function() {
                    setOverview(function(prev) {
                      return Object.assign({}, prev, { stale_alert_acknowledged: true });
                    });
                  })
                  .catch(function(err) { setError(err.message || '异常确认失败'); });
              }}><I.close size={13} /></button>
          </div>
        ) : null}
        <div className="df-admin-metrics">
          <AdminMetric label="任务成功率" value={successRate} foot={successFoot} color="#1ca66a" />
          <AdminMetric label="任务总量" value={summary.total || 0} foot={volumeFoot} color="#20231f" />
          <AdminMetric label="正在处理" value={summary.active || 0} foot={'上一周期 ' + (previous.active || 0)} color="#bd741d" />
          <AdminMetric label="失败任务" value={summary.failed || 0} foot={'上一周期 ' + (previous.failed || 0)} color="#d44747" />
        </div>
        <AdminHealthTimeline
          timeline={overview.health_timeline}
          summary={summary}
          breakdown={overview.breakdown}
          hours={overview.range_hours}
        />
        <div className="df-admin-grid">
          <section className="df-admin-card">
            <div className="df-admin-cardhead">
              <span className="df-admin-cardtitle">使用趋势</span>
              <span className="df-admin-cardmeta df-admin-legend">
                <span><i />AI 生图</span><span className="is-agent"><i />Agent</span><span className="is-compose"><i />模板合成</span><span className="is-special"><i />特殊品</span>
              </span>
            </div>
            <AdminTrendChart series={overview.series} hours={overview.range_hours} />
          </section>
          <section className="df-admin-card">
            <div className="df-admin-cardhead">
              <span className="df-admin-cardtitle">业务构成</span>
              <span className="df-admin-cardmeta">{overview.active_users || 0} 位活跃用户</span>
            </div>
            <div className="df-admin-breakdown">
              {(overview.breakdown || []).map(function(item) {
                return (
                  <div className="df-admin-breakrow" key={item.type}>
                    <div className="df-admin-breaktop">
                      <span>{ADMIN_TASK_TYPES[item.type] || item.type}</span>
                      <span className="df-admin-breakvalue">{item.total}</span>
                    </div>
                    <div className="df-admin-progress"><span style={{ width: Math.round(item.total * 100 / maxBreakdown) + '%' }} /></div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
        <div className="df-admin-overviewtriple">
          <AdminUserRanking items={overview.user_ranking} hours={overview.range_hours} />
          <section className="df-admin-card">
            <div className="df-admin-cardhead">
              <span className="df-admin-cardtitle">最近失败</span>
              <button className="df-admin-cardaction" onClick={function() { setTaskFilter('status', 'failed'); setView('tasks'); }}>全部失败 →</button>
            </div>
            {(overview.recent_failures || []).length ? (
              <div className="df-admin-tablewrap"><table className="df-admin-table"><tbody>
                {overview.recent_failures.slice(0, 5).map(function(item) {
                  return <tr key={item.id}><td><AdminStatusBadge status="failed" /></td><td className="df-admin-mono">{String(item.id).slice(0, 8)}</td><td className="df-admin-ellipsis df-admin-muted">{item.error}</td><td className="df-admin-faint">{adminFormatTime(item.created_at)}</td></tr>;
                })}
              </tbody></table></div>
            ) : <AdminEmpty text="当前周期没有失败任务" />}
          </section>
          <section className="df-admin-card">
            <div className="df-admin-cardhead">
              <span className="df-admin-cardtitle">服务概况</span>
              <button className="df-admin-cardaction" onClick={function() { setView('services'); }}>查看详情 →</button>
            </div>
            <div className="df-admin-breakdown">
              {services.slice(0, 5).map(function(item) {
                return (
                  <div className="df-admin-breakrow" key={item.name}>
                    <div className="df-admin-breaktop"><span>{item.name}</span><AdminStatusBadge status={item.probing ? 'active' : (item.connected ? 'done' : 'failed')} /></div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </>
    );
  };

  var renderTasks = function() {
    return (
      <>
        <div className="df-admin-toolbar">
          <div className="df-admin-search"><I.search size={13} /><input className="df-admin-control" value={taskFilters.search} placeholder="搜索任务 ID、用户、模型或内容"
            onChange={function(e) { setTaskFilter('search', e.target.value); }} /></div>
          <select className="df-admin-control" value={taskFilters.taskType} onChange={function(e) { setTaskFilter('taskType', e.target.value); }}>
            <option value="">全部业务</option><option value="ai_image">AI 生图</option><option value="agent_image">Agent 生图</option><option value="compose">模板合成</option><option value="special">特殊品</option>
          </select>
          <select className="df-admin-control" value={taskFilters.status} onChange={function(e) { setTaskFilter('status', e.target.value); }}>
            <option value="">全部状态</option><option value="active">进行中</option><option value="done">已完成</option><option value="failed">失败</option>
          </select>
          <select className="df-admin-control" value={taskFilters.userId} onChange={function(e) { setTaskFilter('userId', e.target.value); }}>
            <option value="">全部用户</option>{users.map(function(item) { return <option value={item.id} key={item.id}>{adminUserLabel(item)}</option>; })}
          </select>
          <select className="df-admin-control" value={taskFilters.provider} onChange={function(e) { setTaskFilter('provider', e.target.value); }}>
            <option value="">全部渠道</option><option value="apimart">默认线路</option><option value="sub2api">订阅线路</option><option value="adobe2api">Adobe 线路</option><option value="penpot">Penpot</option><option value="local">本地处理</option>
          </select>
          <select className="df-admin-control" value={taskFilters.reference} onChange={function(e) { setTaskFilter('reference', e.target.value); }}>
            <option value="">参考图不限</option><option value="yes">使用参考图</option><option value="no">未用参考图</option>
          </select>
          <span className="df-admin-pageinfo">共 {taskTotal} 条</span>
          <button className="df-admin-control df-admin-pagebutton" disabled={!taskOffset} onClick={function() { setTaskOffset(Math.max(0, taskOffset - 50)); }}>‹</button>
          <button className="df-admin-control df-admin-pagebutton" disabled={taskOffset + 50 >= taskTotal} onClick={function() { setTaskOffset(taskOffset + 50); }}>›</button>
        </div>
        <div className="df-admin-card">
          {tasks.length ? (
            <div className="df-admin-tablewrap"><table className="df-admin-table">
              <thead><tr><th>状态</th><th>业务</th><th>任务 ID</th><th>用户</th><th>模型 / 内容</th><th>渠道</th><th>参考图</th><th>进度</th><th>创建时间</th></tr></thead>
              <tbody>{tasks.map(function(item) {
                return (
                  <tr className="is-clickable" key={item.task_type + ':' + item.id} onClick={function() { setSelectedTask(item); }}>
                    <td><AdminStatusBadge status={item.status} /></td>
                    <td>{ADMIN_TASK_TYPES[item.task_type] || item.task_type}</td>
                    <td className="df-admin-mono">{String(item.id).slice(0, 12)}</td>
                    <td>{adminUserLabel(item)}</td>
                    <td><div>{item.model || '-'}</div><div className="df-admin-ellipsis df-admin-faint">{item.summary || item.error || '-'}</div></td>
                    <td>{adminProviderLabel(item.provider)}</td>
                    <td>{item.has_reference ? (item.reference_count == null ? '有' : item.reference_count + ' 张') : '无'}</td>
                    <td>{Number(item.progress || 0)}%</td>
                    <td className="df-admin-muted">{adminFormatTime(item.created_at, true)}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          ) : <AdminEmpty text={loading ? '正在加载任务…' : '没有匹配的任务'} />}
        </div>
      </>
    );
  };

  var renderServices = function() {
    if (!health) return <AdminEmpty text={loading ? '正在探测服务状态…' : '服务状态暂不可用'} />;
    return (
      <>
        <div className="df-admin-servicegrid">
          {services.map(function(item) { return <AdminServiceCard key={item.name} {...item} />; })}
        </div>
        <section className="df-admin-card df-admin-section">
          <div className="df-admin-cardhead">
            <span className="df-admin-cardtitle">订阅线路探测记录</span>
            <span className="df-admin-cardmeta">最近 48 次 · 每小时真实生图</span>
          </div>
          {serviceProbes.length ? (
            <div className="df-admin-probelist">
              {serviceProbes.map(function(item) {
                var result = item.result || {};
                var imageUrl = result.image_url || '';
                var scheduledLabel = String(item.scheduled_slot || '').slice(5, 16).replace('T', ' ');
                return (
                  <article className="df-admin-probe" key={item.id || item.scheduled_slot}>
                    <span className={'df-admin-probedot is-' + item.status} title={adminStatusText(item.status)} />
                    <div>
                      <div className="df-admin-probetime">{adminFormatTime(item.created_at, true)} · {adminStatusText(item.status)}</div>
                      {item.error ? <div className="df-admin-probeerror" title={item.error}>{item.error}</div> : null}
                    </div>
                    <span className="df-admin-probemeta df-admin-probecompleted">
                      {item.completed_at ? adminFormatTime(item.completed_at, true) : '等待完成'}
                    </span>
                    <span className="df-admin-probemeta">
                      {item.latency_ms != null ? (Number(item.latency_ms) / 1000).toFixed(1) + ' 秒' : '—'}
                    </span>
                    {imageUrl
                      ? <a className="df-admin-probethumb" href={imageUrl} target="_blank" rel="noreferrer" title="查看测试结果">
                          <img src={imageUrl} alt={'订阅线路探测 ' + scheduledLabel} loading="lazy" />
                        </a>
                      : <span className="df-admin-probenoimage" title={item.status === 'running' ? '正在生成测试图' : '没有返回图片'} />}
                  </article>
                );
              })}
            </div>
          ) : <AdminEmpty text="暂无订阅线路探测记录" />}
        </section>
        <div className="df-admin-card df-admin-section">
          <div className="df-admin-cardhead"><span className="df-admin-cardtitle">运行说明</span></div>
          <div style={{ padding: 16, color: 'var(--admin-muted)', fontSize: 10.5, lineHeight: 1.8 }}>
            基础服务会在刷新时执行实时探测。订阅生图线路在每日 09:00 至 21:00 每小时提交一次真实生图任务，
            只有成功生成并取回图片才会标记为可用；探测结果不会计入用户任务与业务统计。
          </div>
        </div>
      </>
    );
  };

  var renderAudit = function() {
    return (
      <>
        <div className="df-admin-toolbar">
          <select className="df-admin-control" value={operationFilters.userId} onChange={function(e) { setOperationOffset(0); setOperationFilters(Object.assign({}, operationFilters, { userId: e.target.value })); }}>
            <option value="">全部用户</option>{users.map(function(item) { return <option value={item.id} key={item.id}>{adminUserLabel(item)}</option>; })}
          </select>
          <select className="df-admin-control" value={operationFilters.action} onChange={function(e) { setOperationOffset(0); setOperationFilters(Object.assign({}, operationFilters, { action: e.target.value })); }}>
            <option value="">全部操作</option>{Object.keys(ADMIN_ACTIONS).map(function(key) { return <option value={key} key={key}>{ADMIN_ACTIONS[key][0]}</option>; })}
          </select>
          <span className="df-admin-pageinfo">共 {operationTotal} 条</span>
          <button className="df-admin-control df-admin-pagebutton" disabled={!operationOffset} onClick={function() { setOperationOffset(Math.max(0, operationOffset - 100)); }}>‹</button>
          <button className="df-admin-control df-admin-pagebutton" disabled={operationOffset + 100 >= operationTotal} onClick={function() { setOperationOffset(operationOffset + 100); }}>›</button>
        </div>
        <div className="df-admin-card">
          {operations.length ? <div className="df-admin-tablewrap"><table className="df-admin-table">
            <thead><tr><th>时间</th><th>用户</th><th>操作</th><th>详情</th><th>上下文</th></tr></thead>
            <tbody>{operations.map(function(item) {
              var meta = adminActionMeta(item.action);
              var expanded = !!expandedOperations[item.id];
              return (
                <React.Fragment key={item.id}>
                  <tr>
                    <td className="df-admin-muted">{adminFormatTime(item.created_at, true)}</td>
                    <td>{adminUserLabel(item)}</td>
                    <td><span style={{ color: meta[1] }}>{meta[0]}</span></td>
                    <td className="df-admin-ellipsis df-admin-muted">{item.detail || '-'}</td>
                    <td>{item.payload ? <button className="df-admin-linkbutton" onClick={function() { setExpandedOperations(function(prev) { var next = Object.assign({}, prev); next[item.id] = !next[item.id]; return next; }); }}>{expanded ? '收起' : '查看 JSON'}</button> : '-'}</td>
                  </tr>
                  {expanded ? <tr><td colSpan="5"><div className="df-admin-code">{(function() { try { return JSON.stringify(JSON.parse(item.payload), null, 2); } catch (e) { return item.payload; } })()}</div></td></tr> : null}
                </React.Fragment>
              );
            })}</tbody>
          </table></div> : <AdminEmpty text={loading ? '正在加载日志…' : '暂无操作记录'} />}
        </div>
      </>
    );
  };

  return (
    <div className="df-admin">
      <style>{ADMIN_CSS}</style>
      <aside className="df-admin-sidebar">
        <div className="df-admin-brand">
          <div className="df-admin-brandmark"><I.zap size={15} /></div>
          <div className="df-admin-brandname">DesignFlow</div>
          <div className="df-admin-brandmeta">Operations</div>
        </div>
        <div className="df-admin-navlabel">Workspace</div>
        <nav className="df-admin-nav">
          {navItems.map(function(item) {
            var NavIcon = item[2];
            return <button key={item[0]} className={'df-admin-navbutton ' + (view === item[0] ? 'is-active' : '')} onClick={function() { setView(item[0]); }}><NavIcon size={14} /><span>{item[1]}</span></button>;
          })}
        </nav>
        <div className="df-admin-sidebarfoot">
          <div className="df-admin-userline">
            <span className="df-admin-avatar">{String(adminUserLabel(currentAdminUser)).slice(0, 1).toUpperCase()}</span>
            <div><div className="df-admin-username">{adminUserLabel(currentAdminUser)}</div><div className="df-admin-role">Administrator</div></div>
          </div>
          <button className="df-admin-back" onClick={onBack}><span>返回工作台</span></button>
        </div>
      </aside>
      <main className="df-admin-main">
        <header className="df-admin-header">
          <div><div className="df-admin-title">{viewTitles[view][0]}</div><div className="df-admin-subtitle">{viewTitles[view][1]}</div></div>
          <div className="df-admin-headtools">
            {view === 'overview' ? (
              <select className="df-admin-control" value={rangeHours} onChange={function(e) { setRangeHours(Number(e.target.value)); }}>
                <option value="24">1 天内</option><option value="168">最近 7 天</option><option value="720">最近 30 天</option><option value="0">所有时间</option>
              </select>
            ) : null}
            {updatedAt ? <span className="df-admin-updated">更新于 {new Date(updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span> : null}
            <button className="df-admin-control" onClick={doRefresh} disabled={loading}><I.refresh size={12} />刷新</button>
          </div>
        </header>
        <div className="df-admin-scroll">
          <div className="df-admin-content">
            {error ? <div className="df-admin-error">{error}</div> : null}
            {view === 'overview' ? renderOverview() : null}
            {view === 'tasks' ? renderTasks() : null}
            {view === 'services' ? renderServices() : null}
            {view === 'users' ? <AdminUserManagement currentUser={user} users={users} onReload={function() { return loadUsers(showTestUsers); }} showTestUsers={showTestUsers} onToggleShowTest={handleToggleShowTestUsers} /> : null}
            {view === 'audit' ? renderAudit() : null}
          </div>
        </div>
      </main>
      <AdminTaskDrawer task={selectedTask} detail={taskDetail} loading={taskDetailLoading} error={taskDetailError} onClose={function() { setSelectedTask(null); }} />
    </div>
  );
}

window.AdminPage = AdminPage;
