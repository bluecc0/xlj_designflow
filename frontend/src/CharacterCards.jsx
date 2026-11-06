// 角色卡：输入框里的选择面板和新建/编辑弹窗。选中后生图时只传卡片 ID，图片和描述由后端读取。

const characterInputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8,
  border: '1px solid var(--line-2)', background: 'var(--panel)', color: 'var(--ink)', fontSize: 13, outline: 'none',
};

const CHARACTER_GENDERS = [['adult_male', '成人男'], ['adult_female', '成人女'], ['boy', '男童'], ['girl', '女童']];

const characterGenderLabel = function(gender) {
  const match = CHARACTER_GENDERS.find(function(item) { return item[0] === gender; });
  return match ? match[1] : '';
};

// 所有头像都走这里，保证卡片、弹窗和标签裁出来的是同一块。竖图从顶部裁，半身照才不会切掉头顶。
const CharacterAvatar = ({ src, size, alt = '' }) => (
  <img src={src} alt={alt} loading="lazy" style={{ display: 'block', width: size, height: size, flexShrink: 0, borderRadius: 99, objectFit: 'cover', objectPosition: 'center top', background: 'var(--panel-2)' }}/>
);

const CharacterTile = ({ card, selected, onToggle, onEdit }) => {
  const genderLabel = characterGenderLabel(card.gender);
  return (
    <div style={{ position: 'relative', minWidth: 0 }}>
      <button
        type="button"
        onClick={function() { onToggle(card); }}
        aria-pressed={selected}
        title={card.description || card.name}
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', boxSizing: 'border-box', padding: '10px 34px 10px 10px', cursor: 'pointer', textAlign: 'left',
          background: selected ? 'var(--panel-2)' : 'var(--panel)',
          borderRadius: 12, border: '1px solid ' + (selected ? 'var(--ink)' : 'var(--line-2)'),
        }}
      >
        <span style={{ position: 'relative', width: 48, height: 48, flexShrink: 0 }}>
          <CharacterAvatar src={card.avatar_url} size={48}/>
          {selected && (
            <span style={{ position: 'absolute', right: -2, bottom: -2, width: 18, height: 18, borderRadius: 99, background: 'var(--ink)', color: 'white', border: '2px solid var(--panel)', boxSizing: 'border-box', display: 'grid', placeItems: 'center' }}>
              <I.check size={9} stroke={3}/>
            </span>
          )}
        </span>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.name}</span>
            {genderLabel && <span style={{ flexShrink: 0, padding: '0 6px', borderRadius: 99, background: 'var(--panel-2)', color: 'var(--ink-2)', fontSize: 11, lineHeight: '17px' }}>{genderLabel}</span>}
          </span>
          <span style={{ fontSize: 12, lineHeight: 1.45, color: card.description ? 'var(--ink-2)' : 'var(--ink-3)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', wordBreak: 'break-word' }}>{card.description || '暂无简介'}</span>
          <span style={{ fontSize: 11, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {card.can_edit ? (card.is_shared ? '已共享' : '仅自己') : card.owner_name} · {card.images.length} 张参考图
          </span>
        </span>
      </button>
      {card.can_edit && (
        <button
          type="button"
          onClick={function() { onEdit(card); }}
          title="编辑角色"
          aria-label={'编辑角色 ' + card.name}
          style={{ position: 'absolute', top: 8, right: 8, width: 24, height: 24, padding: 0, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--ink-3)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}
        ><I.edit size={12}/></button>
      )}
    </div>
  );
};

const CharacterPickerPanel = ({ cards, loading, selectedIds, onToggle, onEdit, onCreate }) => {
  const [search, setSearch] = React.useState('');
  const keyword = search.trim().toLowerCase();
  const matched = cards.filter(function(card) {
    return !keyword || (card.name + ' ' + card.description + ' ' + card.owner_name).toLowerCase().indexOf(keyword) !== -1;
  });
  const mine = matched.filter(function(card) { return card.can_edit; });
  const team = matched.filter(function(card) { return !card.can_edit; });
  const section = function(title, items) {
    if (!items.length) return null;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{title}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 8 }}>
          {items.map(function(card) {
            return <CharacterTile key={card.id} card={card} selected={selectedIds.indexOf(card.id) !== -1} onToggle={onToggle} onEdit={onEdit}/>;
          })}
        </div>
      </div>
    );
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', flexShrink: 0 }}>选择角色</div>
        <input value={search} onChange={function(e) { setSearch(e.target.value); }} placeholder="搜索姓名、简介或创建人" style={Object.assign({}, characterInputStyle, { flex: 1, minWidth: 0, padding: '5px 9px', fontSize: 12 })}/>
        <button type="button" onClick={onCreate} style={{ flexShrink: 0, height: 28, padding: '0 10px', borderRadius: 8, border: 'none', background: 'var(--ink)', color: 'white', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <I.plus size={12}/>新建
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 340, overflowY: 'auto', paddingRight: 2 }}>
        {section('我的角色', mine)}
        {section('团队共享', team)}
        {!matched.length && (
          <div style={{ padding: '24px 8px', textAlign: 'center', fontSize: 12, color: 'var(--ink-3)' }}>
            {loading ? '加载中…' : cards.length ? '没有找到相关角色' : '还没有角色。新建一个，生图时就能指定这个人物。'}
          </div>
        )}
      </div>
    </div>
  );
};

const CharacterEditorModal = ({ card, limits, onClose, onSaved, onDeleted }) => {
  const editing = Boolean(card && card.id);
  const maxImages = (limits && limits.max_images_per_card) || 4;
  const [name, setName] = React.useState(editing ? card.name : '');
  const [description, setDescription] = React.useState(editing ? card.description : '');
  const [gender, setGender] = React.useState(editing ? card.gender : '');
  const [avatarFile, setAvatarFile] = React.useState(null);
  const [avatarPreview, setAvatarPreview] = React.useState(editing && card.has_avatar ? card.avatar_url : '');
  const [isShared, setIsShared] = React.useState(editing ? card.is_shared : false);
  const [kept, setKept] = React.useState(editing ? card.images : []);
  const [added, setAdded] = React.useState([]);
  const [saving, setSaving] = React.useState(false);
  const fileRef = React.useRef(null);
  const avatarRef = React.useRef(null);
  const addedRef = React.useRef(added);
  addedRef.current = added;
  const avatarPreviewRef = React.useRef(avatarPreview);
  avatarPreviewRef.current = avatarPreview;

  const revokeAvatarPreview = function() {
    if (avatarPreviewRef.current.indexOf('blob:') === 0) URL.revokeObjectURL(avatarPreviewRef.current);
  };
  React.useEffect(function() {
    return function() {
      addedRef.current.forEach(function(item) { URL.revokeObjectURL(item.previewUrl); });
      revokeAvatarPreview();
    };
  }, []);

  const imageCount = kept.length + added.length;
  const pickFiles = function(e) {
    const picked = Array.from(e.target.files || []).filter(function(file) { return /^image\//.test(file.type); });
    e.target.value = '';
    const room = maxImages - imageCount;
    if (picked.length > room) window.dfToast('每个角色最多 ' + maxImages + ' 张参考图', { tone: 'warn' });
    setAdded(function(prev) {
      return prev.concat(picked.slice(0, Math.max(0, room)).map(function(file) {
        return { file: file, previewUrl: URL.createObjectURL(file) };
      }));
    });
  };
  const pickAvatar = function(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || !/^image\//.test(file.type)) return;
    revokeAvatarPreview();
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };
  const clearAvatar = function() {
    revokeAvatarPreview();
    setAvatarFile(null);
    setAvatarPreview('');
  };
  const removeAdded = function(item) {
    URL.revokeObjectURL(item.previewUrl);
    setAdded(function(prev) { return prev.filter(function(entry) { return entry !== item; }); });
  };
  const save = async function() {
    if (saving) return;
    setSaving(true);
    try {
      const payload = { name: name.trim(), description: description.trim(), gender: gender, is_shared: isShared, avatar: avatarFile, remove_avatar: editing && card.has_avatar && !avatarPreview, files: added.map(function(item) { return item.file; }) };
      const saved = editing
        ? await window.API.updateCharacterCard(card.id, Object.assign(payload, { keep_image_ids: kept.map(function(image) { return image.id; }) }))
        : await window.API.createCharacterCard(payload);
      onSaved(saved);
    } catch (err) {
      window.dfError(err, '角色保存失败，请稍后重试。');
    } finally {
      setSaving(false);
    }
  };
  const remove = async function() {
    const ok = await window.dfConfirm({
      title: '删除角色？',
      message: card.is_shared ? '这个角色已共享，删除后同事也无法再选用。已经生成的图不受影响。' : '已经生成的图不受影响。',
      confirmText: '删除', danger: true,
    });
    if (!ok) return;
    try {
      await window.API.deleteCharacterCard(card.id);
      onDeleted(card);
    } catch (err) {
      window.dfError(err, '角色删除失败，请稍后重试。');
    }
  };
  const thumb = function(key, src, onRemove, label) {
    return (
      <div key={key} style={{ position: 'relative', width: 72, height: 72 }}>
        <img src={src} alt={label} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)', display: 'block' }}/>
        <button type="button" onClick={onRemove} aria-label={'移除' + label} style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, padding: 0, borderRadius: 99, border: 'none', background: 'var(--ink)', color: 'white', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
          <I.close size={9} stroke={2.4}/>
        </button>
      </div>
    );
  };
  const canSave = name.trim() && imageCount > 0 && !saving;
  return ReactDOM.createPortal(
    <div onMouseDown={function(e) { if (e.target === e.currentTarget) onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(15, 18, 30, 0.42)', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label={editing ? '编辑角色' : '新建角色'} style={{ width: 'min(480px, 100%)', maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box', background: 'var(--panel)', borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column', gap: 14, boxShadow: '0 24px 60px rgba(15, 23, 42, 0.22)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{editing ? '编辑角色' : '新建角色'}</div>
          <button type="button" onClick={onClose} aria-label="关闭" style={{ width: 26, height: 26, padding: 0, border: 'none', background: 'transparent', color: 'var(--ink-2)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><I.close size={13}/></button>
        </div>
        <div style={{ display: 'flex', gap: 14 }}>
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <button type="button" onClick={function() { avatarRef.current && avatarRef.current.click(); }} aria-label={avatarPreview ? '更换头像' : '上传头像'} title={avatarPreview ? '更换头像' : '上传头像'} style={{ width: 76, height: 76, padding: 0, borderRadius: 99, overflow: 'hidden', border: avatarPreview ? '1px solid var(--line)' : '1px dashed var(--line-2)', background: 'var(--panel-2)', color: 'var(--ink-3)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
              {avatarPreview ? <CharacterAvatar src={avatarPreview} size={74} alt="头像预览"/> : <I.user size={24}/>}
            </button>
            {avatarPreview
              ? <button type="button" onClick={clearAvatar} style={{ padding: 0, border: 'none', background: 'transparent', color: 'var(--ink-3)', fontSize: 11, cursor: 'pointer' }}>移除头像</button>
              : <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>头像（选填）</span>}
            <input ref={avatarRef} type="file" accept="image/*" onChange={pickAvatar} style={{ display: 'none' }}/>
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: 'var(--ink-2)' }}>
              姓名
              <input value={name} maxLength={30} autoFocus onChange={function(e) { setName(e.target.value); }} placeholder="比如：小鹿" style={characterInputStyle}/>
            </label>
            <div role="radiogroup" aria-label="性别" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-2)', flexWrap: 'wrap' }}>
              <span style={{ marginRight: 4 }}>性别</span>
              {CHARACTER_GENDERS.map(function(item) {
                const active = gender === item[0];
                return (
                  <button key={item[0]} type="button" role="radio" aria-checked={active} onClick={function() { setGender(active ? '' : item[0]); }} style={{ height: 26, padding: '0 10px', borderRadius: 99, border: '1px solid ' + (active ? 'var(--ink)' : 'var(--line-2)'), background: active ? 'var(--ink)' : 'transparent', color: active ? 'white' : 'var(--ink-2)', fontSize: 12, cursor: 'pointer' }}>{item[1]}</button>
                );
              })}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>人物参考图（{imageCount}/{maxImages}）</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {kept.map(function(image) {
              return thumb(image.id, image.url, function() { setKept(function(prev) { return prev.filter(function(entry) { return entry !== image; }); }); }, '参考图');
            })}
            {added.map(function(item) {
              return thumb(item.previewUrl, item.previewUrl, function() { removeAdded(item); }, '新参考图');
            })}
            {imageCount < maxImages && (
              <button type="button" onClick={function() { fileRef.current && fileRef.current.click(); }} aria-label="添加参考图" style={{ width: 72, height: 72, borderRadius: 8, border: '1px dashed var(--line-2)', background: 'var(--panel-2)', color: 'var(--ink-2)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
                <I.plus size={16}/>
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple onChange={pickFiles} style={{ display: 'none' }}/>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.5 }}>可以拼合成一张，也可以用脸部清晰的图，正面、侧面各一张</div>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: 'var(--ink-2)' }}>
          简介（选填）
          <textarea value={description} maxLength={500} rows={3} onChange={function(e) { setDescription(e.target.value); }} placeholder="补充人物细节，例如 25 岁，180cm" style={Object.assign({}, characterInputStyle, { resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 })}/>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink)', cursor: 'pointer' }}>
          <input type="checkbox" checked={isShared} onChange={function(e) { setIsShared(e.target.checked); }}/>
          共享给团队
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {editing && <button type="button" onClick={remove} style={{ height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'transparent', color: 'var(--danger)', fontSize: 12, cursor: 'pointer' }}>删除</button>}
          <div style={{ flex: 1 }}/>
          <button type="button" onClick={onClose} style={{ height: 32, padding: '0 14px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--ink-2)', fontSize: 12, cursor: 'pointer' }}>取消</button>
          <button type="button" onClick={save} disabled={!canSave} style={{ height: 32, padding: '0 16px', borderRadius: 8, border: 'none', background: canSave ? 'var(--ink)' : 'var(--line)', color: canSave ? 'white' : 'var(--ink-3)', fontSize: 12, fontWeight: 600, cursor: canSave ? 'pointer' : 'default' }}>{saving ? '保存中…' : '保存'}</button>
        </div>
      </div>
    </div>,
    document.body
  );
};

window.CharacterAvatar = CharacterAvatar;
window.CharacterPickerPanel = CharacterPickerPanel;
window.CharacterEditorModal = CharacterEditorModal;
