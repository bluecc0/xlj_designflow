/**
 * 右栏 — AI 对话面板
 * 支持：上传表格 → AI 解析 → 确认合成 → 导出操作
 */
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  chatWithAI,
  createCompose,
  exportGrid,
  fetchImageTypes,
  getGridCellUrl,
  parseTable,
  type ParsedProduct,
  type ComposeRequest,
  type ImageTypeInfo,
  type ParseResult,
} from "../../api/client";
import { useAppStore, type ChatAction } from "../../store/useAppStore";

export default function ChatPanel() {
  const {
    messages, addMessage,
    compose, setJob, setGridUrls, setSlot,
  } = useAppStore();
  const [input, setInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [imageTypes, setImageTypes] = useState<ImageTypeInfo[]>([]);
  const [selectedImageType, setSelectedImageType] = useState<string>("");
  // ref 保持最新值，让 stale-closure 里的 handler 也能读到正确的 imageType
  const selectedImageTypeRef = useRef<string>("");
  const selectImageType = (key: string) => {
    setSelectedImageType(key);
    selectedImageTypeRef.current = key;
  };
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pendingFileRef = useRef<File | null>(null);

  // 加载可用图片类型
  useEffect(() => {
    fetchImageTypes()
      .then((types) => {
        setImageTypes(types);
        const first = types.find((t) => t.exists);
        if (first) selectImageType(first.key);
      })
      .catch(() => {});
  }, []);

  const SLASH_COMMANDS = [
    { cmd: "/开始生图", desc: "启动 AI 生图任务", icon: "✨", group: "Generation" },
    { cmd: "/导出PNG", desc: "下载生图结果图片", icon: "📥", group: "Export" },
    { cmd: "/切九宫格", desc: "将结果裁切为九宫格", icon: "⊞", group: "Tools" },
  ];

  // 滚动到底部
  const scrollBottom = () =>
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

  // ── 监听合成任务完成，自动发消息 ─────────────────────────────────────────────
  const prevJobStatusRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const status = compose.currentJob?.status;
    const prev = prevJobStatusRef.current;
    prevJobStatusRef.current = status;

    if (status === "done" && prev !== "done") {
      const editUrl = compose.currentJob?.penpot_edit_url;
      addMessage({
        role: "assistant",
        content: "✅ 生图完成！结果已显示在预览区。",
        actions: [
          {
            label: "导出 PNG",
            handler: () => {
              addMessage({ role: "user", content: "导出 PNG" });
              doExportPng();
            },
          },
          {
            label: "切九宫格",
            handler: () => {
              addMessage({ role: "user", content: "切九宫格" });
              doExportGrid();
            },
          },
          ...(editUrl ? [{
            label: "在 Penpot 中修改",
            handler: () => {
              addMessage({ role: "user", content: "在 Penpot 中精修" });
              window.open(editUrl, "_blank");
            },
          }] : []),
        ],
      });
      scrollBottom();
    } else if (status === "failed" && prev !== "failed") {
      addMessage({
        role: "assistant",
        content: `❌ 生图失败：${compose.currentJob?.error ?? "未知错误"}`,
      });
      scrollBottom();
    }
  }, [compose.currentJob?.status]);

  // ── 发送文字消息 ──────────────────────────────────────────────────────────
  async function handleSend() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    setShowSlashMenu(false);
    addMessage({ role: "user", content: text });
    scrollBottom();

    if (text.startsWith("/")) {
      const cmd = text.split(" ")[0].toLowerCase();
      if (cmd === "/开始生图") { await doCompose(); }
      else if (cmd === "/导出png") { doExportPng(); }
      else if (cmd === "/切九宫格") { await doExportGrid(); }
      else {
        addMessage({ role: "assistant", content: `未知指令：\`${text}\`\n\n可用指令：/开始生图、/导出PNG、/切九宫格` });
      }
      scrollBottom();
      return;
    }

    await handleTextCommand(text);
    scrollBottom();
  }

  async function handleTextCommand(text: string) {
    const lower = text.toLowerCase();

    if (lower.includes("导出") && lower.includes("九宫格")) {
      await doExportGrid();
    } else if (lower.includes("导出") || lower.includes("png")) {
      doExportPng();
    } else if (lower.includes("生图") || lower.includes("合成") || lower.includes("生成") || lower.includes("开始")) {
      await doCompose();
    } else {
      const history = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content }));

      const ctx = {
        templateName: compose.selectedTemplate?.name,
        templateSlotCount: compose.selectedTemplate?.slots.length,
        productCount: Object.keys(compose.slots).length,
        jobStatus: compose.currentJob?.status,
        hasResult: !!compose.resultImageUrl,
      };

      const thinkingId = "thinking-" + Date.now();
      addMessage({ role: "assistant", content: "…", id: thinkingId } as any);
      scrollBottom();

      try {
        const reply = await chatWithAI(history, ctx);
        useAppStore.getState().replaceMessage(thinkingId, reply);
      } catch {
        useAppStore.getState().replaceMessage(
          thinkingId,
          "AI 暂时不可用，请检查后端是否启动或 SILICONFLOW_API_KEY 是否配置。"
        );
      }
    }
  }

  // ── 从模板 slot 推导需要哪些字段 ─────────────────────────────────────────
  function deriveRequiredFields(): string[] {
    const template = compose.selectedTemplate;
    if (!template) return [];
    const fields = new Set<string>();
    for (const slot of template.slots) {
      const field = slot.name.split("/")[2];
      if (!field) continue;
      if (field === "image" || slot.type === "rect") continue;
      fields.add(field);
    }
    return Array.from(fields);
  }

  // ── 上传表格 ───────────────────────────────────────────────────────────────
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    addMessage({ role: "user", content: `上传了表格：${file.name}` });
    scrollBottom();

    if (imageTypes.length > 0) {
      pendingFileRef.current = file;
      const actions: ChatAction[] = [
        {
          label: "确认解析",
          primary: true,
          handler: () => doParseWithType(pendingFileRef.current!),
        },
      ];
      addMessage({
        role: "assistant",
        content: "请选择本次生图使用的**图片类型**，系统将从对应素材文件夹匹配产品图：",
        actions,
        extra: { type: "image-type-selector" },
      } as any);
      scrollBottom();
    } else {
      await doParseWithType(file);
    }
  }

  async function doParseWithType(file: File) {
    setUploading(true);
    const requiredFields = deriveRequiredFields();
    const fieldLabel: Record<string, string> = {
      name: "名称", price: "价格", tag: "标签", spec: "规格",
    };
    const template = compose.selectedTemplate;
    const hasImage = template?.slots.some(s => {
      const f = s.name.split("/")[2];
      return f === "image" || s.type === "rect";
    });
    const displayFields = [
      ...(hasImage ? ["图片"] : []),
      ...requiredFields.map(f => fieldLabel[f] ?? f),
    ];
    const fieldHint = displayFields.length > 0
      ? `（模板需要字段：${displayFields.join("、")}）`
      : "";
    const currentType = selectedImageTypeRef.current;
    const typeLabel = imageTypes.find((t) => t.key === currentType)?.folder ?? currentType;
    const typeHint = currentType ? `，图片类型：${typeLabel}` : "";
    const thinkingId = `thinking-${Date.now()}`;
    const hintSuffix = `${fieldHint}${typeHint}`;
    addMessage({ role: "assistant", content: `正在读取表格…${hintSuffix ? " " + hintSuffix : ""}`, id: thinkingId });
    scrollBottom();

    try {
      const result = await parseTable(
        file,
        requiredFields.length > 0 ? requiredFields : undefined,
        currentType || undefined,
      );
      useAppStore.getState().replaceMessage(thinkingId, "正在匹配产品图库…");
      scrollBottom();
      await new Promise(r => setTimeout(r, 600));
      await handleParseResult(result);
    } catch (err) {
      addMessage({
        role: "assistant",
        content: `解析失败：${String(err)}\n\n请检查 .env 中是否配置了 SILICONFLOW_API_KEY，或后端日志中查看详细错误。`,
      });
    } finally {
      setUploading(false);
      scrollBottom();
    }
  }

  async function handleParseResult(result: ParseResult) {
    result.products.forEach((p, i) => {
      setSlot(`product_${i + 1}`, p, undefined);
    });

    const template = useAppStore.getState().compose.selectedTemplate;
    const imgMatched = result.products.filter(p => p.image_path).length;
    const imgMissed = result.products.length - imgMatched;
    const total = result.products.length;

    const templateProductCount = template
      ? new Set(template.slots.map(s => s.name.split("/")[1]).filter(Boolean)).size
      : 0;

    let lead = "";
    if (!template) {
      lead = `分析完成，识别到 ${total} 款产品，图片匹配了 ${imgMatched} 张。记得在左侧选一个模板，然后就可以生图了。`;
    } else {
      const countMatch = templateProductCount === total;
      const allImg = imgMissed === 0;
      if (countMatch && allImg) {
        lead = `好的，${total} 款产品和「${template.name}」完全匹配，图片也全部找到了，可以直接生图。`;
      } else if (countMatch && !allImg) {
        lead = `${total} 款产品和模板数量吻合，不过有 ${imgMissed} 张图没找到，生图时那几个位置会留空。`;
      } else if (!countMatch) {
        const diff = total - templateProductCount;
        lead = diff > 0
          ? `表格有 ${total} 款，模板只有 ${templateProductCount} 个位置，我会用前 ${templateProductCount} 款来生图。`
          : `模板需要 ${templateProductCount} 款产品，表格只提供了 ${total} 款，剩余位置留空处理。`;
      }
    }

    const actions: ChatAction[] = [
      {
        label: "开始生图",
        primary: true,
        handler: () => {
          addMessage({ role: "user", content: "开始生图" });
          doCompose();
          scrollBottom();
        },
      },
    ];

    addMessage({
      role: "assistant",
      content: lead,
      actions,
      extra: {
        type: "parse-result",
        products: result.products,
        imgMatched,
        imgMissed,
      },
    } as any);
  }

  // ── 合成 ──────────────────────────────────────────────────────────────────
  async function doCompose() {
    const { selectedTemplate, slots } = useAppStore.getState().compose;

    if (!selectedTemplate) {
      addMessage({ role: "assistant", content: "请先在左侧选择一个模板。" });
      return;
    }

    if (Object.keys(slots).length === 0) {
      addMessage({ role: "assistant", content: "还没有填入产品信息，请先上传需求表格。" });
      return;
    }

    const slotsReq: ComposeRequest["slots"] = {};
    for (const [key, val] of Object.entries(slots)) {
      slotsReq[key] = {
        image_path: val.product.image_path ?? null,
        name: val.product.name ?? null,
        price: val.product.price ?? null,
        tag: val.product.tag ?? null,
        spec: val.product.spec ?? null,
      };
    }

    const req: ComposeRequest = {
      file_id: selectedTemplate.file_id,
      template_frame_id: selectedTemplate.id,
      page_id: selectedTemplate.page_id,
      slots: slotsReq,
      export_scale: 2,
    };

    addMessage({
      role: "assistant",
      content: "✨ AI 正在生图，请稍候…\n\n中间预览区实时显示进度。",
    });
    scrollBottom();

    try {
      const job = await createCompose(req);
      setJob(job);
      addMessage({
        role: "assistant",
        content: `⚡ 生图任务已启动\n\n任务 ID：\`${job.id.slice(0, 8)}\`，完成后自动显示结果。`,
      });
    } catch (err) {
      addMessage({ role: "assistant", content: `生图启动失败：${String(err)}` });
    }
    scrollBottom();
  }

  // ── 导出 PNG ──────────────────────────────────────────────────────────────
  function doExportPng() {
    const { currentJob, resultImageUrl } = compose;
    if (!currentJob || currentJob.status !== "done" || !resultImageUrl) {
      addMessage({ role: "assistant", content: "还没有完成的生图结果，请先生图。" });
      return;
    }
    const a = document.createElement("a");
    a.href = resultImageUrl;
    a.download = `result_${currentJob.id.slice(0, 8)}.png`;
    a.click();
    addMessage({ role: "assistant", content: "PNG 下载已开始。" });
  }

  // ── 九宫格 ────────────────────────────────────────────────────────────────
  async function doExportGrid() {
    const { currentJob } = compose;
    if (!currentJob || currentJob.status !== "done") {
      addMessage({ role: "assistant", content: "请先完成生图，再切九宫格。" });
      return;
    }

    addMessage({ role: "assistant", content: "正在切九宫格…" });
    scrollBottom();

    try {
      const result = await exportGrid(currentJob.id, 3, 3);
      const urls = result.files.map((_, i) => getGridCellUrl(currentJob.id, i));
      setGridUrls(urls);
      const actions: ChatAction[] = urls.map((url, i) => ({
        label: `下载第${i + 1}格`,
        handler: () => {
          const a = document.createElement("a");
          a.href = url;
          a.download = `grid_${i + 1}.png`;
          a.click();
        },
      }));
      addMessage({
        role: "assistant",
        content: `九宫格已生成，共 ${result.files.length} 张，可在中栏预览或点击下载。`,
        actions,
      });
    } catch (err) {
      addMessage({ role: "assistant", content: `切图失败：${String(err)}` });
    }
    scrollBottom();
  }

  const isGenerating = compose.currentJob?.status === "pending" || compose.currentJob?.status === "running";
  const hasContent = input.trim().length > 0;

  // Prompt suggestions for empty state
  const SUGGESTIONS = [
    {
      icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m3 17 5-5 5 5 3-3 5 5"/></svg>,
      text: "上传产品图片，描述整体风格",
    },
    {
      icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7V5h16v2M9 20h6M12 5v15"/></svg>,
      text: "粘贴品牌手册，提取配色和字体",
    },
    {
      icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
      text: "上传需求表格，批量生成产品图",
    },
    {
      icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18M7 17V9m-4 4h4m10 0h4m-4 4V9"/></svg>,
      text: "切换尺寸为 9:16，适配竖版投流",
    },
  ];

  return (
    <div className="chat-panel">
      {/* Header */}
      <div className="panel-header">
        <span className={`chat-status-dot ${isGenerating ? "generating" : "ready"}`} />
        <span className="chat-header-name">Loom</span>
        <span className="chat-header-status">
          {isGenerating ? "生成中…" : "就绪"}
        </span>
        <div className="chat-header-actions">
          <button className="chat-icon-btn" title="历史记录">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
          </button>
          <button className="chat-icon-btn" title="更多">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Messages or empty state */}
      {messages.length <= 1 ? (
        <div className="chat-empty">
          <div style={{ padding: "20px 4px 16px", display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
            <div className="chat-empty-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>
              </svg>
            </div>
            <div className="chat-empty-title">How can I help design today?</div>
            <div style={{ fontSize: 12, color: "var(--ink-3)", textAlign: "center", maxWidth: 240, lineHeight: 1.5 }}>
              上传需求表格、产品图片或参考图，或直接输入指令。
            </div>
          </div>
          <div className="mono" style={{ fontSize: "9.5px", color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "0 4px 6px" }}>Try</div>
          <div className="chat-empty-cards">
            {SUGGESTIONS.map((s, i) => (
              <button
                key={i}
                className="chat-empty-card"
                onClick={() => setInput(s.text)}
              >
                <span className="chat-empty-card-icon">{s.icon}</span>
                <span className="chat-empty-card-text">{s.text}</span>
                <svg className="chat-empty-card-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="chat-messages">
          {messages.map((msg) => (
            <div key={msg.id} className={`chat-msg ${msg.role}`}>
              {msg.role === "assistant"
                ? <div className="msg-avatar">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>
                    </svg>
                  </div>
                : <div className="msg-avatar-placeholder" />
              }
              <div className="msg-content">
                <div className="msg-bubble">
                  {msg.content === "…"
                    ? <span className="typing-dots"><span/><span/><span/></span>
                    : <ReactMarkdown>{msg.content}</ReactMarkdown>
                  }
                </div>
                {(msg as any).extra?.type === "parse-result" && (
                  <div className="parse-card">
                    {((msg as any).extra.products as ParsedProduct[]).map((p, i) => (
                      <div key={i} className="parse-row">
                        <span className="parse-idx">{i + 1}</span>
                        <span className="parse-name">{p.name ?? "—"}</span>
                        {p.price && <span className="parse-price">{p.price}</span>}
                        <span className={`parse-img ${p.image_path ? "ok" : "miss"}`}>
                          {p.image_path ? "图✓" : "无图"}
                        </span>
                      </div>
                    ))}
                    <div className="parse-summary">
                      {(msg as any).extra.imgMissed === 0
                        ? `全部 ${(msg as any).extra.imgMatched} 张图片已匹配`
                        : `${(msg as any).extra.imgMatched} 张已匹配 · ${(msg as any).extra.imgMissed} 张缺失`
                      }
                    </div>
                  </div>
                )}
                {(msg as any).extra?.type === "image-type-selector" && (
                  <div className="image-type-selector">
                    {imageTypes.map((t) => (
                      <button
                        key={t.key}
                        className={`type-btn${selectedImageType === t.key ? " active" : ""}${!t.exists ? " missing" : ""}`}
                        onClick={() => selectImageType(t.key)}
                        title={t.exists ? t.folder : `文件夹不存在：${t.folder}`}
                      >
                        {t.folder}
                        {!t.exists && <span className="type-missing">!</span>}
                      </button>
                    ))}
                  </div>
                )}
                {msg.actions && msg.actions.length > 0 && (
                  <div className="msg-actions">
                    {msg.actions.map((a, i) => (
                      <button
                        key={i}
                        className={`action-btn${a.primary ? " primary" : ""}`}
                        onClick={a.handler}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Input area */}
      <div className="chat-input-area">
        {/* Composer box — slash menu and quick pills live INSIDE */}
        <div className={`composer-box${showSlashMenu ? " slash-active" : ""}`}>
          {/* Slash command popup (inside box, above textarea) */}
          {showSlashMenu && (
            <div className="slash-menu">
              <div className="slash-menu-header mono">
                <span>Commands</span>
                <div style={{ flex: 1 }} />
                <span>↑↓ navigate · ⏎ pick · esc close</span>
              </div>
              {SLASH_COMMANDS.filter(
                (c) => input === "/" || c.cmd.toLowerCase().includes(input.toLowerCase().slice(1))
              ).map((c) => (
                <button
                  key={c.cmd}
                  className="slash-item"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setInput(c.cmd);
                    setShowSlashMenu(false);
                  }}
                >
                  <span className="slash-item-icon">{c.icon}</span>
                  <span className="slash-cmd">{c.cmd}</span>
                  <span className="slash-desc">{c.desc}</span>
                </button>
              ))}
            </div>
          )}
          <textarea
            className="chat-input"
            placeholder="输入指令或 / 触发快捷命令…"
            value={input}
            rows={2}
            onChange={(e) => {
              const v = e.target.value;
              setInput(v);
              setShowSlashMenu(v.startsWith("/"));
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setShowSlashMenu(false); return; }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            onBlur={() => setTimeout(() => setShowSlashMenu(false), 150)}
          />
          {/* Quick slash pills — inside box, only when slash menu is not showing */}
          {!showSlashMenu && (
            <div className="quick-slash-row">
              {["/开始生图", "/分析素材", "/导出PNG"].map((cmd) => (
                <button
                  key={cmd}
                  className="quick-slash-btn"
                  onClick={() => {
                    setInput(cmd);
                    setShowSlashMenu(false);
                  }}
                >
                  {cmd}
                </button>
              ))}
            </div>
          )}

          {/* Composer toolbar */}
          <div className="composer-toolbar">
            {/* Upload button */}
            <button
              className="composer-icon-btn"
              title="上传需求表格 (.xlsx/.csv)"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 1s linear infinite" }}>
                  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              )}
            </button>
            <button className="composer-icon-btn" title="插入图片">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
            </button>
            <button className="composer-icon-btn" title="调色板">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/>
                <circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/>
                <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>
              </svg>
            </button>

            <div className="composer-spacer" />

            <div className="model-selector">
              <span>Claude 4 Haiku</span>
              <span className="model-selector-chevron">⌄</span>
            </div>
            <button
              className={`send-btn${hasContent ? " has-content" : ""}`}
              onClick={handleSend}
              disabled={!hasContent}
            >
              发送
            </button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          style={{ display: "none" }}
          onChange={handleFileUpload}
        />
      </div>

      {/* Footer */}
      <div className="chat-footer">
        <span className="chat-footer-text">⏎ send · ⇧⏎ newline</span>
        <span className="chat-footer-credits">12 credits · 488 left</span>
      </div>
    </div>
  );
}
