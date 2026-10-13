import { useEffect, useMemo, useState } from 'react';
import type { AiSettings, BookmarkNode } from '@markbridge/protocol';
import { aiSettings } from '../../backend';
import { AiSuggest } from '../ai/AiSuggest';
import { MaintenanceDesk } from '../maintenance/MaintenanceDesk';
import { displayTitle, folderPath, indexFlat, querySnapshot } from '../library/model';
import { OrganizationDesk } from './OrganizationDesk';

type Tab = 'maintenance' | 'folders' | 'suggestion';
const tabs: { id: Tab; label: string }[] = [{ id: 'maintenance', label: '重复与链接' }, { id: 'folders', label: 'AI 文件夹' }, { id: 'suggestion', label: '单条建议' }];

export function OrganizeWorkspace({ profileId, profileName, sourceEpoch, revision, live, active, nodes, selected, folderId, onLibrary, onSettings, onHistory, onChanged }: {
  profileId: string; profileName: string; sourceEpoch: number; revision: number; live: boolean; active: boolean;
  nodes: BookmarkNode[]; selected: BookmarkNode[]; folderId: string | null;
  onLibrary?: () => void; onSettings?: () => void; onHistory?: () => void; onChanged?: () => void;
}) {
  const [tab, setTab] = useState<Tab>('maintenance');
  const [mode, setMode] = useState<'selection' | 'folder'>('selection');
  const [chosenFolder, setChosenFolder] = useState<string | null>(folderId);
  const [scope, setScope] = useState({ nodes: selected, name: '当前选择', generation: 0 });
  const [singleId, setSingleId] = useState<string | null>(selected[0]?.chromeId ?? null);
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [settingsFailed, setSettingsFailed] = useState(false);
  const index = useMemo(() => indexFlat(nodes), [nodes]);
  const folders = useMemo(() => nodes.filter((node) => node.kind === 'folder').map((node) => ({ id: node.chromeId, name: folderPath(index, node.chromeId).map((item) => displayTitle(item.title)).join(' / ') })), [nodes, index]);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    void aiSettings().then((value) => { if (!disposed) { setSettings(value); setSettingsFailed(false); } }, () => { if (!disposed) { setSettings(null); setSettingsFailed(true); } });
    return () => { disposed = true; };
  }, [active]);
  function capture() {
    const next = mode === 'selection' ? selected : chosenFolder ? querySnapshot(index, chosenFolder, 'subtree', '').filter((node) => node.kind === 'bookmark') : [];
    const name = mode === 'selection' ? '当前选择' : (folders.find((folder) => folder.id === chosenFolder)?.name ?? '未选择目录') + '（含子目录）';
    setScope((previous) => ({ nodes: next, name, generation: previous.generation + 1 }));
    setSingleId(next[0]?.chromeId ?? null);
  }
  const chromeIds = scope.nodes.map((node) => node.chromeId);
  const single = scope.nodes.find((node) => node.chromeId === singleId);
  const currentSingle = single ? index.nodes.get(single.chromeId) : undefined;
  return <section className="organize-workspace" aria-label="整理中心">
    <div className="page-intro"><h2>整理书签</h2><p className="secondary">选择范围，检查与审查，再确认需要的变更。</p></div>
    <div className="organize-scope">
      <div className="scope-bar"><div><strong>{profileName}</strong><p>本次范围：{scope.name} · {chromeIds.length} 个书签</p></div><button type="button" onClick={onLibrary}>返回书签选择范围</button></div>
      <div className="scope-choices" role="radiogroup" aria-label="整理范围">
        <label><input type="radio" name="organize-scope" checked={mode === 'selection'} onChange={() => setMode('selection')} />当前选择（{selected.length} 个书签）</label>
        <label><input type="radio" name="organize-scope" checked={mode === 'folder'} onChange={() => setMode('folder')} />指定目录</label>
      </div>
      <div className="edit-actions">
        {mode === 'folder' && <label>整理目录<select aria-label="整理目录" value={chosenFolder ?? ''} onChange={(event) => setChosenFolder(event.target.value || null)}><option value="">请选择目录</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>}
        <button type="button" disabled={mode === 'selection' ? selected.length === 0 : !chosenFolder} onClick={capture}>{mode === 'selection' ? '使用当前选择' : '使用此目录'}</button>
        <span className="secondary">只包含书签，不包含目录本身。更换范围会清除未确认的审查。</span>
      </div>
    </div>
    {!chromeIds.length && <p className="notice">在书签中勾选条目，或指定一个目录，再开始检查。</p>}
    <div className="organize-tabs" role="tablist" aria-label="整理方式" onKeyDown={(event) => {
      const at = tabs.findIndex((item) => item.id === tab);
      const next = event.key === 'ArrowRight' ? tabs[(at + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(at + tabs.length - 1) % tabs.length] : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : undefined;
      if (!next) return; event.preventDefault(); setTab(next.id); document.getElementById('organize-tab-' + next.id)?.focus();
    }}>{tabs.map((item) => <button type="button" role="tab" id={'organize-tab-' + item.id} key={item.id} aria-controls={'organize-panel-' + item.id} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>
    <div key={scope.generation} className="organize-results">
      <div role="tabpanel" id="organize-panel-maintenance" aria-labelledby="organize-tab-maintenance" hidden={tab !== 'maintenance'}><MaintenanceDesk profileId={profileId} sourceEpoch={sourceEpoch} revision={revision} live={live} chromeIds={chromeIds} onHistory={onHistory} /></div>
      <div role="tabpanel" id="organize-panel-folders" aria-labelledby="organize-tab-folders" hidden={tab !== 'folders'}><OrganizationDesk profileId={profileId} sourceEpoch={sourceEpoch} revision={revision} live={live} chromeIds={chromeIds} settings={settings} onSettings={onSettings} onHistory={onHistory} /></div>
      <div role="tabpanel" id="organize-panel-suggestion" aria-labelledby="organize-tab-suggestion" hidden={tab !== 'suggestion'}>
        {settingsFailed && <p role="alert">无法读取 AI 配置。请打开 AI 设置后重试。</p>}
        <label className="single-suggestion-choice">审查书签<select aria-label="审查书签" value={singleId ?? ''} onChange={(event) => setSingleId(event.target.value)}><option value="">请选择书签</option>{scope.nodes.map((node) => <option key={node.chromeId} value={node.chromeId}>{displayTitle(node.title)}</option>)}</select></label>
        {single && currentSingle ? <><p className="organize-item-title">{displayTitle(currentSingle.title)}</p><p className="secondary organize-item-url">{currentSingle.url}</p><AiSuggest profileId={profileId} chromeId={single.chromeId} url={currentSingle.url ?? null} revision={revision} settings={settings} live={live} onSettings={onSettings} onHistory={onHistory} onChanged={onChanged} /></> : <p>从本次范围选择一条书签，即可生成并审查建议。</p>}
      </div>
    </div>
    {onHistory && <div className="organize-footer"><span className="secondary">已确认的浏览器变更保留在操作历史中。</span><button type="button" onClick={onHistory}>查看操作历史</button></div>}
  </section>;
}
