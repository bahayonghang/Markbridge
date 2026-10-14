import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InstalledFontCatalog } from '@markbridge/protocol';
import { GeneralSettings } from './GeneralSettings';
import { DEFAULT_UI_PREFERENCES } from './ui-preferences';
import { createFontCatalogSession } from './font-catalog';
import { listInstalledFonts } from '../../backend';

vi.mock('../../backend', () => ({ listInstalledFonts: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const ready: InstalledFontCatalog = { status: 'ready', families: [{ family: 'Arial', displayName: 'Arial' }, { family: 'Microsoft YaHei UI', displayName: '微软雅黑 UI' }] };

describe('font catalog session', () => {
  it('loads lazily, merges pending reads, caches success and refreshes explicitly', async () => {
    const load = vi.fn(async () => ready); const session = createFontCatalogSession(load);
    expect(load).not.toHaveBeenCalled();
    const first = session.read(); expect(session.read(true)).toBe(first);
    await first; await session.read(); expect(load).toHaveBeenCalledTimes(1);
    await session.read(true); expect(load).toHaveBeenCalledTimes(2);
  });
  it('discards closed requests from cache and never lets them replace a reopened response', async () => {
    let finish!: (value: InstalledFontCatalog) => void;
    const load = vi.fn<() => Promise<InstalledFontCatalog>>().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(ready);
    const session = createFontCatalogSession(load); const old = session.read(); session.cancelPending();
    const reopened = session.read(); expect(session.read()).toBe(reopened); expect(load).toHaveBeenCalledTimes(1);
    finish({ status: 'ready', families: [] }); await old; await reopened;
    expect(load).toHaveBeenCalledTimes(2);
    expect(session.peek()).toEqual(ready);
  });
  it('turns rejected enumeration into stable retryable status', async () => {
    const load = vi.fn().mockRejectedValue(new Error('private path')); const session = createFontCatalogSession(load);
    expect(await session.read()).toEqual({ status: 'unavailable', reason: 'enumeration_failed' });
    expect(session.peek()).toBeNull(); await session.read(); expect(load).toHaveBeenCalledTimes(2);
  });
  it('does not launch queued replacement work after its picker also closes', async () => {
    let finish!: (value: InstalledFontCatalog) => void;
    const load = vi.fn<() => Promise<InstalledFontCatalog>>().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const session = createFontCatalogSession(load); const old = session.read(); session.cancelPending();
    const queued = session.read(); session.cancelPending(); finish(ready); await old; await queued;
    expect(load).toHaveBeenCalledTimes(1); expect(session.peek()).toBeNull();
  });
});

describe('font picker and precise size', () => {
  it('does not enumerate on settings entry, previews without changing preferences, applies explicitly', async () => {
    vi.mocked(listInstalledFonts).mockResolvedValue(ready); const change = vi.fn();
    render(<GeneralSettings value={DEFAULT_UI_PREFERENCES} saveFailed={false} onChange={change} />);
    expect(listInstalledFonts).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '选择字体' }));
    await screen.findByRole('option', { name: 'Arial' });
    fireEvent.click(screen.getByRole('option', { name: 'Arial' }));
    expect(document.querySelector('.font-picker-sample [lang="en"]')?.parentElement?.style.fontFamily).toContain('Arial');
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '使用此字体' }));
    expect(change).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_UI_PREFERENCES, font: { kind: 'installed', family: 'Arial' } });
  });
  it('searches both names, cancels late results and keeps missing saved font until a successful census', async () => {
    let finish!: (catalog: InstalledFontCatalog) => void;
    vi.mocked(listInstalledFonts).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(ready);
    const change = vi.fn();
    render(<GeneralSettings value={{ ...DEFAULT_UI_PREFERENCES, font: { kind: 'installed', family: 'Missing Font' } }} saveFailed={false} onChange={change} />);
    expect(screen.queryByText('所选字体当前不可用，已使用备用字体。')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '选择字体' })); fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await act(async () => finish(ready)); expect(screen.queryByRole('dialog')).toBeNull(); expect(change).not.toHaveBeenCalled();
    expect(screen.queryByText('所选字体当前不可用，已使用备用字体。')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '选择字体' })); await screen.findByRole('option', { name: 'Arial' });
    expect(screen.getByText('所选字体当前不可用，已使用备用字体。')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('搜索已安装字体'), { target: { value: 'YaHei' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('搜索已安装字体'), { target: { value: '微软雅黑' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
  });
  it('keeps large catalogs virtual and preserves candidate/query on refresh without applying', async () => {
    vi.mocked(listInstalledFonts).mockResolvedValue({ status: 'ready', families: Array.from({ length: 1000 }, (_, n) => ({ family: `Font ${n}`, displayName: `Font ${n}` })) });
    const change = vi.fn(); render(<GeneralSettings value={DEFAULT_UI_PREFERENCES} saveFailed={false} onChange={change} />);
    fireEvent.click(screen.getByRole('button', { name: '选择字体' })); await screen.findByText('找到 1000 个字体族');
    expect(screen.getAllByRole('option').length).toBeLessThan(20);
    fireEvent.change(screen.getByLabelText('搜索已安装字体'), { target: { value: 'Font 333' } });
    fireEvent.click(screen.getByRole('option', { name: 'Font 333' }));
    fireEvent.click(screen.getByRole('button', { name: '刷新字体列表' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '刷新字体列表' })).toBeEnabled());
    expect(screen.getByLabelText('搜索已安装字体')).toHaveValue('Font 333');
    expect(screen.getByRole('option', { name: 'Font 333' })).toHaveAttribute('aria-selected', 'true');
    expect(change).not.toHaveBeenCalled();
  });
  it('does not infer absence on failure and still offers presets with an empty or failed catalog', async () => {
    vi.mocked(listInstalledFonts).mockResolvedValueOnce({ status: 'unavailable', reason: 'enumeration_failed' }).mockResolvedValueOnce({ status: 'ready', families: [] });
    const change = vi.fn(); render(<GeneralSettings value={{ ...DEFAULT_UI_PREFERENCES, font: { kind: 'installed', family: 'Saved Font' } }} saveFailed={false} onChange={change} />);
    fireEvent.click(screen.getByRole('button', { name: '选择字体' })); await screen.findByText(/无法读取字体列表/);
    expect(screen.queryByText('所选字体当前不可用，已使用备用字体。')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '刷新字体列表' })); await screen.findByText('未找到已安装字体，可使用兼容预设。');
    fireEvent.click(screen.getByRole('button', { name: '系统字体' })); expect(screen.getByRole('button', { name: '使用此字体' })).toBeEnabled();
    expect(change).not.toHaveBeenCalled();
  });
  it('retains the last valid size for partial/invalid input and commits valid Enter/blur only', () => {
    const change = vi.fn(); render(<GeneralSettings value={DEFAULT_UI_PREFERENCES} saveFailed={false} onChange={change} />);
    const size = screen.getByLabelText('字号');
    for (const invalid of ['', '11', '21', '14.5', 'abc']) { fireEvent.change(size, { target: { value: invalid } }); fireEvent.blur(size); expect(change).not.toHaveBeenCalled(); }
    expect(screen.getByRole('alert')).toHaveTextContent('当前字号保持不变');
    fireEvent.change(size, { target: { value: '17' } }); fireEvent.keyDown(size, { key: 'Enter' });
    expect(change).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_UI_PREFERENCES, fontSizePx: 17 });
  });
  it('reset clears an invalid draft even when the saved size already equals the default', () => {
    const change = vi.fn(); render(<GeneralSettings value={DEFAULT_UI_PREFERENCES} saveFailed={false} onChange={change} />);
    const size = screen.getByLabelText('字号'); fireEvent.change(size, { target: { value: '0' } }); fireEvent.blur(size);
    fireEvent.click(screen.getByRole('button', { name: '恢复默认外观' }));
    expect(size).toHaveValue('14'); expect(screen.queryByRole('alert')).toBeNull();
  });
});
