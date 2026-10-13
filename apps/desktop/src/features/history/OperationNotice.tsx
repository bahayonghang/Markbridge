import { useEffect, useState } from 'react';
import type { ApplyResult } from '@markbridge/protocol';
import { listOperations } from '../../backend';

const labels: Record<ApplyResult['state'], string> = { planned: '等待执行', applying: '已发送，等待回执', applied: '回执已确认', uncertain: '结果不确定，请在操作历史核对', partial: '部分完成，请在操作历史核对', failed: '操作失败，请查看回执', rolling_back: '正在撤销，等待回执', rolled_back: '撤销回执已确认', rollback_conflict: '撤销存在冲突，外部值保持不变' };

export function OperationNotice({ profileId, result, onHistory }: { profileId: string; result: ApplyResult; onHistory?: () => void }) {
  const [receipt, setReceipt] = useState(result);
  useEffect(() => { setReceipt(result); }, [result]);
  const pending = ['planned', 'applying', 'rolling_back'].includes(receipt.state);
  useEffect(() => {
    if (!pending) return;
    let disposed = false;
    let loading = false;
    const pull = async () => {
      if (loading) return;
      loading = true;
      try {
        const page = await listOperations(profileId);
        const next = page.operations.find((item) => item.operationId === result.operationId);
        if (!disposed && next) setReceipt(next);
      } catch { /* Keep the last observed state; history can refresh it. */ }
      finally { loading = false; }
    };
    void pull();
    const timer = window.setInterval(() => void pull(), 500);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [profileId, result.operationId, pending]);
  return <div className="organize-operation"><p role="status">{labels[receipt.state]}。离开页面不会撤回已确认的操作。</p>{onHistory && <button type="button" onClick={onHistory}>前往操作历史</button>}</div>;
}
