import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { subscribeUserProfile } from '../services/users';
import { store } from './store/index.js';
import { setUser } from './store/authSlice.js';
import { syncFromCloud, subscribeToCloud } from './store/persistence.js';
import App from './App.jsx';
import './index.css';

/*
 * 台股分析併入 Claude Flow 後的入口（獨立頁面 /stock/）。
 *
 * 登入狀態與 Claude Flow 共用（同網域、同一個 Firebase 實例），但只有
 * Claude Flow 的管理員（users/{uid}.role === 'admin' 且未停用）可以使用。
 *
 * 權限確認之前絕不啟動雲端同步：同步會把本機 localStorage 的持股合併後寫回
 * portfolios/{uid}，若對非管理員也啟動，同一台電腦上前一位使用者的持股就會
 * 被寫進另一個帳號的雲端文件。
 *
 * 同步的順序沿用原本的設計：先同步再訂閱。初次同步會把本機獨有的資料回寫
 * 雲端，兩者同時進行會讓合併在兩條路徑上交錯，難以推理。
 */

/** @typedef {'checking' | 'signed-out' | 'denied' | 'granted'} Access */

let unsubscribeCloud = null;
let unsubscribeProfile = null;
/** 目前已啟動同步的 uid；null 代表沒有同步在跑。 */
let syncingUid = null;

/** @type {Access} */
let access = 'checking';
const accessListeners = new Set();

/** @param {Access} next */
function setAccess(next) {
  access = next;
  accessListeners.forEach((listener) => listener(next));
}

function stopSync() {
  // 登出、換人或權限被拔掉時一定要收掉，否則舊帳號的快照會繼續灌進 state。
  unsubscribeCloud?.();
  unsubscribeCloud = null;
  if (syncingUid !== null) {
    syncingUid = null;
    store.dispatch(setUser(null));
  }
}

/** @param {import('firebase/auth').User} user */
function startSync(user) {
  if (syncingUid === user.uid) return;
  stopSync();
  const { uid } = user;
  syncingUid = uid;
  // 只傳顯示所需的欄位：整個 Firebase User 物件含方法，會觸發 Redux 的序列化檢查警告。
  store.dispatch(
    setUser({ uid, displayName: user.displayName, email: user.email, photoURL: user.photoURL }),
  );
  syncFromCloud(store, uid).then(() => {
    // 同步期間可能又登出、換了帳號或被降級，確認還是同一個人才訂閱。
    if (syncingUid !== uid) return;
    unsubscribeCloud = subscribeToCloud(store, uid);
  });
}

onAuthStateChanged(auth, (user) => {
  unsubscribeProfile?.();
  unsubscribeProfile = null;

  if (!user) {
    stopSync();
    setAccess('signed-out');
    return;
  }

  setAccess('checking');
  unsubscribeProfile = subscribeUserProfile(
    user.uid,
    (profile) => {
      if (profile && profile.role === 'admin' && !profile.disabled) {
        startSync(user);
        setAccess('granted');
      } else {
        stopSync();
        setAccess('denied');
      }
    },
    () => {
      stopSync();
      setAccess('denied');
    },
  );
});

function Notice({ title, children }) {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="max-w-sm rounded-xl border border-slate-800 bg-slate-900/80 p-6 text-center">
        <h1 className="mb-2 text-lg font-semibold text-slate-100">{title}</h1>
        <p className="mb-5 text-sm text-slate-400">{children}</p>
        <a
          href="/"
          className="inline-block rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500"
        >
          回 Claude Flow 首頁
        </a>
      </div>
    </div>
  );
}

function Gate() {
  const [current, setCurrent] = useState(access);

  useEffect(() => {
    accessListeners.add(setCurrent);
    setCurrent(access);
    return () => {
      accessListeners.delete(setCurrent);
    };
  }, []);

  useEffect(() => {
    // 登入頁屬於 Claude Flow，登入後從導覽列的「台股分析」回到這裡。
    if (current === 'signed-out') window.location.replace('/login');
  }, [current]);

  if (current === 'granted') {
    return (
      <Provider store={store}>
        <App />
      </Provider>
    );
  }
  if (current === 'denied') {
    return <Notice title="沒有權限">台股分析目前只開放給管理員使用。</Notice>;
  }
  return <div className="flex min-h-full items-center justify-center text-sm text-slate-400">載入中…</div>;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Gate />
  </StrictMode>,
);
