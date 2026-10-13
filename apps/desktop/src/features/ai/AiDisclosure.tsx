import type { AiSettings } from '@markbridge/protocol';

export function AiDisclosure({ settings, batch = false, count = 1, onSettings }: { settings: AiSettings | null; batch?: boolean; count?: number; onSettings?: () => void }) {
  return <div className="ai-disclosure" aria-label="发送给模型的内容">
    <p>{settings?.enabled ? <>端点 <strong>{settings.endpointLabel}</strong> · 模型 {settings.model}</> : 'AI 默认关闭。先在设置中选择端点和模型，再按需生成。'}</p>
    {batch ? <p>提出文件夹发送前 {Math.min(count, 200)} 项的编号、标题（最多 80 字）和网址（最多 120 字）。生成分配会分批发送整个范围，以及已审查的目录名称。不会发送备注或抓取网页。</p>
      : <p>生成时发送这条书签的标题（最多 300 字）、网址（最多 2000 字）和已有缓存正文（最多 2000 字）。不会发送本地备注，也不会为此抓取网页。</p>}
    {onSettings && <button type="button" className="secondary-button" onClick={onSettings}>AI 设置</button>}
  </div>;
}
