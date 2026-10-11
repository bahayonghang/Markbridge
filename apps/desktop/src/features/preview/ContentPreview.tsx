import type { PreviewImage } from '@markbridge/protocol';
import { useContentPreview } from './useContentPreview';

const mediaTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function imageSrc(image: PreviewImage | null): string | null {
  if (!image || !mediaTypes.has(image.mediaType)) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(image.dataBase64)) return null;
  return `data:${image.mediaType};base64,${image.dataBase64}`;
}

export function ContentPreviewPanel({ profileId, chromeId, url }: { profileId: string; chromeId: string; url: string | null }) {
  const { view, refresh, cancel, http } = useContentPreview(profileId, chromeId, url);
  const preview = view.phase === 'ready' ? view.preview : null;
  const src = preview ? imageSrc(preview.image) : null;
  return (
    <section className="content-preview" aria-label="内容预览">
      <h4>内容预览</h4>
      {view.phase === 'loading' && <p>正在读取页面内容</p>}
      {view.phase === 'message' && <p>{view.message}</p>}
      {preview?.status === 'failed' && <p>{preview.failureMessage ?? '页面响应无效'}</p>}
      {preview && preview.status !== 'failed' && <>
        <p className="library-detail-title">{preview.title ?? '没有标题'}</p>
        <p>{preview.summary ?? '没有可显示的摘要'}</p>
        {preview.cacheLabel && <p className="secondary">{preview.cacheLabel}</p>}
        {src ? <img src={src} alt={preview.image?.sourceLabel ? `来源图片 ${preview.image.sourceLabel}` : '来源图片'} /> : preview.imageFailureMessage ? <p>{preview.imageFailureMessage}</p> : <p className="secondary">没有来源图片</p>}
      </>}
      {http && <p className="secondary">登录或动态页面需要你在 Chrome 里点击扩展图标后再采集。桌面不能授予扩展当前页权限。</p>}
      <div className="edit-actions">
        <button type="button" onClick={refresh}>重新读取</button>
        <button type="button" className="secondary-button" onClick={cancel}>取消</button>
      </div>
    </section>
  );
}
