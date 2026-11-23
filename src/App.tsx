import { NextUIProvider } from '@nextui-org/react';
import { StrictMode, useEffect } from 'react';
import { RouterProvider, createHashRouter } from 'react-router-dom';
import './App.css';
import BaselineInterface from './study/BaselineInterface';
import StudyInterface from './study/StudyInterface';
import { useStudyStore } from './study/StudyModel';
import Launcher from './view/Launcher';
import LoginPage from './view/LoginPage';
import LanguageSwitch from './i18n/LanguageSwitch';
import SettingsButton, { SettingsDialog } from './view/SettingsButton';
import EditorPage from './view/EditorPage';
import { useChromeStore } from './view/ChromeModel';
import { useDocumentStore } from './model/DocumentModel';
import RequestTimer from './view/components/RequestTimer';
import { useAuthStore } from './model/AuthModel';



function App() {
  const authStatus = useAuthStore((s) => s.status);
  const refreshAuth = useAuthStore((s) => s.refresh);
  const user = useAuthStore((s) => s.user);
  const menuBarVisible = useChromeStore((s) => s.menuBarVisible);
  useEffect(() => { refreshAuth(); }, [refreshAuth]);

  // 登录后载入该账号的文档，退出后清空
  useEffect(() => {
    if (authStatus === 'authenticated' && user) useDocumentStore.getState().init(user).catch((e) => console.error(e));
    if (authStatus === 'anonymous') useDocumentStore.getState().clear();
  }, [authStatus, user]);

  const freeFormLoader = () => {
    useStudyStore.getState().setIsDataSaved(false);
    return null;
  };

  // 登录后默认进入编辑界面，示例文本与用户实验入口移到 /launcher
  const router = createHashRouter([
    {
      path: 'free-form',
      loader: freeFormLoader,
      element: <EditorPage />
    },
    {
      path: 'study',
      element: <StudyInterface />
    },
    {
      path: 'baseline',
      element: <BaselineInterface />
    },
    {
      path: 'launcher',
      element: <Launcher />
    },
    {
      path: '',
      loader: freeFormLoader,
      element: <EditorPage />
    }
  ],
  /*{
    basename: import.meta.env.BASE_URL
  }*/
);

  return (
    <>
      <StrictMode>
        <NextUIProvider>
        {authStatus === 'authenticated' && <RouterProvider router={router} />}
        {authStatus === 'anonymous' && <LoginPage />}
        {authStatus === 'authenticated' && <RequestTimer />}
        {authStatus === 'authenticated' && <SettingsDialog />}
        {/* 编辑界面用顶部菜单栏，其他页面保留左下角的齿轮与语言按钮 */}
        {!menuBarVisible && <div style={{ position: 'fixed', left: 16, bottom: 16, zIndex: 100000, display: 'flex', gap: 8 }}>
          {authStatus === 'authenticated' && <SettingsButton />}
          <LanguageSwitch />
        </div>}
        </NextUIProvider>
      </StrictMode>
    </>
  )
}

export default App
