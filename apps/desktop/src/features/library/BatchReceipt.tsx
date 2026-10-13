import { useEffect, useRef, useState } from 'react';
import type { BatchEditStatus } from '@markbridge/protocol';
import { cancelBatchEdit, getBatchEdit } from '../../backend';

const states = { applied: '已执行', not_executed: '未执行', in_flight: '等待回执', conflict: '冲突，未执行', uncertain: '结果不确定' };
type Props = { profileId: string; operationId: string; initial?: BatchEditStatus };

export function BatchReceipt(props: Props) {
  return <ReceiptDetails key={`${props.profileId}:${props.operationId}`} {...props} />;
}

function ReceiptDetails({ profileId, operationId, initial }: Props) {
  const [result, setResult] = useState(initial ?? null);
  const [notice, setNotice] = useState('');
  const [stopping, setStopping] = useState(false);
  const resultRef = useRef(result);
  const generation = useRef(0);
  const lock = useRef(false);
  const pendingReads = useRef(0);

  function accept(value: BatchEditStatus) {
    if (value.profileId !== profileId || value.operationId !== operationId) throw new Error('WRONG_BATCH');
    resultRef.current = value;
    setResult(value);
  }
  async function pull() {
    if (lock.current) return;
    const request = ++generation.current;
    pendingReads.current += 1;
    try {
      const value = await getBatchEdit(profileId, operationId);
      if (request !== generation.current) return;
      accept(value); setNotice('');
    } catch { if (request === generation.current) setNotice('无法读取回执，请重新查询。'); }
    finally { pendingReads.current -= 1; }
  }
  useEffect(() => {
    if (!initial) void pull();
    const timer = window.setInterval(() => {
      const value = resultRef.current;
      if (pendingReads.current === 0 && value && (value.state === 'applying' || value.state === 'rolling_back' || value.items.some((item) => item.state === 'uncertain'))) void pull();
    }, 400);
    return () => { generation.current += 1; window.clearInterval(timer); };
  }, []);

  async function stop() {
    if (lock.current) return;
    lock.current = true; setStopping(true);
    const request = ++generation.current;
    try {
      const value = await cancelBatchEdit(profileId, operationId);
      if (request !== generation.current) return;
      accept(value); setNotice('已停止后续步骤。已执行的变更保留，正在执行的步骤仍需核对。');
    } catch { if (request === generation.current) setNotice('停止请求未获确认，请重新查询回执。'); }
    finally { if (request === generation.current) { lock.current = false; setStopping(false); } }
  }

  return <section className="batch-results" aria-label="逐项回执">
    {!result && !notice && <p role="status">正在读取逐项回执。</p>}
    {result && <>
      <h4>{result.state === 'applied' ? '全部回执已确认' : result.state === 'rolled_back' ? '批次已撤销' : result.state === 'rolling_back' ? '正在撤销' : result.state === 'rollback_conflict' ? '撤销存在冲突' : result.stopped ? '批次已停止' : '正在等待回执'}</h4>
      <p>已执行 {result.items.filter((item) => item.state === 'applied').length} / {result.items.length} 项。{result.stopped && '停止不会撤销已执行的变更。'}</p>
      {result.state === 'applying' && !result.stopped && <button type="button" disabled={stopping} onClick={() => void stop()}>停止后续步骤</button>}
      <ol className="batch-items">{result.items.map((item) => <li key={item.chromeId}><span>{item.title || '未命名'}</span><strong>{states[item.state]}</strong></li>)}</ol>
      {result.stopped && <p>可在操作历史重新查询回执，再审查条件撤销。</p>}
    </>}
    <button type="button" disabled={stopping} onClick={() => void pull()}>重新查询逐项回执</button>
    {notice && <p role="status">{notice}</p>}
  </section>;
}
