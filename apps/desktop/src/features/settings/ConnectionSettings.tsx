import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { BridgeState, ChromeProfileList } from '@markbridge/protocol';
import { DiagnosticExport } from './DiagnosticExport';
import {
  associateFileMirror, attachFileMirror,
  detachFileMirror, ensureLocalLibrary, enumerateChromeUserData,
  ignoreProfile, reconnectProfile, renameProfile, rescanFileMirrors,
  resumeProfile, retryBridgeListener, setProfileWritePaused,
} from '../../backend';
import {
  cacheTime, connectionLabels, fileLabels, listenerErrorMessage, profileNextStep,
  type Profile, type SourceTarget,
} from './source-status';
import { ConfirmDialog } from './ConfirmDialog';
import { WorkspaceIcon } from '../library/WorkspaceIcon';

const associationLabels: Record<BridgeState['mirrors'][number]['association'], string> = {
  independent: '独立只读',
  confirmed: '已关联 · 只读',
};

function mirrorProblem(code: string | null): string | null {
  if (!code) return null;
  if (code === 'PATH_UNAVAILABLE') return '无法读取所选 Chrome 目录。请重新选择后重试。';
  if (code === 'INVALID_TREE' || code === 'LIMIT_EXCEEDED') return '书签文件暂不可解析。已保留上次有效缓存。';
  return '文件来源暂不可用。已保留上次有效缓存。';
}

function safeError(code: string | null): string | null {
  if (!code) return null;
  if (code === 'CONFLICT') return '连接状态发生冲突。请检查端口和扩展后重试。';
  if (code === 'PORT_EXHAUSTED') return '本地端口 49153–49160 均已被占用，请释放端口后重试监听。';
  if (code === 'STORAGE_ERROR') return '本机存储不可用。请检查缓存权限及系统凭据服务是否已解锁，再重试。';
  return '连接不可用。请检查扩展状态后重试。';
}

function statusTone(profile: Profile, invalid: boolean): 'output' | 'input' | 'neutral' {
  if (invalid || profile.ignored || profile.connection === 'ignored' || profile.writePaused) return 'neutral';
  if (profile.connection === 'live') return 'output';
  if (profile.connection === 'connecting' || profile.connection === 'reconciling' || profile.connection === 'local') return 'input';
  return 'neutral';
}

function validateProfileName(raw: string): { valid: true; trimmed: string } | { valid: false; message: string } {
  const trimmed = raw.trim();
  const length = [...trimmed].length;
  if (length === 0) return { valid: false, message: '请输入 1–128 个字符的资料名称。' };
  if (length > 128) return { valid: false, message: '资料名称不能超过 128 个字符。' };
  if (trimmed === 'local-skills') return { valid: false, message: '不能使用保留名称 local-skills。' };
  return { valid: true, trimmed };
}

function ProfileRenameForm({ profile, unavailable, onSubmit }: {
  profile: Profile;
  unavailable: boolean;
  onSubmit: (profileId: string, trimmed: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(profile.displayName);
  const [validationError, setValidationError] = useState<string | null>(null);
  const lastDisplayName = useRef(profile.displayName);
  const inputId = `rename-${profile.profileId}`;
  const errorId = `rename-error-${profile.profileId}`;

  useEffect(() => {
    if (lastDisplayName.current === profile.displayName) return;
    lastDisplayName.current = profile.displayName;
    setDraft(profile.displayName);
    setValidationError(null);
  }, [profile.displayName]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const check = validateProfileName(draft);
    if (!check.valid) {
      setValidationError(check.message);
      return;
    }
    setValidationError(null);
    if (check.trimmed === profile.displayName) return;
    void onSubmit(profile.profileId, check.trimmed).catch((err: unknown) => {
      setValidationError(err instanceof Error && err.message ? err.message : '未能保存资料名称。请检查连接或存储状态后重试。');
    });
  }

  return (
    <form className="profile-rename-form" onSubmit={handleSubmit} noValidate>
      <div className="profile-rename-fields">
        <label htmlFor={inputId}>
          资料名称
          <input
            id={inputId}
            value={draft}
            disabled={unavailable}
            aria-invalid={validationError ? true : undefined}
            aria-describedby={validationError ? errorId : undefined}
            onChange={(event) => {
              setDraft(event.target.value);
              if (validationError) setValidationError(null);
            }}
          />
        </label>
        <button type="submit" disabled={unavailable}>保存名称</button>
      </div>
      {validationError && <p id={errorId} className="notice" role="alert">{validationError}</p>}
    </form>
  );
}

export function ConnectionSettings({ state, error, native, accept, onBrowseSource, onboarding = false }: {
  state: BridgeState | null;
  error: 'startup' | 'event' | null;
  native: boolean;
  accept: (state: BridgeState) => void;
  onBrowseSource: (source: SourceTarget) => void;
  onboarding?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [userDataPath, setUserDataPath] = useState('');
  const [choices, setChoices] = useState<ChromeProfileList['profiles']>([]);
  const [profileChoice, setProfileChoice] = useState('');
  const [ignoreTarget, setIgnoreTarget] = useState<Profile | null>(null);
  const [listedPath, setListedPath] = useState('');
  const mounted = useRef(false);
  const actionGeneration = useRef(0);
  const ignoreTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      actionGeneration.current += 1;
    };
  }, []);

  async function act(
    work: () => Promise<void>,
    failure = '操作未完成。请检查连接状态后重试。',
    suppressMessage = false,
  ): Promise<string | null> {
    if (busy || !native) return null;
    const generation = ++actionGeneration.current;
    setBusy(true);
    setMessage(null);
    try {
      await work();
      return null;
    } catch (code) {
      const text = code === 'STORAGE_ERROR' || code === 'PORT_EXHAUSTED'
        ? (safeError(code) ?? failure)
        : failure;
      if (!suppressMessage && mounted.current && generation === actionGeneration.current) {
        setMessage(text);
      }
      return text;
    } finally {
      if (mounted.current && generation === actionGeneration.current) setBusy(false);
    }
  }

  const chromeProfiles = state?.profiles.filter((profile) => profile.connection !== 'local') ?? [];
  const activeChromeProfiles = chromeProfiles.filter((profile) => !profile.ignored && profile.connection !== 'ignored');
  const selectedAssociateProfile = activeChromeProfiles.some((profile) => profile.profileId === profileChoice) ? profileChoice : '';
  const hasLocalLibrary = !!state?.profiles.some((profile) => profile.connection === 'local');
  const unavailable = !native || busy || !state || error === 'event';
  const listenerFault = state != null && state.port == null && state.errorCode != null;
  const topAlert = message ?? (state?.errorCode && state.port != null ? safeError(state.errorCode) : null);

  const extensionGuide = (
    <div className="connection-guide">
      <p>
        在需要同步的 Chrome 中打开 <code>chrome://extensions</code>，开启开发者模式后点击“加载已解压的扩展程序”，选择 Markbridge 扩展目录（源码构建位于 <code>apps/extension/dist</code>）。
      </p>
      <p className="secondary">加载后扩展会自动探测本地端口并同步书签，无需复制配对码或手动启动服务。开发与验收请使用单独的临时 Chrome 资料。</p>
    </div>
  );

  return (
    <div className={`connection-settings ${onboarding ? 'first-connection' : 'settings-connection'}`}>
      <div className="page-intro">
        <h2 id="connection-title">{onboarding ? '连接你的 Chrome 书签' : 'Chrome 连接'}</h2>
        {onboarding && <p className="secondary">安装并加载 Markbridge 扩展后即可自动连接，无需配对码，无需配置 AI。</p>}
      </div>

      {topAlert && <p className="notice" role="alert">{topAlert}</p>}

      <section className="well-group" aria-labelledby="listener-title">
        <div className="panel-heading">
          <h3 id="listener-title">{onboarding ? '1. 安装 Chrome 扩展并自动连接' : '本地连接监听'}</h3>
          <span className={`status-tag status-tag-${state?.port != null ? 'output' : 'neutral'}`}>
            {state?.port != null ? '正在监听' : !native ? '浏览器预览' : '未监听'}
          </span>
        </div>

        <div className="settings-facts">
          {state?.port != null ? (
            <>
              <span>监听地址 <code>127.0.0.1:{state.port}</code></span>
              <span>端口段 <code>49153–49160</code></span>
            </>
          ) : (
            <span>{!native ? '浏览器预览仅显示界面，请在桌面应用中启动监听。' : '尚未绑定本地监听端口。'}</span>
          )}
        </div>

        {listenerFault && (
          <p className="notice" role="alert">{listenerErrorMessage(state.errorCode)}</p>
        )}

        {state?.port == null && (
          <div className="edit-actions">
            <button
              type="button"
              className="primary-button"
              disabled={unavailable}
              onClick={() => {
                void act(async () => {
                  accept(await retryBridgeListener());
                }, '本地端口 49153–49160 均已被占用或不可用。请关闭占用程序后重试监听。');
              }}
            >
              重试监听
            </button>
          </div>
        )}

        {onboarding ? extensionGuide : (
          <details className="connection-advanced" open={!chromeProfiles.length || undefined}>
            <summary><WorkspaceIcon name="chevron" /><span>Chrome 扩展安装与连接说明</span></summary>
            {extensionGuide}
          </details>
        )}
      </section>

      {state?.profiles.map((profile) => {
        const isLocal = profile.connection === 'local';
        const isIgnored = profile.ignored || profile.connection === 'ignored';
        const reconnectPrimary = !isLocal && !isIgnored && (profile.connection === 'cached_read_only' || profile.connection === 'error');
        const browsePrimary = isLocal || (!isIgnored && (profile.connection === 'live' || profile.connection === 'connecting' || profile.connection === 'reconciling'));
        return (
          <article className="well-group profile-well" key={profile.profileId}>
            <div className="panel-heading">
              <h3>{profile.displayName}</h3>
              <div className="profile-badges">
                <span className={`status-tag status-tag-${statusTone(profile, error === 'event')}`}>
                  {error === 'event' ? '状态无效 · 只读' : connectionLabels[profile.connection]}
                </span>
                {profile.writePaused && !isLocal && (
                  <span className="status-tag status-tag-neutral">已暂停写入（只读保护）</span>
                )}
              </div>
            </div>

            <div className="settings-facts">
              <span>缓存节点 <span>{profile.nodeCount}</span></span>
              <span>来源版本 <span>{profile.revision}</span></span>
              <span>最近同步 <span>{cacheTime(profile.lastSyncedAt)}</span></span>
            </div>

            {profile.errorCode && <p className="notice" role="alert">{safeError(profile.errorCode)}</p>}
            <p className="secondary">{profileNextStep(profile.connection, profile.writePaused)}</p>

            {!isLocal && (
              <ProfileRenameForm
                profile={profile}
                unavailable={unavailable}
                onSubmit={async (profileId, trimmed) => {
                  const errorText = await act(async () => {
                    accept(await renameProfile(profileId, trimmed));
                  }, '未能保存资料名称。请检查名称长度或存储状态后重试。', true);
                  if (errorText) throw new Error(errorText);
                }}
              />
            )}

            <div className="edit-actions">
              <button
                type="button"
                className={browsePrimary ? 'primary-button' : undefined}
                disabled={unavailable}
                onClick={() => onBrowseSource({ kind: 'profile', id: profile.profileId })}
              >
                浏览此资料
              </button>
              {!isLocal && (
                <>
                  <button
                    type="button"
                    disabled={unavailable || isIgnored}
                    onClick={() => {
                      void act(async () => {
                        accept(await setProfileWritePaused(profile.profileId, !profile.writePaused));
                      });
                    }}
                  >
                    {profile.writePaused ? '恢复写入' : '暂停写入（只读）'}
                  </button>
                  <button
                    type="button"
                    className={reconnectPrimary ? 'primary-button' : undefined}
                    disabled={unavailable || isIgnored}
                    onClick={() => {
                      void act(async () => {
                        accept(await reconnectProfile(profile.profileId));
                      });
                    }}
                  >
                    重新连接
                  </button>
                  {isIgnored ? (
                    <button
                      type="button"
                      disabled={unavailable}
                      onClick={() => {
                        void act(async () => {
                          accept(await resumeProfile(profile.profileId));
                        });
                      }}
                    >
                      恢复连接
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="danger-button"
                      disabled={unavailable}
                      onClick={(event) => {
                        ignoreTriggerRef.current = event.currentTarget;
                        setIgnoreTarget(profile);
                      }}
                    >
                      断开并忽略
                    </button>
                  )}
                </>
              )}
            </div>
          </article>
        );
      })}

      {!hasLocalLibrary && (
        <section className="well-group" aria-labelledby="local-library-title">
          <div className="panel-heading">
            <h3 id="local-library-title">本地 Skills 书签库</h3>
            <span className="status-tag status-tag-neutral">独立 SQLite 空间</span>
          </div>
          <p className="secondary">启用本机专属书签空间（Skills 书签），可由项目 Skills 或命令行直接维护，不会同步或写回 Chrome。</p>
          <div className="edit-actions">
            <button
              type="button"
              disabled={unavailable}
              onClick={() => {
                void act(async () => {
                  const next = await ensureLocalLibrary();
                  accept(next);
                  const created = next.profiles.find((profile) => profile.connection === 'local');
                  if (created) onBrowseSource({ kind: 'profile', id: created.profileId });
                }, '无法启用本地 Skills 书签库。请检查本机存储状态后重试。');
              }}
            >
              启用本地 Skills 书签库
            </button>
          </div>
        </section>
      )}

      <details className="other-sources well-group">
        <summary><WorkspaceIcon name="chevron" /><span>其他接入方式：只读文件来源</span></summary>
        <p className="secondary">已接入 {state?.mirrors.length ?? 0} 个只读文件来源。无需扩展，直接读取本机 Chrome 书签文件缓存。不能写入 Chrome；文件时间不代表实时连接。</p>
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmedPath = userDataPath.trim();
            if (!trimmedPath) {
              setMessage('请输入 Chrome 用户数据目录的绝对路径。');
              return;
            }
            void act(async () => {
              const listed = await enumerateChromeUserData(trimmedPath);
              if (!mounted.current) return;
              setListedPath(trimmedPath);
              setChoices(listed.profiles);
              if (!listed.profiles.length) setMessage('所选目录中没有可接入的 Chrome 资料。请检查 User Data 路径。');
            }, '无法读取所选 Chrome 目录。请选择本机 User Data 路径后重试。');
          }}
          noValidate
        >
          <label htmlFor="user-data-path">
            用户数据目录
            <input
              id="user-data-path"
              value={userDataPath}
              onChange={(event) => {
                setUserDataPath(event.target.value);
                setChoices([]);
              }}
              disabled={unavailable}
              spellCheck={false}
            />
          </label>
          <button type="submit" disabled={unavailable}>枚举资料</button>
          <button
            type="button"
            disabled={unavailable || !state?.mirrors.some((mirror) => mirror.watching)}
            onClick={() => {
              void act(async () => {
                accept(await rescanFileMirrors());
              });
            }}
          >
            重新读取
          </button>
        </form>
        <p className="secondary">只读取 Local State 的资料名称和所选资料的 Bookmarks 文件。文件来源不能写入 Chrome。</p>
        {choices.length > 0 && (
          <ul className="mirror-tree">
            {choices.map((choice) => (
              <li key={choice.directoryKey}>
                <span>{choice.displayName}</span>
                <span className="secondary">{choice.directoryKey}</span>
                <button
                  type="button"
                  disabled={unavailable || !choice.bookmarksPresent}
                  onClick={() => {
                    void act(async () => {
                      accept(await attachFileMirror(listedPath, choice.directoryKey));
                    });
                  }}
                >
                  {choice.bookmarksPresent ? '接入只读镜像' : '未找到书签文件'}
                </button>
              </li>
            ))}
          </ul>
        )}
        {!state?.mirrors.length && (
          <p className="secondary">尚未接入只读文件来源。Chrome 关闭后，已接入的最后有效树仍可浏览。</p>
        )}
        {state?.mirrors.map((mirror) => (
          <article className="mirror-item" key={mirror.mirrorSourceId}>
            <div className="panel-heading">
              <h4>{mirror.displayName}</h4>
              <div className="profile-badges">
                <span className="status-tag status-tag-neutral">{associationLabels[mirror.association]}</span>
                <span className="status-tag status-tag-neutral">{mirror.watching ? '正在监听' : '已停止监听'}</span>
              </div>
            </div>
            <div className="settings-facts">
              <span>文件状态 <span>{fileLabels[mirror.fileStatus]}</span></span>
              <span>缓存节点 <span>{mirror.nodeCount}</span></span>
              <span>缓存版本 <span>{mirror.revision}</span></span>
              <span>最近读取 <span>{cacheTime(mirror.lastSyncedAt)}</span></span>
            </div>
            {mirror.errorCode && <p className="notice" role="alert">{mirrorProblem(mirror.errorCode)}</p>}
            <p className="secondary">浏览器写入已禁用。在线资料优先于已关联的文件来源。</p>
            <div className="edit-actions">
              <button
                type="button"
                disabled={unavailable}
                onClick={() => onBrowseSource({ kind: 'mirror', id: mirror.mirrorSourceId })}
              >
                浏览缓存
              </button>
              <button
                type="button"
                disabled={unavailable || !mirror.watching}
                onClick={() => {
                  void act(async () => {
                    accept(await detachFileMirror(mirror.mirrorSourceId));
                  });
                }}
              >
                停止监听
              </button>
            </div>
            {activeChromeProfiles.length > 0 && (
              <form
                className="inline-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!selectedAssociateProfile) {
                    setMessage('请选择要验证的 Chrome 资料。');
                    return;
                  }
                  void act(async () => {
                    accept(await associateFileMirror(mirror.mirrorSourceId, selectedAssociateProfile));
                  }, '文件与在线资料不一致，保持独立只读。');
                }}
              >
                <label htmlFor={`associate-${mirror.mirrorSourceId}`}>
                  关联 Chrome 资料
                  <select
                    id={`associate-${mirror.mirrorSourceId}`}
                    value={selectedAssociateProfile}
                    onChange={(event) => setProfileChoice(event.target.value)}
                    disabled={unavailable || mirror.fileStatus !== 'current'}
                  >
                    <option value="">选择 Chrome 资料</option>
                    {activeChromeProfiles.map((profile) => (
                      <option key={profile.profileId} value={profile.profileId}>{profile.displayName}</option>
                    ))}
                  </select>
                </label>
                <button type="submit" disabled={unavailable || mirror.fileStatus !== 'current' || !selectedAssociateProfile}>
                  验证关联
                </button>
              </form>
            )}
          </article>
        ))}
      </details>

      {!onboarding && <DiagnosticExport native={native} />}

      {ignoreTarget && (
        <ConfirmDialog
          title={`断开并忽略“${ignoreTarget.displayName}”？`}
          confirmLabel="确认断开并忽略"
          returnFocus={ignoreTriggerRef}
          onCancel={() => setIgnoreTarget(null)}
          onConfirm={() => {
            const id = ignoreTarget.profileId;
            setIgnoreTarget(null);
            void act(async () => {
              accept(await ignoreProfile(id));
            });
          }}
        >
          <p>将向该扩展发送暂停信号并停止自动重连。Chrome 中的书签、本机缓存、标签和备注都会保留。</p>
          <p>之后可随时在此点击「恢复连接」，或在扩展弹窗中手动重新连接。</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
