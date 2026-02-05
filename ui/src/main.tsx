import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Always-on dark mode.
document.documentElement.classList.add('dark');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
