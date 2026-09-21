import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useParams, useLocation } from 'react-router-dom';
import { useAgents } from './hooks/useAgents';
import { useTheme } from './hooks/useTheme';
import { useSessions } from './hooks/useSessions';
import { useModels } from './hooks/useModels';
import { useChat } from './hooks/useChat';
import type { PermissionMode } from './types';

// 页面懒加载
const HomePage = lazy(() => import('./pages/HomePage'));
const DiagnosisPage = lazy(() => import('./pages/DiagnosisPage'));
const DesignPage = lazy(() => import('./pages/DesignPage'));
const MultiAgentPage = lazy(() => import('./pages/MultiAgentPage'));
const ChatPage = lazy(() => import('./pages/ChatPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const OgsSimPage = lazy(() => import('./pages/OgsSimPage'));
// v5.3：原「3D 模拟」(Kernel3DPage) 与「3D 建模工具」(LandfillToolPage) 合并为
// 单一入口「三维建模分析」—— 两者渲染的本就是同一份会话几何，是重复入口
const KernelToolPage = lazy(() => import('./pages/KernelToolPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));

// 布局组件
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { ErrorBoundary } from './components/ErrorBoundary';

function PageLoader() {
  return (
    <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: 'var(--bg-base)' }}>
      <div className="text-center">
        <div className="w-10 h-10 border-[3px] rounded-full mx-auto mb-3 animate-spin"
             style={{ borderColor: 'var(--border)', borderTopColor: 'var(--primary)' }} />
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>加载中...</p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AppShell />} />
      <Route path="/chat/:sessionId" element={<AppShell />} />
      <Route path="/diagnose" element={<AppShell />} />
      <Route path="/design" element={<AppShell />} />
      <Route path="/multi-agent" element={<AppShell />} />
      {/* 旧「3D 模拟」入口保留为重定向（外部书签与旧文案里的 navigateTo 不 404） */}
      <Route path="/3d-simulator" element={<Navigate to="/tool" replace />} />
      <Route path="/ogs-sim" element={<AppShell />} />
      <Route path="/kernel-studio" element={<Navigate to="/tool" replace />} />
      {/* 「三维建模分析」全屏接管：不套 AppShell（自带菜单栏/品牌条/状态栏） */}
      <Route path="/tool" element={
        <Suspense fallback={<PageLoader />}>
          <ErrorBoundary fallbackLabel="三维建模分析">
            <KernelToolPage />
          </ErrorBoundary>
        </Suspense>
      } />
      <Route path="/settings" element={<AppShell />} />
      <Route path="/admin" element={
        <div className="flex h-[100dvh] w-full overflow-hidden">
          <Suspense fallback={<div className="flex items-center justify-center h-screen text-sm" style={{ color: 'var(--text-muted)' }}>加载管理员后台...</div>}>
            <ErrorBoundary fallbackLabel="管理员后台">
              <AdminPage />
            </ErrorBoundary>
          </Suspense>
        </div>
      } />
    </Routes>
  );
}

function AppShell() {
  const navigate = useNavigate();
  const { sessionId: urlSessionId } = useParams<{ sessionId: string }>();
  const location = useLocation();
  const isSettingsPage = location.pathname === '/settings';
  const isDiagnosePage = location.pathname === '/diagnose';
  const isDesignPage = location.pathname === '/design';
  const isHomePage = location.pathname === '/';
  const isMultiAgentPage = location.pathname === '/multi-agent';
  const isOgsSimPage = location.pathname === '/ogs-sim';
  // v5.3：/tool 已改为全屏独立路由，不再走 AppShell

  const { theme, toggleTheme } = useTheme();
  const { agents, addAgent, updateAgent, deleteAgent, getAgent } = useAgents();
  const { models, selectedModel, setSelectedModel } = useModels();
  const {
    sessions, setSessions, currentSessionId, setCurrentSessionId,
    currentSession, sessionModels, fetchSessions,
    deleteSession, updateSessionModel, addSession, updateSession,
    updateSessionMessages, flushSessionMessages,
  } = useSessions();

  const {
    isLoading, inputValue, setInputValue,
    permissionRequest, sendMessage, handleStop,
    handlePermissionAllow, handlePermissionDeny, setPermissionMode,
  } = useChat({
    currentSession, currentSessionId, selectedModel,
    getAgent, addSession, updateSession,
    updateSessionMessages, flushSessionMessages, updateSessionModel,
    setCurrentSessionId, setSessions,
  });

  const currentAgent = currentSession?.agentId ? getAgent(currentSession.agentId) : getAgent('default');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [permissionMode, setPermissionModeState] = useState<PermissionMode>('default');

  // "新建会话"意图标记：清空会话后 URL 尚未切换时，跳过旧 URL 的会话回同步
  const newChatIntentRef = useRef(false);

  // URL → sessionId 同步（'/chat/new' 是"新建会话"占位路由，不参与同步）
  useEffect(() => {
    if (newChatIntentRef.current) {
      newChatIntentRef.current = false;
      return;
    }
    if (urlSessionId && urlSessionId !== 'new' && urlSessionId !== currentSessionId) {
      setCurrentSessionId(urlSessionId);
    } else if (!urlSessionId && !isSettingsPage && currentSessionId) {
      setCurrentSessionId(null);
    }
  }, [urlSessionId, isSettingsPage, currentSessionId, setCurrentSessionId]);

  // 新会话创建出真实 id 后，把 URL 从 /chat/new 换成 /chat/{id}（刷新可恢复）
  useEffect(() => {
    if (urlSessionId === 'new') {
      newChatIntentRef.current = false;
      if (currentSessionId) {
        navigate(`/chat/${currentSessionId}`, { replace: true });
      }
    }
  }, [urlSessionId, currentSessionId, navigate]);

  // 恢复会话模型
  useEffect(() => {
    if (currentSessionId && sessionModels[currentSessionId]) {
      setSelectedModel(sessionModels[currentSessionId]);
    } else if (currentSession) {
      setSelectedModel(currentSession.model);
    }
  }, [currentSessionId, sessionModels, currentSession, setSelectedModel]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const updateCurrentSessionModel = useCallback((modelId: string) => {
    setSelectedModel(modelId);
    if (currentSessionId) updateSessionModel(currentSessionId, modelId);
  }, [currentSessionId, updateSessionModel, setSelectedModel]);

  const handleDeleteSession = useCallback(async (id: string) => {
    const nav = await deleteSession(id);
    if (nav) navigate(nav);
  }, [deleteSession, navigate]);

  const handleNewChat = useCallback(() => {
    newChatIntentRef.current = true;
    setCurrentSessionId(null);
    navigate('/chat/new');
  }, [navigate, setCurrentSessionId]);
  const handleSelectSession = useCallback((id: string) => { setCurrentSessionId(id); navigate(`/chat/${id}`); }, [navigate, setCurrentSessionId]);
  const handleOpenSettings = useCallback(() => navigate('/settings'), [navigate]);
  const handleOpenDiagnose = useCallback(() => navigate('/diagnose'), [navigate]);
  const handleOpenDesign = useCallback(() => navigate('/design'), [navigate]);
  const handleOpenMultiAgent = useCallback(() => navigate('/multi-agent'), [navigate]);
  const handleOpenOgsSim = useCallback(() => navigate('/ogs-sim'), [navigate]);
  const handleOpenTool = useCallback(() => navigate('/tool'), [navigate]);

  const handlePermissionModeChange = useCallback((mode: PermissionMode) => {
    setPermissionModeState(mode);
    setPermissionMode(mode);
  }, [setPermissionMode]);

  const bgColor = isHomePage ? 'transparent' : 'var(--bg-base)';

  return (
    <div className="flex h-[100dvh] w-[100vw] overflow-hidden" style={{ backgroundColor: bgColor }}>
      {/* 侧边栏：首页和多智能体页不显示 */}
      {!isHomePage && !isMultiAgentPage && (
        <ErrorBoundary fallbackLabel="侧边栏">
        <Sidebar
          sessions={sessions}
          currentSessionId={currentSessionId}
          isSettingsPage={isSettingsPage}
          sidebarOpen={sidebarOpen}
          agents={agents}
          getAgent={getAgent}
          onNewChat={handleNewChat}
          onSelectSession={handleSelectSession}
          onDeleteSession={handleDeleteSession}
          onOpenSettings={handleOpenSettings}
          onOpenDiagnose={handleOpenDiagnose}
          onOpenDesign={handleOpenDesign}
          onOpenMultiAgent={handleOpenMultiAgent}
          onOpenOgsSim={handleOpenOgsSim}
          onOpenTool={handleOpenTool}
          onOpenAdmin={() => navigate('/admin')}
          isDiagnosePage={isDiagnosePage}
          isDesignPage={isDesignPage}
          isMultiAgentPage={isMultiAgentPage}
          isOgsSimPage={isOgsSimPage}
        />
        </ErrorBoundary>
      )}

      <main className="flex-1 flex flex-col min-w-0" style={{ backgroundColor: bgColor }}>
        {/* Header：首页和多智能体页不显示 */}
        {!isHomePage && !isMultiAgentPage && (
          <Header
            isSettingsPage={isSettingsPage}
            sidebarOpen={sidebarOpen}
            theme={theme}
            currentSession={currentSession}
            currentAgent={currentAgent}
            models={models}
            selectedModel={selectedModel}
            onModelChange={updateCurrentSessionModel}
            onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
            onToggleTheme={toggleTheme}
          />
        )}

        <Suspense fallback={<PageLoader />}>
        <ErrorBoundary fallbackLabel="当前页面">
          {isSettingsPage ? (
            <SettingsPage agents={agents} onAdd={addAgent} onUpdate={updateAgent} onDelete={deleteAgent} />
          ) : isDesignPage ? (
            <DesignPage />
          ) : isDiagnosePage ? (
            <DiagnosisPage />
          ) : isHomePage ? (
            <HomePage />
          ) : isMultiAgentPage ? (
            <MultiAgentPage />
          ) : isOgsSimPage ? (
            <OgsSimPage />
          ) : (
            <ChatPage
              currentSession={currentSession}
              models={models}
              selectedModel={selectedModel}
              agents={agents}
              isLoading={isLoading}
              inputValue={inputValue}
              permissionRequest={permissionRequest}
              permissionMode={permissionMode}
              onSendMessage={sendMessage}
              onStop={handleStop}
              onInputChange={setInputValue}
              onModelChange={updateCurrentSessionModel}
              onPermissionAllow={handlePermissionAllow}
              onPermissionDeny={handlePermissionDeny}
              onPermissionModeChange={handlePermissionModeChange}
            />
          )}
        </ErrorBoundary>
        </Suspense>
      </main>
    </div>
  );
}
