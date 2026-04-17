/**
 * 左栏 — 历史记录面板
 * 展示过去的合成任务，点击可打开 Penpot 编辑链接或预览结果图
 */
import { useEffect, useState } from "react";
import { getImageUrl, listComposes, type ComposeJob } from "../../api/client";

export default function HistoryPanel() {
  const [jobs, setJobs] = useState<ComposeJob[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const list = await listComposes(30);
      setJobs(list);
    } catch {
      // 网络错误静默忽略
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) {
    return <div className="history-empty">加载中…</div>;
  }

  const done = jobs.filter((j) => j.status === "done");
  const others = jobs.filter((j) => j.status !== "done");

  return (
    <div className="history-panel">
      <div className="history-toolbar">
        <span className="history-count">{jobs.length} 条记录</span>
        <button className="history-refresh" onClick={load} title="刷新">↻</button>
      </div>

      {jobs.length === 0 && (
        <div className="history-empty">暂无历史记录</div>
      )}

      {done.map((job) => (
        <HistoryItem key={job.id} job={job} />
      ))}

      {others.length > 0 && (
        <>
          <div className="history-section-label">其他状态</div>
          {others.map((job) => (
            <HistoryItem key={job.id} job={job} />
          ))}
        </>
      )}
    </div>
  );
}

function formatTime(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);

  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  if (diffH < 24) return `${diffH} 小时前`;
  if (diffD < 7) return `${diffD} 天前`;

  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${min}`;
}

function HistoryItem({ job }: { job: ComposeJob }) {
  const isDone = job.status === "done";
  const isFailed = job.status === "failed";
  const imgUrl = isDone ? getImageUrl(job.id) : null;

  const statusLabel = {
    done: "生图完成",
    failed: "生图失败",
    running: "生图中",
    pending: "等待中",
  }[job.status] ?? job.status;

  return (
    <div className={`history-item ${job.status}`}>
      {imgUrl ? (
        <img src={imgUrl} className="history-thumb" alt="缩略图" />
      ) : (
        <div className="history-thumb placeholder">
          {isFailed ? "✗" : "…"}
        </div>
      )}

      <div className="history-info">
        <div className="history-time">{formatTime(job.created_at)}</div>
        <div className={`history-status ${job.status}`}>{statusLabel}</div>
        {job.penpot_edit_url && (
          <a
            href={job.penpot_edit_url}
            target="_blank"
            rel="noreferrer"
            className="history-edit-link"
          >
            在 Penpot 中修改 ↗
          </a>
        )}
        {isFailed && job.error && (
          <div className="history-error" title={job.error}>
            {job.error.slice(0, 40)}…
          </div>
        )}
      </div>
    </div>
  );
}
