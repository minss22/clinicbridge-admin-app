import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

// 기본 body 여백 제거(앱 둘레 흰 테두리 방지) + 배경 통일
document.body.style.margin = '0'
document.body.style.background = '#F7F8FA'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
