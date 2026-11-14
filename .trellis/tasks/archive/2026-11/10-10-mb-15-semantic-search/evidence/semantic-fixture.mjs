import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { B10K_SEED, buildB10k } from '../../../../apps/desktop/src/features/library/b10k.ts';

const subjects = [
  ['Rust 异步运行时', 'Tokio tasks, futures and cancellation', '怎样用 Rust 并发执行任务并安全取消？'],
  ['React 状态与副作用', 'React effects, state updates and stale results', 'Prevent old asynchronous responses from replacing current React state'],
  ['SQLite 一致性备份', 'SQLite WAL and online backup consistency', '数据库开着 WAL 时如何备份而不丢失未 checkpoint 的数据？'],
  ['键盘无障碍', 'Accessible focus, dialogs and keyboard navigation', 'Build a dialog that works without a mouse'],
  ['书签条件撤销', 'Undo changes without overwriting later external edits', '撤销旧操作但保留其他人在之后加入的内容'],
  ['网页请求安全', 'SSRF, DNS pinning and redirect validation', 'Stop redirects from fetching private network addresses'],
  ['本地模型向量', 'Local embeddings and cosine similarity', '本机如何把文本变成向量并按语义查找？'],
  ['浏览器扩展恢复', 'Manifest V3 service worker restart and receipts', 'Recover a Chrome extension after its background worker restarts'],
  ['资料身份隔离', 'Profile scoped browser IDs and persistent identities', '两个 Chrome 资料都有相同书签编号时怎么防止串数据？'],
  ['原生凭据服务', 'Keychain, Secret Service and secure storage failures', 'Store an API key securely without plaintext fallback'],
  ['独立网页会话', 'Isolated WebView cookies and persistent sessions', '不同资料的应用内网页登录状态不能混在一起'],
  ['Unicode 输入限制', 'Unicode scalar counts and UTF-8 byte limits', 'Bound multilingual input by both characters and encoded bytes'],
  ['派生索引生命周期', 'Pause, resume, delete and generation checks', '暂停计算后晚到的响应不能重新创建已删除索引'],
  ['虚拟列表交互', 'Virtualized rows, selection and keyboard scrolling', 'Keep selection stable while loading and scrolling a large list'],
  ['模型版本变化', 'Embedding digest and dimension mismatch handling', '换了模型或向量维度后为什么需要重新建索引？'],
  ['书签排序恢复', 'Sibling order, anchors and identity remapping', 'Restore bookmark order after deletion creates new browser IDs'],
  ['公共页面抽取', 'Visible text extraction and bounded content requests', '只抽取公开网页的可见正文并限制响应体大小'],
  ['本地标签管理', 'Local tag rename, merge and reversible title encoding', 'Keep local tags independent from the browser title'],
  ['前端来源守卫', 'Profile epochs, visits and stale UI responses', '切换 A 到 B 再回 A 时防止旧结果显示在当前界面'],
  ['原生产物检查', 'Native binary architecture and build path remapping', 'Reject a release binary that exposes build machine paths'],
];
const roles = ['概念说明', '操作示例', '故障排查', '边界测试', '实现参考'];
const complete = node => ({ ...node, folderType: null, unmodifiable: null, dateAdded: null, dateLastUsed: null });

export function semanticFixture(large = false) {
  const built = large ? buildB10k() : { nodes: [
    { chromeId: '0', parentId: null, position: 0, kind: 'folder', title: '根', url: null },
    { chromeId: '1', parentId: '0', position: 0, kind: 'folder', title: '合成语义资料', url: null },
    ...['Rust 异步运行时', 'React 状态与副作用', 'SQLite 一致性备份'].map((title, index) => ({ chromeId: `b${index + 1}`, parentId: '1', position: index, kind: 'bookmark', title, url: `https://example.com/MB15-URL-NEVER-SENT/${index}` })),
  ], bookmarks: 3, folders: 1, maxDepth: 2 };
  const summaries = {};
  const nodes = built.nodes.map(node => {
    if (node.kind !== 'bookmark') return complete(node);
    const ordinal = Number(node.chromeId.slice(1));
    if (large && ordinal <= 100) {
      const topic = Math.floor((ordinal - 1) / 5), variant = (ordinal - 1) % 5;
      summaries[node.chromeId] = `${subjects[topic][0]}。${subjects[topic][1]}。本条为${roles[variant]}，用于人工审查的合成相关性资料。`;
      return complete({ ...node, title: `${subjects[topic][0]}：${roles[variant]}` });
    }
    summaries[node.chromeId] = large ? `背景归档条目 ${ordinal}，用于固定规模测试。` : `${node.title}。已有摘要，未重新抓取网页。`;
    return complete(node);
  });
  assert.equal(nodes.filter(node => node.kind === 'bookmark').length, large ? 10000 : 3);
  const profiles = [{ profileId: 'semantic-fixture-a', nodes, summaries }];
  if (!large) profiles.push({ profileId: 'semantic-fixture-b', nodes: nodes.map(node => node.kind === 'bookmark' ? { ...node, title: `另一资料 ${node.title}` } : node), summaries: { ...summaries } });
  const fixture = { kind: 'markbridge-semantic-fixture-v1', profiles };
  return { fixture, shape: { seed: B10K_SEED, bookmarks: built.bookmarks, folders: built.folders, maxDepth: built.maxDepth }, sha256: createHash('sha256').update(JSON.stringify(fixture)).digest('hex') };
}

export function candidateLabels() {
  const built = semanticFixture(true);
  return { formatVersion: 1, annotationStatus: 'DEVELOPER_CANDIDATE_NOT_HUMAN_REVIEWED',
    humanReview: { reviewed: false, reviewer: null, reviewedAt: null },
    fixtureSha256: built.sha256, fixtureShape: built.shape, topK: 5,
    queries: subjects.map((subject, index) => ({ id: `q${index + 1}`, text: subject[2], relevantChromeIds: Array.from({ length: 5 }, (_, offset) => `b${index * 5 + offset + 1}`) })),
  };
}
