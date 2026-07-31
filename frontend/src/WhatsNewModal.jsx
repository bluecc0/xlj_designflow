// What's New update card — each release version shows once after login

const WHATS_NEW_SEEN_KEY = 'designflow_whats_new_seen';

const markWhatsNewSeen = function(version) {
  const value = String(version || '').trim();
  if (!value) return;
  try {
    localStorage.setItem(WHATS_NEW_SEEN_KEY, value);
  } catch (e) {}
};

const getSeenWhatsNewVersion = function() {
  try {
    return String(localStorage.getItem(WHATS_NEW_SEEN_KEY) || '').trim();
  } catch (e) {
    return '';
  }
};

const WhatsNewFeatureIcon = ({ type }) => {
  const wrap = {
    width: 36,
    height: 36,
    borderRadius: 10,
    background: 'var(--accent-soft)',
    color: 'var(--accent-ink)',
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
  };
  let glyph = null;
  if (type === 'image') {
    glyph = React.createElement(I.image, { size: 16, stroke: 1.7 });
  } else if (type === 'agent') {
    glyph = React.createElement(I.user, { size: 16, stroke: 1.7 });
  } else if (type === 'pages') {
    glyph = React.createElement(I.grid, { size: 16, stroke: 1.7 });
  } else if (type === 'sparkles') {
    glyph = React.createElement(I.sparkles, { size: 16, stroke: 1.7 });
  } else {
    glyph = React.createElement(I.zap, { size: 16, stroke: 1.7 });
  }
  return React.createElement('div', { style: wrap }, glyph);
};

const WhatsNewModal = ({ release, onClose }) => {
  if (!release) return null;

  const features = Array.isArray(release.features) ? release.features : [];
  const versionLabel = [release.version, release.date].filter(Boolean).join(' · ');

  // 用户确认后写入当前版本；同一 version 之后不再弹出
  const dismiss = function() {
    markWhatsNewSeen(release.version);
    if (onClose) onClose();
  };

  const openChangelog = function() {
    const raw = String(release.changelogUrl || 'https://github.com/bluecc0/xlj_designflow/commits/master/').trim()
      || 'https://github.com/bluecc0/xlj_designflow/commits/master/';
    try {
      const url = new URL(raw, window.location.href).toString();
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      window.open(raw, '_blank', 'noopener,noreferrer');
    }
  };

  return React.createElement('div', {
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 240,
      display: 'grid',
      placeItems: 'center',
      padding: 20,
      background: 'rgba(40, 42, 48, 0.48)',
    },
    onClick: function(e) {
      if (e.target === e.currentTarget) dismiss();
    },
  },
    React.createElement('div', {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': release.title || '更新提示',
      style: {
        width: 'min(420px, calc(100vw - 40px))',
        background: 'var(--panel)',
        borderRadius: 20,
        boxShadow: '0 24px 64px rgba(20, 22, 40, 0.18), 0 2px 8px rgba(20, 22, 40, 0.06)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      },
      onClick: function(e) { e.stopPropagation(); },
    },
      React.createElement('div', {
        style: {
          padding: '22px 22px 8px',
          position: 'relative',
        },
      },
        React.createElement('div', {
          style: {
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            marginBottom: 18,
          },
        },
          React.createElement('div', {
            style: {
              width: 40,
              height: 40,
              borderRadius: 12,
              background: 'var(--ink)',
              color: 'var(--panel)',
              display: 'grid',
              placeItems: 'center',
            },
          }, React.createElement(I.sparkles, { size: 18, stroke: 1.8 })),
          React.createElement('button', {
            type: 'button',
            onClick: dismiss,
            'aria-label': '关闭',
            style: {
              width: 28,
              height: 28,
              borderRadius: 8,
              display: 'grid',
              placeItems: 'center',
              color: 'var(--ink-3)',
              cursor: 'pointer',
              marginTop: -2,
              marginRight: -4,
            },
          }, React.createElement(I.close, { size: 15, stroke: 1.8 }))
        ),
        React.createElement('div', {
          style: {
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
            lineHeight: 1.25,
            marginBottom: 6,
          },
        }, release.title || 'Designflow 更新了'),
        versionLabel ? React.createElement('div', {
          style: {
            fontSize: 12.5,
            color: 'var(--ink-3)',
            letterSpacing: '-0.01em',
            marginBottom: 18,
          },
        }, versionLabel) : null,
        React.createElement('div', {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            paddingBottom: 8,
          },
        },
          features.map(function(item, idx) {
            return React.createElement('div', {
              key: item.title || idx,
              style: {
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
              },
            },
              React.createElement(WhatsNewFeatureIcon, { type: item.icon }),
              React.createElement('div', { style: { minWidth: 0, flex: 1, paddingTop: 1 } },
                React.createElement('div', {
                  style: {
                    fontSize: 13.5,
                    fontWeight: 650,
                    color: 'var(--ink)',
                    letterSpacing: '-0.01em',
                    lineHeight: 1.3,
                    marginBottom: 3,
                  },
                }, item.title || ''),
                React.createElement('div', {
                  style: {
                    fontSize: 12.5,
                    color: 'var(--ink-2)',
                    lineHeight: 1.55,
                    letterSpacing: '-0.005em',
                  },
                }, item.desc || '')
              )
            );
          })
        )
      ),
      React.createElement('div', {
        style: {
          borderTop: '1px solid var(--line)',
          padding: '14px 18px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 8,
          background: 'var(--panel)',
        },
      },
        React.createElement('button', {
          type: 'button',
          onClick: openChangelog,
          style: {
            height: 34,
            padding: '0 14px',
            borderRadius: 10,
            border: '1px solid var(--line)',
            background: 'var(--panel)',
            color: 'var(--ink-2)',
            fontSize: 12.5,
            fontWeight: 550,
            cursor: 'pointer',
            letterSpacing: '-0.01em',
          },
        }, '更新日志'),
        React.createElement('button', {
          type: 'button',
          onClick: dismiss,
          style: {
            height: 34,
            padding: '0 16px',
            borderRadius: 10,
            border: '1px solid var(--ink)',
            background: 'var(--ink)',
            color: 'var(--panel)',
            fontSize: 12.5,
            fontWeight: 650,
            cursor: 'pointer',
            letterSpacing: '-0.01em',
          },
        }, '我知道了')
      )
    )
  );
};

// 仅当 whats-new.json 的 version 与本地已确认版本不同时弹出
const shouldShowWhatsNew = function(release) {
  if (!release) return false;
  const version = String(release.version || '').trim();
  if (!version) return false;
  return getSeenWhatsNewVersion() !== version;
};

const loadWhatsNewRelease = function() {
  return fetch('whats-new.json', { cache: 'no-cache' })
    .then(function(res) {
      if (!res.ok) throw new Error('whats-new fetch failed');
      return res.json();
    })
    .catch(function() { return null; });
};

window.WhatsNewModal = WhatsNewModal;
window.shouldShowWhatsNew = shouldShowWhatsNew;
window.loadWhatsNewRelease = loadWhatsNewRelease;
window.markWhatsNewSeen = markWhatsNewSeen;
window.WHATS_NEW_SEEN_KEY = WHATS_NEW_SEEN_KEY;
