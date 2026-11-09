// Personal settings: avatar, nickname, send shortcut, default image options and password.
// Usage: <UserAvatar user={user} size={22}/>, <PersonalSettingsModal user={user} onClose onUserChange/>

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
const MOD_KEY_LABEL = IS_MAC ? '⌘' : 'Ctrl';

const DEFAULT_MODEL_OPTIONS = [
  ['gpt-image-2.6', 'GPT Image 2.6'],
  ['gpt-image-2', 'GPT Image 2'],
  ['nano-banana-pro', 'Nano Banana Pro'],
  ['nano-banana-2.1', 'Nano Banana 2.1'],
  ['seedream-5-0-flash', 'Seedream 5.0'],
];
const DEFAULT_RATIO_OPTIONS = [
  ['auto', '自动'], ['1:1', '1:1'], ['3:4', '3:4'], ['4:3', '4:3'], ['2:3', '2:3'], ['3:2', '3:2'],
  ['9:16', '9:16'], ['16:9', '16:9'], ['5:4', '5:4'],
];
const DEFAULT_RESOLUTION_OPTIONS = [['1K', '1K'], ['2K', '2K'], ['4K', '4K']];

const userDisplayName = function(user) {
  // 自己界面上显示昵称，没设置就用登录名；真实姓名只给同事和管理后台看
  return (user && (user.nickname || user.username)) || '';
};

const UserAvatar = ({ user, size, radius }) => {
  const [failed, setFailed] = React.useState(false);
  const src = user && user.avatar_url ? user.avatar_url : '';
  React.useEffect(function() { setFailed(false); }, [src]);
  const dim = size || 22;
  return (
    <span style={{
      width: dim, height: dim, borderRadius: radius == null ? Math.round(dim * 0.28) : radius, flexShrink: 0,
      display: 'grid', placeItems: 'center', overflow: 'hidden',
      fontSize: Math.max(10, Math.round(dim * 0.45)), fontWeight: 600,
      background: 'var(--accent-soft)', color: 'var(--accent-ink)',
    }}>
      {src && !failed
        ? <img src={src} alt="" onError={function() { setFailed(true); }} style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
        : userDisplayName(user).slice(0, 1).toUpperCase()}
    </span>
  );
};

const settingsInputStyle = {
  height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--panel)',
  color: 'var(--ink)', fontSize: 12, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
};

const settingsButtonStyle = function(primary) {
  return {
    height: 32, padding: '0 14px', borderRadius: 8, fontSize: 12, fontWeight: primary ? 600 : 400, cursor: 'pointer',
    border: '1px solid ' + (primary ? 'var(--ink)' : 'var(--line)'),
    background: primary ? 'var(--ink)' : 'var(--panel)', color: primary ? 'white' : 'var(--ink-2)',
    whiteSpace: 'nowrap',
  };
};

const SettingsSection = ({ title, children }) => (
  <section style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 0', borderTop: '1px solid var(--line-2)' }}>
    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>{title}</div>
    {children}
  </section>
);

const SettingsRow = ({ label, hint, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 32 }}>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12, color: 'var(--ink)' }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2, lineHeight: 1.5 }}>{hint}</div>}
    </div>
    {children}
  </div>
);

const SettingsSegmented = ({ value, options, onChange, disabled }) => (
  <div role="radiogroup" style={{ display: 'flex', padding: 2, borderRadius: 8, background: 'var(--panel-2)', border: '1px solid var(--line-2)' }}>
    {options.map(function(item) {
      const active = value === item[0];
      return (
        <button key={item[0]} type="button" role="radio" aria-checked={active} disabled={disabled}
          onClick={function() { if (!active) onChange(item[0]); }}
          style={{
            height: 26, padding: '0 10px', border: 0, borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
            background: active ? 'var(--panel)' : 'transparent', color: active ? 'var(--ink)' : 'var(--ink-3)',
            fontWeight: active ? 600 : 400, boxShadow: active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
          }}>{item[1]}</button>
      );
    })}
  </div>
);

const SettingsSelect = ({ value, options, onChange, disabled, label }) => (
  <select aria-label={label} value={value} disabled={disabled} onChange={function(e) { onChange(e.target.value); }}
    style={Object.assign({}, settingsInputStyle, { width: 150, cursor: 'pointer' })}>
    {options.map(function(item) { return <option key={item[0]} value={item[0]}>{item[1]}</option>; })}
  </select>
);

// 保存动作与 React 解耦：每次都从最新的用户对象合并，几个设置并行保存时，
// 先返回的响应不会用旧快照覆盖别处刚保存的头像、昵称或偏好。
// onUserChange 接收 updater(prev)；getUser 返回当前界面上的用户对象。
const createPersonalSettingsActions = function({ api, getUser, onUserChange }) {
  const merge = function(patch) {
    onUserChange(function(prev) { return Object.assign({}, prev, patch); });
  };
  // 只在这个设置项仍是本次请求写入的值时才改它，避免回写覆盖之后的新选择
  const setPreferenceIf = function(key, expected, next) {
    onUserChange(function(prev) {
      const prefs = (prev && prev.preferences) || {};
      if (prefs[key] !== expected) return prev;
      return Object.assign({}, prev, { preferences: Object.assign({}, prefs, { [key]: next }) });
    });
  };
  return {
    uploadAvatar: async function(file) {
      merge({ avatar_url: await api.uploadAvatar(file) });
    },
    removeAvatar: async function() {
      await api.deleteAvatar();
      merge({ avatar_url: '' });
    },
    saveNickname: async function(nickname) {
      const next = await api.saveProfile({ nickname: nickname });
      merge({ nickname: next.nickname || '' });
      return next.nickname || '';
    },
    savePreference: async function(key, value) {
      const current = getUser();
      const previous = ((current && current.preferences) || {})[key];
      onUserChange(function(prev) {
        const prefs = (prev && prev.preferences) || {};
        return Object.assign({}, prev, { preferences: Object.assign({}, prefs, { [key]: value }) });
      });
      try {
        const saved = await api.savePreferences({ [key]: value });
        setPreferenceIf(key, value, saved && saved[key] !== undefined ? saved[key] : value);
      } catch (err) {
        setPreferenceIf(key, value, previous);
        throw err;
      }
    },
  };
};

const PersonalSettingsModal = ({ user, onClose, onUserChange }) => {
  const prefs = (user && user.preferences) || {};
  const [nickname, setNickname] = React.useState((user && user.nickname) || '');
  const [savingName, setSavingName] = React.useState(false);
  const [avatarBusy, setAvatarBusy] = React.useState(false);
  const [savingPrefs, setSavingPrefs] = React.useState({});
  const [passwordOpen, setPasswordOpen] = React.useState(false);
  const [oldPassword, setOldPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [savingPassword, setSavingPassword] = React.useState(false);
  const fileRef = React.useRef(null);

  React.useEffect(function() {
    const onKey = function(e) { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return function() { window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const userRef = React.useRef(user);
  userRef.current = user;
  const actions = React.useMemo(function() {
    return createPersonalSettingsActions({
      api: window.API,
      getUser: function() { return userRef.current; },
      onUserChange: onUserChange,
    });
  }, [onUserChange]);

  const pickAvatar = async function(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setAvatarBusy(true);
    try {
      await actions.uploadAvatar(file);
      window.dfToast('头像已更新', { tone: 'ok', key: 'personal-settings' });
    } catch (err) {
      window.dfError(err, '头像暂时无法上传，请换一张图片再试。', { key: 'personal-settings' });
    } finally {
      setAvatarBusy(false);
    }
  };

  const removeAvatar = async function() {
    setAvatarBusy(true);
    try {
      await actions.removeAvatar();
    } catch (err) {
      window.dfError(err, '头像暂时无法移除，请稍后再试。', { key: 'personal-settings' });
    } finally {
      setAvatarBusy(false);
    }
  };

  const nameChanged = nickname.trim() !== ((user && user.nickname) || '');
  const saveName = async function() {
    setSavingName(true);
    try {
      setNickname(await actions.saveNickname(nickname));
      window.dfToast('昵称已保存', { tone: 'ok', key: 'personal-settings' });
    } catch (err) {
      window.dfError(err, '昵称暂时无法保存，请稍后再试。', { key: 'personal-settings' });
    } finally {
      setSavingName(false);
    }
  };

  const savePref = async function(key, value) {
    setSavingPrefs(function(prev) { return Object.assign({}, prev, { [key]: true }); });
    try {
      await actions.savePreference(key, value);
    } catch (err) {
      window.dfError(err, '设置暂时无法保存，请稍后再试。', { key: 'personal-settings' });
    } finally {
      setSavingPrefs(function(prev) { return Object.assign({}, prev, { [key]: false }); });
    }
  };

  const passwordError = newPassword && newPassword !== newPassword.trim()
    ? '新密码首尾不能有空格'
    : newPassword && newPassword.length < 6
    ? '新密码至少 6 位'
    : confirmPassword && confirmPassword !== newPassword ? '两次输入的新密码不一致' : '';
  const canSavePassword = oldPassword && newPassword && confirmPassword && !passwordError && !savingPassword;
  const savePassword = async function(e) {
    e.preventDefault();
    if (!canSavePassword) return;
    setSavingPassword(true);
    try {
      await window.API.changePassword(oldPassword, newPassword);
      setOldPassword(''); setNewPassword(''); setConfirmPassword(''); setPasswordOpen(false);
      window.dfToast('密码已修改，其他设备需要重新登录', { tone: 'ok', key: 'personal-settings' });
    } catch (err) {
      window.dfError(err, '密码暂时无法修改，请稍后再试。', { key: 'personal-settings' });
    } finally {
      setSavingPassword(false);
    }
  };

  const sendHint = prefs.send_shortcut === 'mod_enter'
    ? MOD_KEY_LABEL + '+Enter 发送，Enter 换行'
    : 'Enter 发送，Shift+Enter 换行';

  return (
    <div onMouseDown={function(e) { if (e.target === e.currentTarget) onClose(); }} style={{
      position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(15,23,42,0.24)', display: 'grid', placeItems: 'center', padding: 16,
    }}>
      <div role="dialog" aria-modal="true" aria-label="个人设置" style={{
        width: 460, maxWidth: '100%', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', boxSizing: 'border-box',
        borderRadius: 16, padding: '18px 22px 6px', background: 'var(--panel)', border: '1px solid var(--line-2)',
        boxShadow: '0 18px 50px rgba(15,23,42,0.18)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>个人设置</div>
          <button type="button" onClick={onClose} aria-label="关闭个人设置" style={{
            width: 28, height: 28, borderRadius: 8, border: 0, background: 'transparent', color: 'var(--ink-3)', cursor: 'pointer',
            display: 'grid', placeItems: 'center',
          }}><I.close size={14}/></button>
        </div>

        {/* 头像与账号 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingBottom: 16 }}>
          <button type="button" disabled={avatarBusy} onClick={function() { fileRef.current && fileRef.current.click(); }}
            title="更换头像" aria-label="更换头像"
            style={{ padding: 0, border: 0, background: 'none', cursor: avatarBusy ? 'wait' : 'pointer', borderRadius: 18, position: 'relative' }}>
            <UserAvatar user={user} size={56} radius={18}/>
            <span style={{
              position: 'absolute', right: -3, bottom: -3, width: 22, height: 22, borderRadius: 99, display: 'grid', placeItems: 'center',
              background: 'var(--ink)', color: 'white', border: '2px solid var(--panel)',
            }}><I.image size={10}/></span>
          </button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={pickAvatar} style={{ display: 'none' }}/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userDisplayName(user)}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 3 }}>
              登录名 {user && user.username} · {user && user.role === 'admin' ? '管理员' : '成员'}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 6, fontSize: 11 }}>
              <button type="button" disabled={avatarBusy} onClick={function() { fileRef.current && fileRef.current.click(); }}
                style={{ border: 0, background: 'none', padding: 0, color: 'var(--accent-ink)', cursor: 'pointer', fontSize: 11 }}>
                {avatarBusy ? '处理中…' : user && user.avatar_url ? '更换头像' : '上传头像'}
              </button>
              {user && user.avatar_url && !avatarBusy && (
                <button type="button" onClick={removeAvatar}
                  style={{ border: 0, background: 'none', padding: 0, color: 'var(--ink-3)', cursor: 'pointer', fontSize: 11 }}>移除</button>
              )}
            </div>
          </div>
        </div>

        <SettingsSection title="个人资料">
          <SettingsRow label="昵称" hint="显示在右上角和 Agent 欢迎语中">
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={nickname} maxLength={40} placeholder={user && user.username} aria-label="昵称"
                onChange={function(e) { setNickname(e.target.value); }}
                onKeyDown={function(e) { if (e.key === 'Enter' && !e.nativeEvent.isComposing && nameChanged) saveName(); }}
                style={Object.assign({}, settingsInputStyle, { width: 130 })}/>
              {nameChanged && (
                <button type="button" disabled={savingName} onClick={saveName} style={settingsButtonStyle(true)}>
                  {savingName ? '保存中' : '保存'}
                </button>
              )}
            </div>
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title="使用偏好">
          <SettingsRow label="发送方式" hint={sendHint}>
            <SettingsSegmented value={prefs.send_shortcut || 'enter'} disabled={!!savingPrefs.send_shortcut}
              options={[['enter', 'Enter'], ['mod_enter', MOD_KEY_LABEL + '+Enter']]}
              onChange={function(v) { savePref('send_shortcut', v); }}/>
          </SettingsRow>
          <SettingsRow label="默认生图模型" hint="新打开页面时 AI 助手默认选中的模型">
            <SettingsSelect label="默认生图模型" value={prefs.default_model || 'gpt-image-2.6'} options={DEFAULT_MODEL_OPTIONS}
              disabled={!!savingPrefs.default_model} onChange={function(v) { savePref('default_model', v); }}/>
          </SettingsRow>
          <SettingsRow label="默认画面比例">
            <SettingsSelect label="默认画面比例" value={prefs.default_ratio || 'auto'} options={DEFAULT_RATIO_OPTIONS}
              disabled={!!savingPrefs.default_ratio} onChange={function(v) { savePref('default_ratio', v); }}/>
          </SettingsRow>
          <SettingsRow label="默认清晰度" hint="模型不支持时自动换成它支持的最接近选项">
            <SettingsSegmented value={prefs.default_resolution || '1K'} options={DEFAULT_RESOLUTION_OPTIONS}
              disabled={!!savingPrefs.default_resolution} onChange={function(v) { savePref('default_resolution', v); }}/>
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title="账号安全">
          {!passwordOpen ? (
            <SettingsRow label="登录密码" hint="修改后，其他设备上的登录会失效">
              <button type="button" onClick={function() { setPasswordOpen(true); }} style={settingsButtonStyle(false)}>修改密码</button>
            </SettingsRow>
          ) : (
            <form onSubmit={savePassword} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input type="password" autoComplete="current-password" placeholder="当前密码" aria-label="当前密码" value={oldPassword}
                onChange={function(e) { setOldPassword(e.target.value); }} style={settingsInputStyle} autoFocus/>
              <input type="password" autoComplete="new-password" placeholder="新密码（至少 6 位）" aria-label="新密码" value={newPassword}
                onChange={function(e) { setNewPassword(e.target.value); }} style={settingsInputStyle}/>
              <input type="password" autoComplete="new-password" placeholder="再次输入新密码" aria-label="再次输入新密码" value={confirmPassword}
                onChange={function(e) { setConfirmPassword(e.target.value); }} style={settingsInputStyle}/>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, fontSize: 11, color: 'var(--danger)' }}>{passwordError}</div>
                <button type="button" onClick={function() { setPasswordOpen(false); setOldPassword(''); setNewPassword(''); setConfirmPassword(''); }}
                  style={settingsButtonStyle(false)}>取消</button>
                <button type="submit" disabled={!canSavePassword} style={Object.assign(settingsButtonStyle(true), { opacity: canSavePassword ? 1 : 0.45 })}>
                  {savingPassword ? '修改中' : '确认修改'}
                </button>
              </div>
            </form>
          )}
        </SettingsSection>
      </div>
    </div>
  );
};

window.UserAvatar = UserAvatar;
window.PersonalSettingsModal = PersonalSettingsModal;
window.userDisplayName = userDisplayName;
window.DESIGNFLOW_MOD_KEY_LABEL = MOD_KEY_LABEL;
window.createPersonalSettingsActions = createPersonalSettingsActions;
