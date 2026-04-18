/**
 * 全局状态 — Zustand store
 *
 * 不做任何持久化，每次刷新页面都是初始状态。
 * 上传表格后 slots 保存在内存中，刷新页面会丢失。
 */
import { create } from "zustand";
import type {
  ComposeJob,
  ParsedProduct,
  ProductItem,
  TemplateInfo,
} from "../api/client";

// ─── 常量 ────────────────────────────────────────────────────────────────────

const WELCOME_CONTENT = `你好！我是 DesignFlow AI 助手，可以自由对话，也可以帮你操作生图流程。

**快速开始：**
1. 在左侧选择模板
2. 上传产品需求表格（Excel/CSV）
3. 点击「开始生图」

快捷指令：\`/开始生图\` \`/导出PNG\` \`/切九宫格\``;

const makeWelcomeMsg = () => ({
  id: "0",
  role: "assistant" as const,
  content: WELCOME_CONTENT,
  timestamp: Date.now(),
});

// ─── 聊天消息 ────────────────────────────────────────────────────────────────

export type MessageRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  actions?: ChatAction[];
  timestamp: number;
}

export interface ChatAction {
  label: string;
  primary?: boolean;
  handler: () => void;
}

// ─── 当前合成状态 ─────────────────────────────────────────────────────────────

export interface ComposeState {
  selectedTemplate: TemplateInfo | null;
  slots: Record<string, { product: ParsedProduct; localImageUrl?: string }>;
  currentJob: ComposeJob | null;
  resultImageUrl: string | null;
  gridUrls: string[];
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface AppStore {
  templates: TemplateInfo[];
  templatesLoading: boolean;
  setTemplates: (t: TemplateInfo[]) => void;
  setTemplatesLoading: (v: boolean) => void;

  products: ProductItem[];
  setProducts: (p: ProductItem[]) => void;

  compose: ComposeState;
  selectTemplate: (t: TemplateInfo) => void;
  setSlot: (key: string, product: ParsedProduct, localImageUrl?: string) => void;
  clearSlots: () => void;
  setJob: (job: ComposeJob | null) => void;
  setResultImageUrl: (url: string | null) => void;
  setGridUrls: (urls: string[]) => void;

  messages: ChatMessage[];
  addMessage: (msg: Omit<ChatMessage, "id" | "timestamp"> & { id?: string }) => void;
  replaceMessage: (id: string, content: string) => void;
  clearMessages: () => void;
}

let _msgId = 0;
const nextId = () => String(++_msgId);

export const useAppStore = create<AppStore>()((set) => ({
  templates: [],
  templatesLoading: false,
  setTemplates: (templates) => set({ templates }),
  setTemplatesLoading: (templatesLoading) => set({ templatesLoading }),

  products: [],
  setProducts: (products) => set({ products }),

  compose: {
    selectedTemplate: null,
    slots: {},
    currentJob: null,
    resultImageUrl: null,
    gridUrls: [],
  },

  selectTemplate: (t) =>
    set((s) => ({
      compose: {
        ...s.compose,
        selectedTemplate: t,
        resultImageUrl: null,
        gridUrls: [],
        currentJob: null,
      },
    })),

  setSlot: (key, product, localImageUrl) =>
    set((s) => ({
      compose: {
        ...s.compose,
        slots: { ...s.compose.slots, [key]: { product, localImageUrl } },
      },
    })),

  clearSlots: () =>
    set((s) => ({
      compose: {
        ...s.compose,
        slots: {},
        currentJob: null,
        resultImageUrl: null,
        gridUrls: [],
      },
      messages: [makeWelcomeMsg()],
    })),

  setJob: (job) =>
    set((s) => ({
      compose: {
        ...s.compose,
        currentJob: job ? { ...job, progress: job.progress ?? [] } : null,
      },
    })),

  setResultImageUrl: (url) =>
    set((s) => ({ compose: { ...s.compose, resultImageUrl: url } })),

  setGridUrls: (urls) =>
    set((s) => ({ compose: { ...s.compose, gridUrls: urls } })),

  messages: [makeWelcomeMsg()],

  addMessage: (msg) =>
    set((s) => ({
      messages: [
        ...s.messages,
        { ...msg, id: msg.id ?? nextId(), timestamp: Date.now() },
      ],
    })),

  replaceMessage: (id, content) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, content } : m
      ),
    })),

  clearMessages: () =>
    set(() => ({
      messages: [makeWelcomeMsg()],
    })),
}));
