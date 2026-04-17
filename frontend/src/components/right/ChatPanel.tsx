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
  fetchProducts,
  getGridCellUrl,
  getImageUrl,
  parseTable,
  type ComposeRequest,
  type ParseResult,
} from "../../api/client";
import { useAppStore, type ChatAction } from "../../store/useAppStore";

// ── 从模板列表中挑选最匹配的模板 ──────────────────────────────────────────────
function findBestTemplate(
  templates: ReturnType<typeof useAppStore>["templates"],
  productCount: number
) {
  if (templates.length === 0) return null;
  const scored = templates.map((t) => {
    const keys = new Set(
      t.slots
        .filter((s) => s.name.startsWith("slot/product_"))
        .map((s) => s.name.split("/")[1])
    );
    return { t, diff: Math.abs(keys.size - productCount) };
  });
  scored.sort((a, b) => a.diff - b.diff);
  return scored[0]?.t ?? null;
}

export default function ChatPanel() {
  const {
    messages, addMessage,
    compose, setJob, setResultImageUrl, setGridUrls, setSlot,
    products, setProducts,
    templates, selectTemplate,
  } = useAppStore();
  const [input, setInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const SLASH_COMMANDS = [
    { cmd: "/开始生图", desc: "启动 AI 生图任务" },
    { cmd: "/导出PNG", desc: "下载生图结果图片" },
    { cmd: "/切九宫格", desc: "将结果裁切为九宫格" },
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

    // 斜杠指令直接映射，不走 AI
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

    // 简单意图识别（关键词匹配 + 转发给 AI）
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
      // 普通对话 → 转发给 AI
      const history = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content }));

      // 构造当前工作台状态，注入给 AI 作为上下文
      const ctx = {
        templateName: compose.selectedTemplate?.name,
        templateSlotCount: compose.selectedTemplate?.slots.length,
        productCount: Object.keys(compose.slots).length,
        jobStatus: compose.currentJob?.status,
        hasResult: !!compose.resultImageUrl,
      };

      // 显示"输入中"占位
      const thinkingId = "thinking-" + Date.now();
      addMessage({ role: "assistant", content: "…", id: thinkingId } as any);
      scrollBottom();

      try {
        const reply = await chatWithAI(history, ctx);
        // 替换占位消息
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
      const field = slot.name.split("/")[2]; // slot/product_N/<field>
      if (field) fields.add(field === "image" || slot.type === "rect" ? "image" : field);
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
    setUploading(true);

    const requiredFields = deriveRequiredFields();
    const fieldHint = requiredFields.length > 0
      ? `（模板需要字段：${requiredFields.join("、")}）`
      : "";
    addMessage({ role: "assistant", content: `正在解析表格${fieldHint}，请稍候…` });
    scrollBottom();

    try {
      const result = await parseTable(file, requiredFields.length > 0 ? requiredFields : undefined);
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
    // 加载产品图库（用于显示匹配结果）
    try {
      const { products: prods } = await fetchProducts();
      setProducts(prods);
    } catch {}

    // 把解析结果填入 store slots
    console.debug("[handleParseResult] setting slots:", result.products.length, "products");
    result.products.forEach((p, i) => {
      const key = `product_${i + 1}`;
      setSlot(key, p, undefined);
    });

    const typeLabel: Record<string, string> = {
      single: "单品",
      grid_4: "4宫格",
      grid_6: "6宫格",
      grid_9: "9宫格",
    };

    // ── 模板匹配分析 ──────────────────────────────────────────────────────────
    // 每次从 store 读取最新状态，避免闭包捕获旧值
    const template = useAppStore.getState().compose.selectedTemplate;

    // 模板期望的产品数和字段
    const templateProductKeys = template
      ? Array.from(new Set(
          template.slots
            .map(s => s.name.split("/")[1])
            .filter(Boolean)
        ))
      : [];
    const templateFields = template
      ? Array.from(new Set(
          template.slots
            .map(s => s.name.split("/")[2])
            .filter(Boolean)
        ))
      : [];
    const fieldLabel: Record<string, string> = {
      image: "产品图", name: "名称", price: "价格", tag: "标签", spec: "规格",
    };

    // 统计匹配情况
    const imgMatched = result.products.filter(p => p.image_path).length;
    const imgMissed = result.products.length - imgMatched;

    // 模板 vs 表格的产品数对比
    let templateHint = "";
    if (template) {
      const need = templateProductKeys.length;
      const got = result.products.length;
      const fieldsDesc = templateFields.map(f => fieldLabel[f] ?? f).join("、");
      if (got === need) {
        templateHint = `\n\n**模板检测**：「${template.name}」需要 **${need}** 个产品位，需填充字段：${fieldsDesc}。表格恰好提供 ${got} 个产品，✓ 数量匹配。`;
      } else if (got < need) {
        templateHint = `\n\n**模板检测**：「${template.name}」需要 **${need}** 个产品位，表格只有 ${got} 个产品，⚠ 少了 ${need - got} 个，剩余位置将留空。`;
      } else {
        templateHint = `\n\n**模板检测**：「${template.name}」需要 **${need}** 个产品位，表格有 ${got} 个产品，⚠ 多了 ${got - need} 个，将只使用前 ${need} 个。`;
      }
    } else {
      templateHint = "\n\n**模板**：尚未选择，请在左侧选择后再生图。";
    }

    // 图片匹配汇总
    const imgSummary = imgMissed === 0
      ? `✓ 全部 ${imgMatched} 张产品图已从图库匹配`
      : `⚠ ${imgMatched} 张已匹配，${imgMissed} 张未找到对应图片`;

    // 逐产品明细
    const lines = result.products.map((p, i) => {
      const sku = p.image_path
        ? p.image_path.replace(/\\/g, "/").split("/").pop()?.replace(/\.[^.]+$/, "") ?? ""
        : "";
      const imgStatus = p.image_path ? `✓ ${sku}` : "✗ 无图";
      const fields = [p.name ?? "—"];
      if (p.price) fields.push(p.price);
      if (p.tag) fields.push(p.tag);
      return `**${i + 1}.** ${fields.join(" | ")}　${imgStatus}`;
    });

    const content =
      `表格解析完成，共识别 **${result.products.length}** 个产品：\n\n` +
      lines.join("\n") +
      `\n\n${imgSummary}` +
      templateHint +
      `\n\n确认无误后点击「开始生图」。`;

    const actions: ChatAction[] = [
      {
        label: "开始生图",
        handler: () => {
          addMessage({ role: "user", content: "开始生图" });
          doCompose();
          scrollBottom();
        },
      },
    ];

    addMessage({ role: "assistant", content, actions });
  }

  // ── 合成 ──────────────────────────────────────────────────────────────────
  async function doCompose() {
    // 每次都从 store 读取最新状态，避免闭包捕获旧值
    const { selectedTemplate, slots } = useAppStore.getState().compose;

    if (!selectedTemplate) {
      addMessage({
        role: "assistant",
        content: "请先在左侧选择一个模板。",
      });
      return;
    }

    if (Object.keys(slots).length === 0) {
      addMessage({
        role: "assistant",
        content: "还没有填入产品信息，请先上传需求表格。",
      });
      return;
    }

    // 构造请求
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
      addMessage({
        role: "assistant",
        content: `生图启动失败：${String(err)}`,
      });
    }
    scrollBottom();
  }

  // ── 导出 PNG ──────────────────────────────────────────────────────────────
  function doExportPng() {
    const { currentJob, resultImageUrl } = compose;
    if (!currentJob || currentJob.status !== "done" || !resultImageUrl) {
      addMessage({
        role: "assistant",
        content: "还没有完成的生图结果，请先生图。",
      });
      return;
    }
    // 直接触发下载
    const a = document.createElement("a");
    a.href = resultImageUrl;
    a.download = `result_${currentJob.id.slice(0, 8)}.png`;
    a.click();
    addMessage({
      role: "assistant",
      content: "PNG 下载已开始。",
    });
  }

  // ── 九宫格 ────────────────────────────────────────────────────────────────
  async function doExportGrid() {
    const { currentJob } = compose;
    if (!currentJob || currentJob.status !== "done") {
      addMessage({
        role: "assistant",
        content: "请先完成生图，再切九宫格。",
      });
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

  return (
    <div className="chat-panel">
      <div className="panel-header">
        <span className="panel-title">AI 助手</span>
      </div>

      {/* 消息列表 */}
      <div className="chat-messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-msg ${msg.role}`}>
            {msg.role === "assistant"
              ? <div className="msg-avatar">AI</div>
              : <div className="msg-avatar-placeholder" />
            }
            <div className="msg-content">
              <div className="msg-bubble">
                {msg.content === "…"
                  ? <span className="typing-dots"><span/><span/><span/></span>
                  : <ReactMarkdown>{msg.content}</ReactMarkdown>
                }
              </div>
              {msg.actions && msg.actions.length > 0 && (
                <div className="msg-actions">
                  {msg.actions.map((a, i) => (
                    <button key={i} className="action-btn" onClick={a.handler}>
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

      {/* 输入区 */}
      <div className="chat-input-area">
        {/* 斜杠指令弹出菜单 */}
        {showSlashMenu && (
          <div className="slash-menu">
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
                <span className="slash-cmd">{c.cmd}</span>
                <span className="slash-desc">{c.desc}</span>
              </button>
            ))}
          </div>
        )}

        {/* 上传按钮 */}
        <button
          className="upload-btn"
          title="上传需求表格 (.xlsx/.csv)"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 1s linear infinite" }}>
              <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          style={{ display: "none" }}
          onChange={handleFileUpload}
        />

        <input
          className="chat-input"
          placeholder="输入指令或 / 触发快捷命令…"
          value={input}
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
        <button
          className="send-btn"
          onClick={handleSend}
          disabled={!input.trim()}
        >
          发送
        </button>
      </div>

    </div>
  );
}
